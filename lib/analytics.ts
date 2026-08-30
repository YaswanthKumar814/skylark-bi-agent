import { inr, num } from "./format";
import { ENERGY_SECTORS, normalizeSector } from "./normalize";
import type {
  AnalyticsResult,
  BusinessData,
  BusinessIntent,
  Deal,
  MetricCard,
  ParsedQuery,
  ResultTable,
  WorkOrder,
} from "./types";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

/** Resolve a user-supplied sector phrase to the canonical sector(s) present in the data. */
export function resolveSectors(
  requested: string | null | undefined,
  present: string[],
): { matches: string[]; note: string | null } {
  if (!requested) return { matches: [], note: null };
  const q = requested.trim().toLowerCase();
  if (!q) return { matches: [], note: null };

  if (/energy|power/.test(q) && !present.some((s) => s.toLowerCase() === q)) {
    const matches = ENERGY_SECTORS.filter((s) => present.includes(s));
    return {
      matches,
      note: matches.length
        ? `"${requested}" is not a sector in the source data; it has been read as ${matches.join(" + ")}.`
        : null,
    };
  }

  const canonical = normalizeSector(requested);
  const exact = present.filter((s) => s.toLowerCase() === canonical.toLowerCase());
  if (exact.length) return { matches: exact, note: null };

  const partial = present.filter((s) => s.toLowerCase().includes(q) || q.includes(s.toLowerCase()));
  if (partial.length) return { matches: partial, note: null };

  return {
    matches: [],
    note: `No sector matching "${requested}" exists in the boards. Sectors available: ${present.join(", ")}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Deal analytics                                                      */
/* ------------------------------------------------------------------ */

export function dealMetrics(deals: Deal[]) {
  const open = deals.filter((d) => d.status === "open");
  const won = deals.filter((d) => d.status === "won");
  const dead = deals.filter((d) => d.status === "dead");
  const onHold = deals.filter((d) => d.status === "on_hold");

  const openValued = open.filter((d) => d.maskedDealValueInr !== null);
  const openPipeline = sum(openValued.map((d) => d.maskedDealValueInr as number));

  const weightedRecords = openValued.filter((d) => d.probabilityWeight !== null);
  const weightedPipeline = sum(
    weightedRecords.map((d) => (d.maskedDealValueInr as number) * (d.probabilityWeight as number)),
  );

  const wonValued = won.filter((d) => d.maskedDealValueInr !== null);
  const wonRevenue = sum(wonValued.map((d) => d.maskedDealValueInr as number));

  return {
    totalDeals: deals.length,
    openCount: open.length,
    wonCount: won.length,
    deadCount: dead.length,
    onHoldCount: onHold.length,
    openPipeline,
    openValuedCount: openValued.length,
    openMissingValueCount: open.length - openValued.length,
    weightedPipeline,
    weightedRecordCount: weightedRecords.length,
    openMissingProbabilityCount: openValued.length - weightedRecords.length,
    averageOpenDealSize: openValued.length ? openPipeline / openValued.length : null,
    wonRevenue,
    wonValuedCount: wonValued.length,
    winRate: won.length + dead.length ? won.length / (won.length + dead.length) : null,
    open,
  };
}

export function pipelineBySector(open: Deal[]) {
  const map = new Map<string, { sector: string; count: number; value: number; missingValue: number }>();
  for (const d of open) {
    const e = map.get(d.sectorNormalized) ?? { sector: d.sectorNormalized, count: 0, value: 0, missingValue: 0 };
    e.count += 1;
    if (d.maskedDealValueInr === null) e.missingValue += 1;
    else e.value += d.maskedDealValueInr;
    map.set(d.sectorNormalized, e);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export function pipelineByStage(open: Deal[]) {
  const map = new Map<string, { stage: string; count: number; value: number }>();
  for (const d of open) {
    const e = map.get(d.stageNormalized) ?? { stage: d.stageNormalized, count: 0, value: 0 };
    e.count += 1;
    e.value += d.maskedDealValueInr ?? 0;
    map.set(d.stageNormalized, e);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

/** Rule-based risk flags on open deals — no LLM scoring. */
export function atRiskDeals(open: Deal[]) {
  const today = todayISO();
  return open
    .map((d) => {
      const reasons: string[] = [];
      if (d.maskedDealValueInr === null) reasons.push("no deal value recorded");
      if (d.closureProbability === "unknown") reasons.push("no closure probability");
      if (!d.tentativeCloseDate) reasons.push("no tentative close date");
      else if (d.tentativeCloseDate < today) reasons.push(`tentative close date passed (${d.tentativeCloseDate})`);
      if (d.closureProbability === "low" && (d.maskedDealValueInr ?? 0) > 0) reasons.push("low closure probability");
      if (!d.sectorRaw) reasons.push("no sector");
      return { deal: d, reasons, weight: (d.maskedDealValueInr ?? 0) * (reasons.length || 0) };
    })
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => (b.deal.maskedDealValueInr ?? 0) - (a.deal.maskedDealValueInr ?? 0));
}

/* ------------------------------------------------------------------ */
/* Work-order analytics                                                */
/* ------------------------------------------------------------------ */

export function workOrderMetrics(workOrders: WorkOrder[]) {
  const today = todayISO();
  const completed = workOrders.filter((w) => w.executionStatus === "completed");
  const active = workOrders.filter((w) =>
    ["ongoing", "executed_until_current_month", "partially_completed", "not_started"].includes(w.executionStatus),
  );
  const paused = workOrders.filter((w) => w.executionStatus === "paused_or_stuck");
  const unknown = workOrders.filter((w) => w.executionStatus === "unknown" || w.executionStatus === "details_pending");

  const delayComparable = workOrders.filter((w) => w.dataDeliveryDate && w.probableEndDate);
  const delayed = delayComparable.filter((w) => (w.dataDeliveryDate as string) > (w.probableEndDate as string));

  const overdueComparable = workOrders.filter((w) => w.executionStatus !== "completed" && w.probableEndDate);
  const overdue = overdueComparable.filter((w) => (w.probableEndDate as string) < today);

  const pos = (v: number | null) => (v !== null && v > 0 ? v : 0);
  const valid = (v: number | null) => (v !== null ? v : 0);

  return {
    total: workOrders.length,
    completed: completed.length,
    active: active.length,
    paused: paused.length,
    unknownStatus: unknown.length,
    delayed: delayed.length,
    delayComparable: delayComparable.length,
    overdue: overdue.length,
    overdueComparable: overdueComparable.length,
    totalContractAmount: sum(workOrders.map((w) => valid(w.amountExclGstInr))),
    contractAmountRecords: workOrders.filter((w) => w.amountExclGstInr !== null).length,
    billedAmount: sum(workOrders.map((w) => valid(w.billedExclGstInr))),
    collectedAmount: sum(workOrders.map((w) => valid(w.collectedInclGstInr))),
    amountToBill: sum(workOrders.map((w) => pos(w.amountToBillExclGstInr))),
    receivables: sum(workOrders.map((w) => pos(w.receivableInr))),
    arPriorityCount: workOrders.filter((w) => w.arPriority).length,
    delayedList: delayed,
    overdueList: overdue,
  };
}

export function workOrdersBySector(workOrders: WorkOrder[]) {
  const map = new Map<
    string,
    { sector: string; count: number; contract: number; billed: number; receivable: number; completed: number }
  >();
  for (const w of workOrders) {
    const e =
      map.get(w.sectorNormalized) ??
      { sector: w.sectorNormalized, count: 0, contract: 0, billed: 0, receivable: 0, completed: 0 };
    e.count += 1;
    e.contract += w.amountExclGstInr ?? 0;
    e.billed += w.billedExclGstInr ?? 0;
    e.receivable += Math.max(w.receivableInr ?? 0, 0);
    if (w.executionStatus === "completed") e.completed += 1;
    map.set(w.sectorNormalized, e);
  }
  return [...map.values()].sort((a, b) => b.contract - a.contract);
}

/* ------------------------------------------------------------------ */
/* Report builders per intent                                          */
/* ------------------------------------------------------------------ */

const DEALS_SOURCE = "monday.com — Deals board";
const WO_SOURCE = "monday.com — Work Orders board";

const CROSS_BOARD_CAVEAT =
  "Cross-board comparison is sector-level only. Deal names repeat and customer codes use different formats on the two boards (COMPANY* vs WOCOMPANY_*), so no row-level deal-to-work-order matching is claimed.";

function dealQualityCaveats(m: ReturnType<typeof dealMetrics>): string[] {
  const c: string[] = [];
  if (m.openMissingValueCount)
    c.push(`${m.openMissingValueCount} open deal(s) have no deal value and are excluded from pipeline totals.`);
  if (m.openMissingProbabilityCount)
    c.push(
      `${m.openMissingProbabilityCount} valued open deal(s) have no closure probability, so weighted pipeline covers ${m.weightedRecordCount} of ${m.openValuedCount} valued open deals.`,
    );
  c.push("Probability weights are assumed: High = 0.75, Medium = 0.5, Low = 0.25.");
  return c;
}

export function buildAnalytics(data: BusinessData, query: ParsedQuery): AnalyticsResult {
  const sectorsPresent = [
    ...new Set([...data.deals.map((d) => d.sectorNormalized), ...data.workOrders.map((w) => w.sectorNormalized)]),
  ].filter((s) => s !== "Unspecified");

  const { matches: sectorMatches, note: sectorNote } = resolveSectors(query.filters.sector, sectorsPresent);
  const sectorFilterActive = sectorMatches.length > 0;

  let deals = data.deals;
  let workOrders = data.workOrders;
  if (sectorFilterActive) {
    deals = deals.filter((d) => sectorMatches.includes(d.sectorNormalized));
    workOrders = workOrders.filter((w) => sectorMatches.includes(w.sectorNormalized));
  }
  if (query.filters.ownerCode) {
    const o = query.filters.ownerCode.toLowerCase();
    deals = deals.filter((d) => (d.ownerCode ?? "").toLowerCase().includes(o));
    workOrders = workOrders.filter((w) => (w.ownerCode ?? "").toLowerCase().includes(o));
  }

  const scopeLabel = sectorFilterActive ? ` (${sectorMatches.join(" + ")})` : "";
  const baseCaveats: string[] = [];
  if (sectorNote) baseCaveats.push(sectorNote);
  if (query.filters.sector && !sectorFilterActive && !sectorNote)
    baseCaveats.push(`Sector filter "${query.filters.sector}" produced no matches; showing all sectors.`);

  const dm = dealMetrics(deals);
  const wm = workOrderMetrics(workOrders);

  const result = (partial: Omit<AnalyticsResult, "intent" | "facts">, facts: Record<string, unknown>): AnalyticsResult => ({
    intent: query.intent,
    ...partial,
    caveats: [...baseCaveats, ...partial.caveats],
    facts,
  });

  switch (query.intent) {
    case "pipeline_summary":
    case "revenue_summary": {
      const bySector = pipelineBySector(dm.open);
      const byStage = pipelineByStage(dm.open);
      const isRevenue = query.intent === "revenue_summary";
      const metrics: MetricCard[] = [
        { label: "Open pipeline", value: inr(dm.openPipeline), hint: `${dm.openValuedCount} valued open deals` },
        { label: "Weighted pipeline", value: inr(dm.weightedPipeline), hint: `${dm.weightedRecordCount} deals with probability` },
        { label: "Avg open deal size", value: inr(dm.averageOpenDealSize) },
        { label: "Won revenue (all time)", value: inr(dm.wonRevenue), hint: `${dm.wonValuedCount} won deals with a value` },
        { label: "Open deals", value: num(dm.openCount) },
        { label: "Win rate", value: dm.winRate === null ? "n/a" : `${Math.round(dm.winRate * 100)}%`, hint: "won / (won + dead)" },
      ];
      const tables: ResultTable[] = [
        {
          title: `Open pipeline by sector${scopeLabel}`,
          columns: ["Sector", "Open deals", "Pipeline value"],
          rows: bySector.map((s) => [s.sector, s.count, inr(s.value)]),
        },
        {
          title: "Open pipeline by stage",
          columns: ["Stage", "Open deals", "Pipeline value"],
          rows: byStage.slice(0, 8).map((s) => [s.stage, s.count, inr(s.value)]),
        },
      ];
      const top = bySector[0];
      return result(
        {
          summary: isRevenue
            ? `Won revenue is ${inr(dm.wonRevenue)} across ${dm.wonValuedCount} valued won deals${scopeLabel}; open pipeline stands at ${inr(dm.openPipeline)}.`
            : `Open pipeline${scopeLabel} is ${inr(dm.openPipeline)} across ${dm.openCount} open deals, weighted to ${inr(dm.weightedPipeline)}.`,
          metrics,
          insights: [
            top ? `${top.sector} leads the open pipeline with ${inr(top.value)} across ${top.count} deals.` : "No open deals in scope.",
            `Weighted pipeline is ${dm.openPipeline ? Math.round((dm.weightedPipeline / dm.openPipeline) * 100) : 0}% of gross open pipeline.`,
            `${dm.wonCount} deals won, ${dm.deadCount} dead, ${dm.onHoldCount} on hold.`,
          ],
          caveats: dealQualityCaveats(dm),
          recommendedActions: [
            dm.openMissingProbabilityCount
              ? `Ask deal owners to set closure probability on the ${dm.openMissingProbabilityCount} open deal(s) missing it — weighted pipeline is understated until then.`
              : "Keep closure probabilities current so the weighted view stays reliable.",
            top ? `Review coverage and capacity for ${top.sector}, the largest open pipeline concentration.` : "Add open deals to build pipeline.",
          ],
          tables,
          dataSources: [DEALS_SOURCE],
        },
        { dealMetrics: dm, bySector, byStage },
      );
    }

    case "sector_analysis": {
      const bySector = pipelineBySector(dm.open);
      const woSector = workOrdersBySector(workOrders);
      const sectors = [...new Set([...bySector.map((s) => s.sector), ...woSector.map((s) => s.sector)])];
      const rows = sectors.map((s) => {
        const d = bySector.find((x) => x.sector === s);
        const w = woSector.find((x) => x.sector === s);
        return [s, d?.count ?? 0, inr(d?.value ?? 0), w?.count ?? 0, inr(w?.contract ?? 0)];
      });
      const top = bySector[0];
      return result(
        {
          summary: top
            ? `${top.sector} has the strongest open pipeline at ${inr(top.value)} across ${top.count} open deals.`
            : "There are no open deals in scope to rank by sector.",
          metrics: [
            { label: "Strongest sector", value: top?.sector ?? "n/a", hint: top ? inr(top.value) : undefined },
            { label: "Open pipeline in scope", value: inr(dm.openPipeline) },
            { label: "Sectors with open deals", value: num(bySector.length) },
            { label: "Work orders in scope", value: num(wm.total) },
          ],
          insights: [
            ...bySector.slice(0, 3).map((s) => `${s.sector}: ${inr(s.value)} open pipeline across ${s.count} deals.`),
            woSector[0] ? `Delivery load is heaviest in ${woSector[0].sector} (${woSector[0].count} work orders, ${inr(woSector[0].contract)} contracted).` : "",
          ].filter(Boolean),
          caveats: [...dealQualityCaveats(dm), CROSS_BOARD_CAVEAT],
          recommendedActions: [
            top ? `Confirm delivery capacity in ${top.sector} before pushing more deals through.` : "Build sector coverage.",
          ],
          tables: [
            {
              title: `Pipeline vs execution by sector${scopeLabel}`,
              columns: ["Sector", "Open deals", "Open pipeline", "Work orders", "Contracted value"],
              rows,
            },
          ],
          dataSources: [DEALS_SOURCE, WO_SOURCE],
        },
        { bySector, woSector, dealMetrics: dm, workOrderMetrics: wm },
      );
    }

    case "work_order_operations": {
      const bySector = workOrdersBySector(workOrders);
      return result(
        {
          summary: `${wm.total} work orders in scope${scopeLabel}: ${wm.completed} completed, ${wm.active} active, ${wm.overdue} overdue and ${wm.delayed} delivered after the probable end date.`,
          metrics: [
            { label: "Total work orders", value: num(wm.total) },
            { label: "Completed", value: num(wm.completed) },
            { label: "Active", value: num(wm.active), hint: "ongoing, partial, not started" },
            { label: "Overdue (proxy)", value: num(wm.overdue), hint: `of ${wm.overdueComparable} with an end date` },
            { label: "Delayed (proxy)", value: num(wm.delayed), hint: `of ${wm.delayComparable} with both dates` },
            { label: "Contracted value", value: inr(wm.totalContractAmount) },
            { label: "Billed", value: inr(wm.billedAmount) },
            { label: "Collected", value: inr(wm.collectedAmount) },
            { label: "Yet to bill", value: inr(wm.amountToBill) },
            { label: "Receivables", value: inr(wm.receivables), hint: `${wm.arPriorityCount} AR-priority accounts` },
          ],
          insights: [
            `Billing coverage is ${wm.totalContractAmount ? Math.round((wm.billedAmount / wm.totalContractAmount) * 100) : 0}% of contracted value.`,
            `${wm.paused} work order(s) are paused or stuck; ${wm.unknownStatus} have no usable execution status.`,
            bySector[0] ? `${bySector[0].sector} carries the largest delivery load (${bySector[0].count} work orders).` : "",
          ].filter(Boolean),
          caveats: [
            "Delay is a proxy: it counts work orders whose Data Delivery Date is later than the Probable End Date. Records missing either date cannot be assessed.",
            "Overdue is a proxy: not-completed work orders whose Probable End Date is in the past.",
            "Outstanding billing and receivables use positive-only aggregation because the source contains negative values.",
          ],
          recommendedActions: [
            wm.overdue ? `Run a delivery review on the ${wm.overdue} overdue work order(s).` : "Delivery dates are on track in scope.",
            wm.receivables > 0 ? `Chase ${inr(wm.receivables)} of receivables, prioritising the ${wm.arPriorityCount} flagged AR-priority accounts.` : "No open receivables in scope.",
          ],
          tables: [
            {
              title: "Work orders by sector",
              columns: ["Sector", "Work orders", "Completed", "Contracted", "Receivable"],
              rows: bySector.map((s) => [s.sector, s.count, s.completed, inr(s.contract), inr(s.receivable)]),
            },
            {
              title: "Overdue work orders (top 10 by value)",
              columns: ["Serial #", "Sector", "Status", "Probable end", "Contracted"],
              rows: wm.overdueList
                .slice()
                .sort((a, b) => (b.amountExclGstInr ?? 0) - (a.amountExclGstInr ?? 0))
                .slice(0, 10)
                .map((w) => [w.serialNumber, w.sectorNormalized, w.executionStatusRaw ?? "unknown", w.probableEndDate ?? "n/a", inr(w.amountExclGstInr)]),
            },
          ],
          dataSources: [WO_SOURCE],
        },
        { workOrderMetrics: wm, bySector },
      );
    }

    case "risk_summary": {
      const risks = atRiskDeals(dm.open);
      const highValueLowProb = risks.filter((r) => r.deal.closureProbability === "low").length;
      const reasonCounts = new Map<string, number>();
      for (const r of risks)
        for (const reason of r.reasons) {
          const label = reason.startsWith("tentative close date passed") ? "tentative close date already passed" : reason;
          reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
        }
      const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      return result(
        {
          summary: `${risks.length} of ${dm.openCount} open deals carry at least one risk flag, together with ${wm.overdue} overdue work order(s) and ${inr(wm.receivables)} in receivables.`,
          metrics: [
            { label: "Open deals flagged", value: `${risks.length} / ${dm.openCount}` },
            { label: "Missing deal value", value: num(dm.openMissingValueCount) },
            { label: "Missing probability", value: num(dm.openMissingProbabilityCount) },
            { label: "Low-probability deals", value: num(highValueLowProb) },
            { label: "Overdue work orders", value: num(wm.overdue) },
            { label: "Receivables", value: inr(wm.receivables) },
          ],
          insights: [
            risks[0]
              ? `Largest flagged deal: ${risks[0].deal.dealName ?? "unnamed"} (${risks[0].deal.sectorNormalized}, ${inr(risks[0].deal.maskedDealValueInr)}) — ${risks[0].reasons.join("; ")}.`
              : "No open deals are currently flagged.",
            topReasons.length
              ? `Most common flags: ${topReasons.map(([r, c]) => `${r} (${c} deals)`).join(", ")}.`
              : "",
            `Risk flags here are rule-based (missing value, missing probability, stale or missing close date, low probability), not a predictive score.`,
          ].filter(Boolean),
          caveats: [
            ...dealQualityCaveats(dm),
            "Risk flags reflect data completeness and dates, not deal sentiment or competitive position.",
            CROSS_BOARD_CAVEAT,
          ],
          recommendedActions: [
            "Clean up the flagged open deals in monday.com so pipeline forecasting stops being understated.",
            wm.overdue ? `Escalate the ${wm.overdue} overdue work order(s) with delivery owners.` : "Delivery timelines look clear.",
          ],
          tables: [
            {
              title: "At-risk open deals (top 10 by value)",
              columns: ["Deal", "Sector", "Value", "Probability", "Tentative close", "Flags"],
              rows: risks
                .slice(0, 10)
                .map((r) => [
                  r.deal.dealName ?? "unnamed",
                  r.deal.sectorNormalized,
                  inr(r.deal.maskedDealValueInr),
                  r.deal.closureProbability,
                  r.deal.tentativeCloseDate ?? "missing",
                  r.reasons.join("; "),
                ]),
            },
          ],
          dataSources: [DEALS_SOURCE, WO_SOURCE],
        },
        { riskCount: risks.length, dealMetrics: dm, workOrderMetrics: wm },
      );
    }

    case "leadership_update": {
      const bySector = pipelineBySector(dm.open);
      const woSector = workOrdersBySector(workOrders);
      const risks = atRiskDeals(dm.open);
      const top = bySector[0];
      const billingCoverage = wm.totalContractAmount ? Math.round((wm.billedAmount / wm.totalContractAmount) * 100) : 0;
      return result(
        {
          summary: `Leadership update${scopeLabel}: ${inr(dm.openPipeline)} open pipeline (${inr(dm.weightedPipeline)} weighted), ${inr(dm.wonRevenue)} won to date, ${wm.total} work orders with ${inr(wm.receivables)} outstanding receivables.`,
          metrics: [
            { label: "Open pipeline", value: inr(dm.openPipeline), hint: `${dm.openCount} open deals` },
            { label: "Weighted pipeline", value: inr(dm.weightedPipeline) },
            { label: "Won revenue", value: inr(dm.wonRevenue) },
            { label: "Win rate", value: dm.winRate === null ? "n/a" : `${Math.round(dm.winRate * 100)}%` },
            { label: "Work orders", value: num(wm.total), hint: `${wm.completed} completed, ${wm.active} active` },
            { label: "Overdue work orders", value: num(wm.overdue) },
            { label: "Billed / contracted", value: `${billingCoverage}%`, hint: `${inr(wm.billedAmount)} of ${inr(wm.totalContractAmount)}` },
            { label: "Receivables", value: inr(wm.receivables) },
          ],
          insights: [
            `HIGHLIGHT: ${top ? `${top.sector} carries the strongest open pipeline at ${inr(top.value)}` : "pipeline is concentrated in a single sector"}, and ${dm.wonCount} deals have been won to date at a ${dm.winRate === null ? "n/a" : Math.round(dm.winRate * 100) + "%"} win rate.`,
            `MAJOR RISK: ${risks.length} of ${dm.openCount} open deals carry data or timing risk flags, and ${inr(wm.receivables)} of receivables remain outstanding across ${wm.arPriorityCount} AR-priority accounts.`,
            `OPERATIONAL CONCERN: ${wm.overdue} work order(s) are past their probable end date and ${wm.paused} are paused or stuck; billing coverage sits at ${billingCoverage}% of contracted value with ${inr(wm.amountToBill)} still to bill.`,
            woSector[0] ? `DELIVERY MIX: ${woSector[0].sector} accounts for the largest delivery load with ${woSector[0].count} work orders.` : "",
          ].filter(Boolean),
          caveats: [
            ...dealQualityCaveats(dm),
            "Delay and overdue figures are proxies derived from probable end dates and delivery dates; many work orders lack these dates.",
            CROSS_BOARD_CAVEAT,
          ],
          recommendedActions: [
            `Close the data gaps on ${dm.openMissingValueCount + dm.openMissingProbabilityCount} open deal(s) so the weighted forecast can be trusted at board level.`,
            wm.receivables > 0 ? `Set a collection target against ${inr(wm.receivables)} of receivables this month.` : "Maintain current collection cadence.",
            wm.overdue ? `Review the ${wm.overdue} overdue work order(s) with delivery leads and re-baseline dates in monday.com.` : "Re-baseline delivery dates as projects progress.",
          ],
          tables: [
            {
              title: "Pipeline vs execution by sector",
              columns: ["Sector", "Open deals", "Open pipeline", "Work orders", "Contracted"],
              rows: [...new Set([...bySector.map((s) => s.sector), ...woSector.map((s) => s.sector)])].map((s) => {
                const d = bySector.find((x) => x.sector === s);
                const w = woSector.find((x) => x.sector === s);
                return [s, d?.count ?? 0, inr(d?.value ?? 0), w?.count ?? 0, inr(w?.contract ?? 0)];
              }),
            },
          ],
          dataSources: [DEALS_SOURCE, WO_SOURCE],
        },
        { dealMetrics: dm, workOrderMetrics: wm, riskCount: risks.length },
      );
    }

    case "data_quality_summary": {
      return result(
        {
          summary: `Data quality across both boards: ${data.deals.length} usable deals and ${data.workOrders.length} usable work orders after cleanup.`,
          metrics: [
            { label: "Deals loaded", value: num(data.quality[0]?.validRecords ?? data.deals.length), hint: `${data.quality[0]?.excludedRecords.length ?? 0} excluded` },
            { label: "Work orders loaded", value: num(data.quality[1]?.validRecords ?? data.workOrders.length), hint: `${data.quality[1]?.excludedRecords.length ?? 0} excluded` },
            { label: "Open deals missing value", value: num(dm.openMissingValueCount) },
            { label: "Open deals missing probability", value: num(dm.openMissingProbabilityCount) },
          ],
          insights: data.quality.flatMap((q) => q.warnings).slice(0, 6),
          caveats: [CROSS_BOARD_CAVEAT],
          recommendedActions: ["Fix the highest-count missing fields in monday.com first — they gate the pipeline and delivery metrics."],
          tables: data.quality.map((q) => ({
            title: `${q.board}: missing field counts`,
            columns: ["Field", "Records missing"],
            rows: Object.entries(q.missingFields)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([f, c]) => [f, c]),
          })),
          dataSources: [DEALS_SOURCE, WO_SOURCE],
        },
        { quality: data.quality },
      );
    }

    default: {
      return result(
        {
          summary:
            "I can answer questions about sales pipeline, revenue, sector performance, work-order execution, delays and overdue projects, risk, cross-board sector comparison, data quality, and leadership updates.",
          metrics: [],
          insights: [
            "Try: \"How is our pipeline looking?\"",
            "Try: \"How many projects are delayed or overdue?\"",
            "Try: \"Give me a leadership update.\"",
          ],
          caveats: ["This agent reads only the monday.com Deals and Work Orders boards; it has no other data source."],
          recommendedActions: [],
          tables: [],
          dataSources: [DEALS_SOURCE, WO_SOURCE],
        },
        {},
      );
    }
  }
}

export const INTENTS: BusinessIntent[] = [
  "pipeline_summary",
  "sector_analysis",
  "work_order_operations",
  "revenue_summary",
  "risk_summary",
  "leadership_update",
  "data_quality_summary",
  "unsupported",
];
