const PREFIX = "bh_hub_";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  ts: number;
}

export function saveHubCache<T>(key: string, data: T) {
  const write = () => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* quota exceeded */ }
  };
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(write, { timeout: 1000 });
  } else {
    setTimeout(write, 0);
  }
}

export function loadHubCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    // Stale data is still returned — caller refreshes in background
    return entry.data;
  } catch {
    return null;
  }
}

/** Returns true if the cached entry is older than TTL_MS */
export function isHubCacheStale(key: string): boolean {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return true;
    const entry: CacheEntry<unknown> = JSON.parse(raw);
    return Date.now() - entry.ts > TTL_MS;
  } catch {
    return true;
  }
}

/** Wipes all bh_hub_* keys from localStorage — call on logout */
export function clearHubCache() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/** Wipes all bh_msgs_* keys from localStorage — call on logout */
export function clearMessagesCache() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("bh_msgs_")) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
