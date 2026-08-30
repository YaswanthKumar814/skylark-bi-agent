import { config } from "./config";
import { fetchBoardWithRetry } from "./monday";
import { normalizeDeals, normalizeWorkOrders } from "./normalize";
import type { BusinessData } from "./types";

let cache: BusinessData | null = null;
let cachedAtMs = 0;

export type LoadResult = { data: BusinessData; degraded: string | null };

/**
 * Fetch both boards from monday.com, normalize, and cache in memory.
 * If monday fails but a cache exists, serve stale data with a caveat.
 */
export async function loadBusinessData(forceRefresh = false): Promise<LoadResult> {
  const fresh = cache && Date.now() - cachedAtMs < config.cacheTtlSeconds * 1000;
  if (cache && fresh && !forceRefresh) return { data: cache, degraded: null };

  try {
    const [dealsBoard, workOrdersBoard] = await Promise.all([
      fetchBoardWithRetry(config.monday.dealsBoardId),
      fetchBoardWithRetry(config.monday.workOrdersBoardId),
    ]);

    const { deals, quality: dealQuality } = normalizeDeals(dealsBoard.rows);
    const { workOrders, quality: woQuality } = normalizeWorkOrders(workOrdersBoard.rows);

    cache = {
      fetchedAt: new Date().toISOString(),
      deals,
      workOrders,
      quality: [dealQuality, woQuality],
    };
    cachedAtMs = Date.now();
    return { data: cache, degraded: null };
  } catch (err) {
    if (cache) {
      const reason = err instanceof Error ? err.message : "Unknown monday.com error";
      return {
        data: cache,
        degraded: `Live monday.com fetch failed (${reason}). Showing the last successful snapshot from ${cache.fetchedAt}.`,
      };
    }
    throw err;
  }
}

export function clearCache() {
  cache = null;
  cachedAtMs = 0;
}
