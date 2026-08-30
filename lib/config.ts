// Server-side configuration. Never import this from a client component.

export class ConfigError extends Error {}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  monday: {
    get token() {
      return optional("MONDAY_API_TOKEN");
    },
    get apiVersion() {
      return optional("MONDAY_API_VERSION", "2025-07");
    },
    get dealsBoardId() {
      return optional("MONDAY_DEALS_BOARD_ID", "5030969964");
    },
    get workOrdersBoardId() {
      return optional("MONDAY_WORK_ORDERS_BOARD_ID", "5030970130");
    },
    endpoint: "https://api.monday.com/v2",
  },
  openai: {
    get apiKey() {
      return optional("OPENAI_API_KEY");
    },
    get model() {
      return optional("OPENAI_MODEL", "gpt-4.1-mini");
    },
  },
  get cacheTtlSeconds() {
    const raw = Number(optional("CACHE_TTL_SECONDS", "300"));
    return Number.isFinite(raw) && raw > 0 ? raw : 300;
  },
  maxPromptLength: 1200,
};

/** Throws a user-safe error naming missing configuration (never the value). */
export function assertMondayConfig() {
  const missing: string[] = [];
  if (!config.monday.token) missing.push("MONDAY_API_TOKEN");
  if (!config.monday.dealsBoardId) missing.push("MONDAY_DEALS_BOARD_ID");
  if (!config.monday.workOrdersBoardId) missing.push("MONDAY_WORK_ORDERS_BOARD_ID");
  if (missing.length) {
    throw new ConfigError(
      `monday.com is not configured. Missing environment variable(s): ${missing.join(", ")}.`,
    );
  }
}
