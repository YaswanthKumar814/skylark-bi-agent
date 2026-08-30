import { NextResponse } from "next/server";
import { buildAnalytics } from "@/lib/analytics";
import { parseIntent, writeAnswer } from "@/lib/ai";
import { config, ConfigError } from "@/lib/config";
import { loadBusinessData } from "@/lib/data";
import { MondayError } from "@/lib/monday";
import type { ChatResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { message?: unknown; forceRefresh?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Please include a question." }, { status: 400 });
  if (message.length > config.maxPromptLength) {
    return NextResponse.json(
      { error: `Question is too long. Please keep it under ${config.maxPromptLength} characters.` },
      { status: 400 },
    );
  }
  const forceRefresh = body.forceRefresh === true;

  try {
    const [query, loaded] = await Promise.all([parseIntent(message), loadBusinessData(forceRefresh)]);

    if (query.needsClarification && query.clarificationQuestion) {
      const payload: ChatResponse = {
        answer: query.clarificationQuestion,
        intent: query.intent,
        keyMetrics: [],
        insights: [],
        caveats: [],
        recommendedActions: [],
        tables: [],
        dataSources: [],
        dataQuality: loaded.data.quality,
        lastSyncedAt: loaded.data.fetchedAt,
        degraded: loaded.degraded,
      };
      return NextResponse.json(payload);
    }

    const analytics = buildAnalytics(loaded.data, query);
    const { answer } = await writeAnswer(message, analytics);

    const payload: ChatResponse = {
      answer,
      intent: analytics.intent,
      keyMetrics: analytics.metrics,
      insights: analytics.insights,
      caveats: analytics.caveats,
      recommendedActions: analytics.recommendedActions,
      tables: analytics.tables,
      dataSources: analytics.dataSources,
      dataQuality: loaded.data.quality,
      lastSyncedAt: loaded.data.fetchedAt,
      degraded: loaded.degraded,
    };
    return NextResponse.json(payload);
  } catch (err) {
    // User-safe messages only — never stack traces or credentials.
    if (err instanceof ConfigError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof MondayError) return NextResponse.json({ error: err.message }, { status: 502 });
    console.error("chat route failure", err);
    return NextResponse.json(
      { error: "Something went wrong while answering that question. Please try again." },
      { status: 500 },
    );
  }
}
