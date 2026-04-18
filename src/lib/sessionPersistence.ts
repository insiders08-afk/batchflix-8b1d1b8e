/**
 * Session persistence helper.
 *
 * Centralises the "remember me" vs "session only" decision so that the
 * offline cold-start path in Index.tsx and AuthContext can make a reliable
 * call without depending on `sessionStorage` (which is wiped when the PWA
 * process is killed — the exact scenario where we most need the cached
 * identity to survive).
 *
 * Two flags are stored, both in localStorage so they survive PWA kills:
 *   - bh_remember_me:        "true" when user ticked "Remember me".
 *   - bh_session_expires_at: epoch ms; identity is trusted for offline
 *                            restore until this timestamp.
 *
 * For "session only" logins we still set an expiry (24h) so users opening
 * the PWA the next morning don't get bounced back to the role-select page
 * just because the OS evicted the in-memory session.
 *
 * Legacy keys (`batchhub_remember_me`, `batchhub_session_only` in
 * sessionStorage) are still read for backward compatibility with users
 * who logged in before this change shipped.
 */

const REMEMBER_KEY = "bh_remember_me";
const EXPIRES_AT_KEY = "bh_session_expires_at";

const LEGACY_REMEMBER_KEY = "batchhub_remember_me";
const LEGACY_SESSION_ONLY_KEY = "batchhub_session_only";

const SESSION_ONLY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const REMEMBER_ME_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90d

function safeLocalGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLocalSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore quota */ }
}
function safeLocalRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
function safeSessionGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeSessionRemove(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Mark this device as a trusted session.
 *
 * @param rememberMe true when the user ticked "Remember me" → 90 day TTL.
 *                   false → 24h TTL (still survives PWA kills).
 */
export function markSessionPersisted(rememberMe: boolean): void {
  const ttl = rememberMe ? REMEMBER_ME_TTL_MS : SESSION_ONLY_TTL_MS;
  safeLocalSet(REMEMBER_KEY, rememberMe ? "true" : "false");
  safeLocalSet(EXPIRES_AT_KEY, String(Date.now() + ttl));

  // Clear legacy flags so we don't read stale state.
  safeLocalRemove(LEGACY_REMEMBER_KEY);
  safeSessionRemove(LEGACY_SESSION_ONLY_KEY);
}

/**
 * Returns true when we should trust the cached identity for fast-path /
 * offline restore. Reads new keys first, then falls back to legacy keys.
 */
export function isSessionPersisted(): boolean {
  const expiresAtRaw = safeLocalGet(EXPIRES_AT_KEY);
  if (expiresAtRaw) {
    const expiresAt = Number(expiresAtRaw);
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return true;
    // expired — clean up
    safeLocalRemove(EXPIRES_AT_KEY);
    safeLocalRemove(REMEMBER_KEY);
  }

  // Legacy fallback: pre-migration users still get a smooth restore.
  const legacyRemember = safeLocalGet(LEGACY_REMEMBER_KEY) === "true";
  const legacySessionOnly = safeSessionGet(LEGACY_SESSION_ONLY_KEY) === "true";
  return legacyRemember || legacySessionOnly;
}

/**
 * True when the user explicitly opted into long-lived persistence.
 * Used by code that wants to differentiate "remember me" from "session only".
 */
export function isLongLivedSession(): boolean {
  if (safeLocalGet(REMEMBER_KEY) === "true") return true;
  return safeLocalGet(LEGACY_REMEMBER_KEY) === "true";
}

/**
 * Wipe all persistence flags (called on signOut).
 */
export function clearSessionPersistence(): void {
  safeLocalRemove(REMEMBER_KEY);
  safeLocalRemove(EXPIRES_AT_KEY);
  safeLocalRemove(LEGACY_REMEMBER_KEY);
  safeSessionRemove(LEGACY_SESSION_ONLY_KEY);
}
