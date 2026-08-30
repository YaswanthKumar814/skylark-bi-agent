import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports configuration presence only — never the values. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    mondayTokenConfigured: Boolean(config.monday.token),
    openaiKeyConfigured: Boolean(config.openai.apiKey),
    dealsBoardIdConfigured: Boolean(config.monday.dealsBoardId),
    workOrdersBoardIdConfigured: Boolean(config.monday.workOrdersBoardId),
    model: config.openai.model,
    mondayApiVersion: config.monday.apiVersion,
  });
}
