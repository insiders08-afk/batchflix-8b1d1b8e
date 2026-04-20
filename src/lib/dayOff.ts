/**
 * Day-off detection helper — single source of truth for day-off lookups.
 *
 * Replaces 5 separate copies of regex-parsed `announcements` queries scattered
 * across Admin/Teacher attendance pages, the calendar view, and the workspace.
 *
 * The server-side `is_day_off(batch_id, date)` RPC is the canonical check.
 * We add a tiny in-memory cache (60s TTL) so re-renders don't hammer the DB.
 *
 * Also exposes `loadDayOffDatesForBatch` which returns the *set* of all
 * announced day-off dates for a batch (parsed from the machine-readable
 * `day_off_date:YYYY-MM-DD` tag, with a title fallback for legacy rows).
 */

import { supabase } from "@/integrations/supabase/client";

const TTL_MS = 60 * 1000;
const cache = new Map<string, { value: boolean; at: number }>();
const setCache = new Map<string, { value: Set<string>; at: number }>();

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

const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];

/**
 * Return the set of all YYYY-MM-DD dates marked as day-off for `batchId`.
 * Cached for 60s to avoid hammering announcements on rapid re-renders.
 */
export async function loadDayOffDatesForBatch(batchId: string): Promise<Set<string>> {
  if (!batchId) return new Set();
  const hit = setCache.get(batchId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const { data } = await supabase
    .from("announcements")
    .select("content, title")
    .eq("batch_id", batchId)
    .eq("type", "day_off");

  const dates = new Set<string>();
  (data || []).forEach((ann) => {
    const tagMatch = (ann.content || "").match(/day_off_date:(\d{4}-\d{2}-\d{2})/);
    if (tagMatch) {
      dates.add(tagMatch[1]);
      return;
    }
    const titleMatch = (ann.title || "").match(
      /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
    );
    if (titleMatch) {
      const day = parseInt(titleMatch[1]);
      const monthIdx = MONTHS.indexOf(titleMatch[2].toLowerCase());
      const year = parseInt(titleMatch[3]);
      if (monthIdx !== -1) {
        dates.add(
          `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        );
      }
    }
  });

  setCache.set(batchId, { value: dates, at: Date.now() });
  return dates;
}

/**
 * Force-invalidate the cache for a batch (call after marking/cancelling
 * a day-off so the next read re-fetches).
 */
export function invalidateDayOff(batchId: string, date?: string): void {
  setCache.delete(batchId);
  if (date) {
    cache.delete(cacheKey(batchId, date));
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${batchId}::`)) cache.delete(key);
  }
}

/**
 * Return today's date in the *user's local* timezone as YYYY-MM-DD.
 * Replaces `new Date().toISOString().split("T")[0]`, which returns UTC
 * and produces tomorrow's date for users east of UTC after ~5:30 AM IST.
 */
export function getLocalTodayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
