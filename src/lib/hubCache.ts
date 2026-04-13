const PREFIX = "bh_hub_";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  ts: number;
}

export function saveHubCache<T>(key: string, data: T) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded */ }
}

export function loadHubCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    // Stale data is still returned — caller refreshes in background
    return entry.data;
  } catch {
    return null;
  }
}
