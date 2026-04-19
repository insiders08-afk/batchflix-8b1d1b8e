/**
 * Day-off detection helper.
 *
 * Replaces 5 separate copies of regex-parsed `announcements` queries scattered
 * across Admin/Teacher attendance pages, the calendar view, and the workspace.
 *
 * The server-side `is_day_off(batch_id, date)` RPC is the canonical check.
 * We add a tiny in-memory cache (60s TTL) so re-renders don't hammer the DB.
 */

import { supabase } from "@/integrations/supabase/client";

const TTL_MS = 60 * 1000;
const cache = new Map<string, { value: boolean; at: number }>();

function cacheKey(batchId: string, date: string): string {
  return `${batchId}::${date}`;
}

/**
 * Check whether `date` (YYYY-MM-DD) is a day-off for `batchId`.
 * Uses the server `is_day_off` RPC; falls back to `false` on any error so the
 * UI never blocks attendance because of a transient lookup failure.
 */
export async function isDayOff(batchId: string, date: string): Promise<boolean> {
  if (!batchId || !date) return false;
  const k = cacheKey(batchId, date);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  try {
    const { data, error } = await supabase.rpc("is_day_off", {
      p_batch_id: batchId,
      p_date: date,
    });
    const value = !!data && !error;
    cache.set(k, { value, at: Date.now() });
    return value;
  } catch {
    return false;
  }
}

/**
 * Force-invalidate the cache for a batch (call after marking/cancelling
 * a day-off so the next read re-fetches).
 */
export function invalidateDayOff(batchId: string, date?: string): void {
  if (date) {
    cache.delete(cacheKey(batchId, date));
    return;
  }
  // Clear every entry for this batch
  for (const key of cache.keys()) {
    if (key.startsWith(`${batchId}::`)) cache.delete(key);
  }
}
