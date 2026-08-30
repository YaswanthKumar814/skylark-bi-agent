import type {
  Deal,
  DealStatus,
  DataQualityReport,
  ExecutionStatus,
  ProbabilityBand,
  WorkOrder,
} from "./types";
import type { MondayRow } from "./monday";

/* ------------------------------------------------------------------ */
/* Generic field helpers                                               */
/* ------------------------------------------------------------------ */

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Look up a column by title, tolerating case/punctuation drift from the monday import. */
function pick(row: MondayRow, titles: string[]): string {
  for (const t of titles) {
    const direct = row.values[t];
    if (direct !== undefined && direct !== "") return direct;
  }
  const wanted = titles.map(key);
  for (const [title, value] of Object.entries(row.values)) {
    if (wanted.includes(key(title)) && value !== "") return value;
  }
  // Prefix match as a last resort (monday sometimes truncates long titles on import).
  for (const [title, value] of Object.entries(row.values)) {
    const k = key(title);
    if (wanted.some((w) => w.length > 8 && (k.startsWith(w.slice(0, 18)) || w.startsWith(k.slice(0, 18)))) && value !== "") {
      return value;
    }
  }
  return "";
}

const text = (v: string): string | null => {
  const t = (v ?? "").trim();
  return t === "" || t.toLowerCase() === "n/a" || t === "-" ? null : t;
};

