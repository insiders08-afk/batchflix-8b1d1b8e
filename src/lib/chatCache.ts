const PREFIX = "bh_msgs_";
const MAX = 50;

/** Defer setItem so it never blocks the message-render frame. */
function deferredSet(key: string, value: string) {
  const write = () => {
    try { localStorage.setItem(key, value); } catch { /* quota */ }
  };
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(write, { timeout: 1000 });
  } else {
    setTimeout(write, 0);
  }
}

export function saveCachedMessages(key: string, messages: unknown[]) {
  try {
    deferredSet(PREFIX + key, JSON.stringify(messages.slice(-MAX)));
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
