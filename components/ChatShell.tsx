"use client";

import { useEffect, useRef, useState } from "react";
import AnswerCard from "./AnswerCard";
import type { ChatResponse } from "@/lib/types";

type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; data: ChatResponse }
  | { role: "error"; text: string };

const EXAMPLES = [
  "How is our pipeline looking?",
  "Which sector has the strongest open pipeline?",
  "How much business do we have in renewables?",
  "Which deals are at risk?",
  "How many projects are delayed or overdue?",
  "Compare sales pipeline and execution by sector.",
  "Give me a leadership update.",
];

export default function ChatShell() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ask(question: string, forceRefresh = false) {
    const q = question.trim();
    if (!q || loading) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setLoading(true);
    setDegraded(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, forceRefresh }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { role: "error", text: body?.error ?? "Request failed." }]);
      } else {
        const data = body as ChatResponse;
        setLastSynced(data.lastSyncedAt);
        setDegraded(data.degraded ?? null);
        setMessages((m) => [...m, { role: "assistant", data }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "error", text: "Could not reach the agent. Please check your connection and retry." }]);
    } finally {
      setLoading(false);
    }
  }

  function refresh() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user") as { text: string } | undefined;
    ask(lastUser?.text ?? "Give me a leadership update.", true);
  }

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 py-4">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-slate-100">Skylark BI Agent</h1>
          <p className="text-[11px] text-slate-500">Live from monday.com — Deals &amp; Work Orders (read-only)</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          {lastSynced && <span>Synced {new Date(lastSynced).toLocaleTimeString()}</span>}
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500 disabled:opacity-40"
          >
            Refresh
          </button>
        </div>
      </header>

      {degraded && (
        <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-200">
          {degraded}
        </div>
      )}

      <main className="flex-1 space-y-5 py-6">
        {empty && (
          <div className="space-y-5 pt-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-100">
                Ask anything about pipeline and delivery.
              </h2>
              <p className="mt-2 max-w-xl text-sm text-slate-400">
                Metrics are calculated deterministically in code from live monday.com boards. The model only interprets your
                question and explains the result — it never does the arithmetic.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  onClick={() => ask(e)}
                  className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[13px] text-slate-300 transition hover:border-sky-700 hover:text-sky-200"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-sky-600/90 px-3.5 py-2 text-[14px] text-white">
                  {m.text}
                </div>
              </div>
            );
          }
          if (m.role === "error") {
            return (
              <div key={i} className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2.5 text-[13px] text-rose-200">
                {m.text}
              </div>
            );
          }
          return (
            <div key={i} className="rounded-2xl rounded-bl-sm border border-slate-800 bg-slate-900/30 p-4">
              <AnswerCard data={m.data} />
            </div>
          );
        })}

        {loading && (
          <div className="flex items-center gap-2 text-[13px] text-slate-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
            Reading monday.com, computing metrics…
          </div>
        )}
        <div ref={endRef} />
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="sticky bottom-0 border-t border-slate-800 bg-[#0b0f14] py-3"
      >
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. How is our pipeline looking?"
            maxLength={1200}
            className="flex-1 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-[14px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-700"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-sky-600 px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
          >
            Ask
          </button>
        </div>
        {!empty && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.slice(0, 4).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => ask(e)}
                className="rounded-full border border-slate-800 px-2.5 py-1 text-[11px] text-slate-500 hover:border-slate-600 hover:text-slate-300"
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