/** Parse INR / numeric text: strips ₹, commas, spaces; keeps sign and decimals. */
export function parseNumber(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const raw = String(v).trim();
  if (raw === "") return null;
  const negative = /^\(.*\)$/.test(raw) || raw.trim().startsWith("-");
  const cleaned = raw.replace(/[₹,\s()]/g, "").replace(/^-/, "").replace(/[A-Za-z]+$/, "");
  if (cleaned === "" || !/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Parse a date to an ISO yyyy-mm-dd string, or null. Month-only values return null. */
export function parseDate(v: string | null | undefined): string | null {
  const raw = (v ?? "").trim();
  if (!raw) return null;
  // yyyy-mm-dd (monday's native date text)
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // dd/mm/yyyy or dd-mm-yyyy
  m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    if (d.getFullYear() > 1990 && d.getFullYear() < 2100) return d.toISOString().slice(0, 10);
  }
  return null;
}

export const SECTOR_ALIASES: Record<string, string[]> = {
  renewables: ["renewable", "renewables", "solar", "wind", "green energy"],
  powerline: ["powerline", "power line", "transmission", "utility", "utilities"],
  mining: ["mining", "mines", "mine"],
  railways: ["railway", "railways", "rail"],
  construction: ["construction", "infra", "infrastructure"],
  manufacturing: ["manufacturing", "factory"],
  aviation: ["aviation", "airport"],
  dsp: ["dsp"],
  tender: ["tender"],
  "security and surveillance": ["security", "surveillance"],
  others: ["others", "other", "misc"],
};

/** "energy" is deliberately fuzzy in this dataset — it spans Renewables and Powerline. */
export const ENERGY_SECTORS = ["Renewables", "Powerline"];

export function normalizeSector(raw: string | null): string {
  const t = (raw ?? "").trim();
  if (!t) return "Unspecified";
  const lower = t.toLowerCase();
  for (const [canonical, aliases] of Object.entries(SECTOR_ALIASES)) {
    if (aliases.includes(lower)) {
      return canonical
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ------------------------------------------------------------------ */
/* Deals                                                               */
/* ------------------------------------------------------------------ */

const DEAL_HEADER_TOKENS = ["deal name", "deal status", "deal stage", "closure probability", "masked deal value"];

function normalizeDealStatus(raw: string | null): DealStatus {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return "unknown";
  if (t.startsWith("open")) return "open";
  if (t.startsWith("won") || t.includes("closed won")) return "won";
  if (t.startsWith("dead") || t.includes("lost")) return "dead";
  if (t.replace(/[^a-z]/g, "").startsWith("onhold") || t.includes("hold")) return "on_hold";
  return "unknown";
}

function normalizeProbability(raw: string | null): { band: ProbabilityBand; weight: number | null } {
  const t = (raw ?? "").trim().toLowerCase();
  if (t.startsWith("high")) return { band: "high", weight: 0.75 };
  if (t.startsWith("med")) return { band: "medium", weight: 0.5 };
  if (t.startsWith("low")) return { band: "low", weight: 0.25 };
  return { band: "unknown", weight: null };
}

function normalizeStage(raw: string | null): string {
  const t = (raw ?? "").trim();
  if (!t) return "Unspecified";
  // Source stages are prefixed "A. ", "B. " ... strip the ordering prefix for display grouping.
  return t.replace(/^[A-Z]\.\s*/, "");
}

export function normalizeDeals(rows: MondayRow[]): { deals: Deal[]; quality: DataQualityReport } {
  const deals: Deal[] = [];
  const excluded: { id: string; reason: string }[] = [];
  const missing: Record<string, number> = {};
  const bump = (f: string) => (missing[f] = (missing[f] ?? 0) + 1);

  for (const row of rows) {
    const nameFromColumn = text(pick(row, ["Deal Name"]));
    const dealName = nameFromColumn ?? text(row.itemName);

    // Repeated header rows carried over from the spreadsheet import.
    const statusRaw = text(pick(row, ["Deal Status"]));
    const stageRawValue = text(pick(row, ["Deal Stage"]));
    const looksLikeHeader =
      (dealName && DEAL_HEADER_TOKENS.includes(dealName.toLowerCase())) ||
      (statusRaw && statusRaw.toLowerCase() === "deal status") ||
      (stageRawValue && stageRawValue.toLowerCase() === "deal stage");
    if (looksLikeHeader) {
      excluded.push({ id: row.itemId, reason: "Repeated header row from the source spreadsheet" });
      continue;
    }

    const issues: string[] = [];
    const value = parseNumber(pick(row, ["Masked Deal value", "Masked Deal Value", "Deal Value"]));
    const prob = normalizeProbability(text(pick(row, ["Closure Probability"])));
    const sectorRaw = text(pick(row, ["Sector/service", "Sector / service", "Sector"]));
    const status = normalizeDealStatus(statusRaw);

    if (value === null) {
      issues.push("missing deal value");
      bump("Masked Deal value");
    }
    if (prob.band === "unknown") {
      issues.push("missing closure probability");
      bump("Closure Probability");
    }
    if (!sectorRaw) {
      issues.push("missing sector");
      bump("Sector/service");
    }
    if (status === "unknown") {
      issues.push("unrecognised deal status");
      bump("Deal Status");
    }

    const tentativeCloseDate = parseDate(pick(row, ["Tentative Close Date"]));
    if (!tentativeCloseDate) bump("Tentative Close Date");
    const actualCloseDate = parseDate(pick(row, ["Close Date (A)", "Close Date"]));
    if (!actualCloseDate) bump("Close Date (A)");

    deals.push({
      mondayItemId: row.itemId,
      dealName,
      ownerCode: text(pick(row, ["Owner code", "Owner Code"])),
      clientCode: text(pick(row, ["Client Code"])),
      status,
      statusRaw,
      actualCloseDate,
      closureProbability: prob.band,
      probabilityWeight: prob.weight,
      maskedDealValueInr: value,
      tentativeCloseDate,
      stageRaw: stageRawValue,
      stageNormalized: normalizeStage(stageRawValue),
      productDeal: text(pick(row, ["Product deal", "Product Deal"])),
      sectorRaw,
      sectorNormalized: normalizeSector(sectorRaw),
      createdDate: parseDate(pick(row, ["Created Date"])),
      qualityIssues: issues,
    });
  }

  const warnings: string[] = [];
  if (excluded.length) warnings.push(`${excluded.length} repeated header row(s) excluded from all deal metrics.`);
  if (missing["Masked Deal value"])
    warnings.push(`${missing["Masked Deal value"]} deal(s) have no deal value and are excluded from value-based metrics.`);
  if (missing["Closure Probability"])
    warnings.push(`${missing["Closure Probability"]} deal(s) have no closure probability and are excluded from weighted pipeline.`);
  warnings.push("Deal Name repeats across records, so it is not treated as a unique identifier.");

  return {
    deals,
    quality: {
      board: "Deals",
      totalRecords: rows.length,
      validRecords: deals.length,
      excludedRecords: excluded,
      missingFields: missing,
      warnings,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Work orders                                                         */
/* ------------------------------------------------------------------ */

function normalizeExecutionStatus(raw: string | null): ExecutionStatus {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return "unknown";
  if (t.startsWith("complet")) return "completed";
  if (t.startsWith("ongoing") || t.startsWith("in progress")) return "ongoing";
  if (t.includes("executed until")) return "executed_until_current_month";
  if (t.includes("not started") || t.includes("yet to start")) return "not_started";
  if (t.includes("pause") || t.includes("struck") || t.includes("stuck")) return "paused_or_stuck";
  if (t.includes("partial")) return "partially_completed";
  if (t.includes("details pending")) return "details_pending";
  return "unknown";
}

/** Handles the "BIlled" typo variant and other casing drift. */
function normalizeBillingStatus(raw: string | null): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t === "billed") return "billed";
  if (t.includes("partially")) return "partially billed";
  if (t.includes("not billable")) return "not billable";
  if (t.includes("update required")) return "update required";
  if (t.includes("stuck") || t.includes("struck")) return "stuck";
  return t;
}

export function normalizeWorkOrders(rows: MondayRow[]): {
  workOrders: WorkOrder[];
  quality: DataQualityReport;
} {
  const workOrders: WorkOrder[] = [];
  const excluded: { id: string; reason: string }[] = [];
  const missing: Record<string, number> = {};
  const bump = (f: string) => (missing[f] = (missing[f] ?? 0) + 1);
  const seenSerials = new Set<string>();
  let negativeMonetary = 0;

  for (const row of rows) {
    const serial = text(pick(row, ["Serial #", "Serial#", "Serial No"])) ?? text(row.itemName);
    if (!serial || serial.toLowerCase() === "serial #") {
      excluded.push({ id: row.itemId, reason: "Missing or header-like Serial # identifier" });
      continue;
    }
    if (seenSerials.has(serial)) {
      excluded.push({ id: row.itemId, reason: `Duplicate Serial # ${serial}` });
      continue;
    }
    seenSerials.add(serial);

    const issues: string[] = [];
    const sectorRaw = text(pick(row, ["Sector"]));
    const execRaw = text(pick(row, ["Execution Status"]));
    const executionStatus = normalizeExecutionStatus(execRaw);

    const amountExcl = parseNumber(pick(row, ["Amount in Rupees (Excl of GST) (Masked)"]));
    const amountIncl = parseNumber(pick(row, ["Amount in Rupees (Incl of GST) (Masked)"]));
    const billedExcl = parseNumber(pick(row, ["Billed Value in Rupees (Excl of GST.) (Masked)"]));
    const billedIncl = parseNumber(pick(row, ["Billed Value in Rupees (Incl of GST.) (Masked)"]));
    const collected = parseNumber(pick(row, ["Collected Amount in Rupees (Incl of GST.) (Masked)"]));
    const toBillExcl = parseNumber(pick(row, ["Amount to be billed in Rs. (Exl. of GST) (Masked)"]));
    const receivable = parseNumber(pick(row, ["Amount Receivable (Masked)"]));

    for (const [label, v] of [
      ["amount to be billed", toBillExcl],
      ["amount receivable", receivable],
    ] as const) {
      if (v !== null && v < 0) {
        issues.push(`negative ${label}`);
        negativeMonetary += 1;
      }
    }

    if (amountExcl === null) {
      issues.push("missing contract amount");
      bump("Amount in Rupees (Excl of GST) (Masked)");
    }
    if (executionStatus === "unknown") {
      issues.push("unrecognised execution status");
      bump("Execution Status");
    }
    if (!sectorRaw) {
      issues.push("missing sector");
      bump("Sector");
    }

    const dataDeliveryDate = parseDate(pick(row, ["Data Delivery Date"]));
    if (!dataDeliveryDate) bump("Data Delivery Date");
    const probableEndDate = parseDate(pick(row, ["Probable End Date"]));
    if (!probableEndDate) bump("Probable End Date");
    const probableStartDate = parseDate(pick(row, ["Probable Start Date"]));
    if (!probableStartDate) bump("Probable Start Date");
    if (collected === null) bump("Collected Amount in Rupees (Incl of GST.) (Masked)");

    const woStatusRaw = (text(pick(row, ["WO Status (billed)"])) ?? "").toLowerCase();

    workOrders.push({
      mondayItemId: row.itemId,
      serialNumber: serial,
      dealNameMasked: text(pick(row, ["Deal name masked", "Deal Name Masked"])),
      customerCode: text(pick(row, ["Customer Name Code"])),
      natureOfWork: text(pick(row, ["Nature of Work"])),
      executionStatus,
      executionStatusRaw: execRaw,
      dataDeliveryDate,
      poDate: parseDate(pick(row, ["Date of PO/LOI"])),
      documentType: text(pick(row, ["Document Type"])),
      probableStartDate,
      probableEndDate,
      ownerCode: text(pick(row, ["BD/KAM Personnel code"])),
      sectorRaw,
      sectorNormalized: normalizeSector(sectorRaw),
      typeOfWork: text(pick(row, ["Type of Work"])),
      platformDeliverable:
        text(pick(row, ["Is any Skylark software platform part of the client deliverables in this deal?"]))?.toUpperCase() ??
        "UNKNOWN",
      amountExclGstInr: amountExcl,
      amountInclGstInr: amountIncl,
      billedExclGstInr: billedExcl,
      billedInclGstInr: billedIncl,
      collectedInclGstInr: collected,
      amountToBillExclGstInr: toBillExcl,
      receivableInr: receivable,
      arPriority: /priority/i.test(pick(row, ["AR Priority account"])),
      invoiceStatus: text(pick(row, ["Invoice Status"])),
      woBillingStatus: woStatusRaw.startsWith("closed") ? "closed" : woStatusRaw.startsWith("open") ? "open" : "unknown",
      billingStatus: normalizeBillingStatus(text(pick(row, ["Billing Status"]))),
      lastInvoiceDate: parseDate(pick(row, ["Last invoice date"])),
      qualityIssues: issues,
    });
  }

  const warnings: string[] = [];
  if (missing["Data Delivery Date"])
    warnings.push(
      `${missing["Data Delivery Date"]} work order(s) have no Data Delivery Date, so delay analysis covers only the records that do.`,
    );
  if (missing["Probable End Date"])
    warnings.push(`${missing["Probable End Date"]} work order(s) have no Probable End Date, limiting overdue analysis.`);
  if (negativeMonetary)
    warnings.push(
      `${negativeMonetary} work order(s) carry negative to-bill or receivable values; outstanding totals use positive-only aggregation.`,
    );
  warnings.push(
    "Collection-month and collection-date fields are largely empty in the source, so collection timing is not analysed.",
  );
  warnings.push("Quantity fields mix numbers with units (e.g. HA), so quantity-based metrics are not reported.");

  return {
    workOrders,
    quality: {
      board: "Work Orders",
      totalRecords: rows.length,
      validRecords: workOrders.length,
      excludedRecords: excluded,
      missingFields: missing,
      warnings,
    },
  };
}
