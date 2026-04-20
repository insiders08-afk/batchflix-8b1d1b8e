const PREFIX = "bh_msgs_";
const MAX = 50;

/**
 * Persist immediately.
 *
 * The earlier idle/deferred write path could be skipped if the user opened a
 * thread and quickly backgrounded/closed the app before the idle callback ran,
 * which made offline re-opens show blank histories even though the UI shell was
 * cached. These payloads are intentionally small (latest 50 messages only), so
 * a direct write is the safer trade-off.
 */
function persistNow(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* quota */ }
}

export function saveCachedMessages(key: string, messages: unknown[]) {
  try {
    persistNow(PREFIX + key, JSON.stringify(messages.slice(-MAX)));
  } catch { /* serialize failure — ignore */ }
}

export function loadCachedMessages<T = unknown>(key: string): T[] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearCachedMessages(key: string) {
  localStorage.removeItem(PREFIX + key);
}
