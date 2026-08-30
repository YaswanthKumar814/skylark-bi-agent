"use client";

import { useState } from "react";
import type { ChatResponse } from "@/lib/types";

export function MetricGrid({ metrics }: { metrics: ChatResponse["keyMetrics"] }) {
  if (!metrics.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">{m.label}</div>
          <div className="mt-0.5 text-lg font-semibold text-slate-100">{m.value}</div>
          {m.hint ? <div className="mt-0.5 text-[11px] text-slate-500">{m.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function DataTable({ table }: { table: ChatResponse["tables"][number] }) {
  if (!table.rows.length) return null;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-3 py-2 text-xs font-medium text-slate-300">{table.title}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              {table.columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {table.rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-800/70">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 align-top">
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AnswerCard({ data }: { data: ChatResponse }) {
  const [showQuality, setShowQuality] = useState(false);

  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-100">{data.answer}</p>

      <MetricGrid metrics={data.keyMetrics} />

      {data.insights.length > 0 && (
        <ul className="space-y-1 text-[13px] text-slate-300">
          {data.insights.map((i, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-sky-400" />
              <span>{i}</span>
            </li>
          ))}
        </ul>
      )}

      {data.tables.map((t) => (
        <DataTable key={t.title} table={t} />
      ))}

      {data.recommendedActions.length > 0 && (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-400">Recommended actions</div>
          <ul className="mt-1 space-y-1 text-[13px] text-emerald-100/90">
            {data.recommendedActions.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </div>
      )}

      {data.caveats.length > 0 && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/25 px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-amber-400">Data quality &amp; caveats</div>
          <ul className="mt-1 space-y-1 text-[13px] text-amber-100/85">
            {data.caveats.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {data.dataSources.map((s) => (
          <span key={s} className="rounded border border-slate-800 px-1.5 py-0.5">
            {s}
          </span>
        ))}
        <span>Last synced {new Date(data.lastSyncedAt).toLocaleString()}</span>
        {data.dataQuality.length > 0 && (
          <button onClick={() => setShowQuality((v) => !v)} className="underline underline-offset-2 hover:text-slate-300">
            {showQuality ? "Hide" : "Show"} board data-quality report
          </button>
        )}
      </div>

      {showQuality && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[12px] text-slate-400">
          {data.dataQuality.map((q) => (
            <div key={q.board}>
              <div className="font-medium text-slate-300">
                {q.board}: {q.validRecords} usable of {q.totalRecords} rows ({q.excludedRecords.length} excluded)
              </div>
              <ul className="mt-1 space-y-0.5">
                {q.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
              {Object.keys(q.missingFields).length > 0 && (
                <div className="mt-1 text-slate-500">
                  Missing-field counts:{" "}
                  {Object.entries(q.missingFields)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([f, c]) => `${f} (${c})`)
                    .join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
