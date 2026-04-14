const PREFIX = "bh_msgs_";
const MAX = 50;

export function saveCachedMessages(key: string, messages: unknown[]) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(messages.slice(-MAX)));
  } catch { /* quota exceeded — ignore */ }
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
