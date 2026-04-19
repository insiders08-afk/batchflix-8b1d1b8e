/**
 * Attendance cache layer.
 *
 * Centralised, TTL-bounded, per-user storage for "today's" attendance grids
 * so the UI can paint instantly during PWA cold-start / offline mode.
 *
 * Why this file exists:
 *  - Two pages (Admin/Teacher) and the Student page were
 *    each rolling their own `localStorage` reads/writes with slightly different
 *    keys and no eviction strategy → caches accumulated forever and leaked
 *    between users on shared devices.
 *  - Cache keys are now namespaced by `userId` so a logout (or another teacher
 *    logging in on the same tablet) cannot see the previous user's grid.
 *  - A 24-hour TTL guarantees stale "yesterday" caches never resurrect.
 */

const PREFIX = "bh_att_v2_";              // versioned to invalidate older keys
const STUDENT_PREFIX = "bh_att_stu_v2_";  // student lifetime cache
const TTL_MS = 24 * 60 * 60 * 1000;        // 24h

// ── Internal helpers ─────────────────────────────────────────────────────────
function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota */ }
}
function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function key(scope: "admin" | "teacher" | "workspace", userId: string, batchId: string): string {
  return `${PREFIX}${scope}_${userId}_${batchId}`;
}

// ── Per-batch "today" cache (admin / teacher / workspace) ────────────────────
export interface TodayAttendanceCache<TStudent> {
  date: string;                              // YYYY-MM-DD
  students: TStudent[];
  attendance: Record<string, "present" | "absent">;
  history: unknown[];                        // shape varies per page; opaque to cache layer
  cachedAt: number;
}

export function readTodayAtt<TStudent>(
  scope: "admin" | "teacher" | "workspace",
  userId: string,
  batchId: string,
  today: string,
): TodayAttendanceCache<TStudent> | null {
  if (!userId || !batchId) return null;
  const raw = safeGet(key(scope, userId, batchId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TodayAttendanceCache<TStudent>;
    if (parsed.date !== today) return null;
    if (Date.now() - parsed.cachedAt > TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

export function writeTodayAtt<TStudent>(
  scope: "admin" | "teacher" | "workspace",
  userId: string,
  batchId: string,
  payload: TodayAttendanceCache<TStudent>,
): void {
  if (!userId || !batchId) return;
  safeSet(key(scope, userId, batchId), JSON.stringify(payload));
}

// ── Student "my attendance" cache (one per user, all batches) ────────────────
export interface StudentAttCache<TBatch, TRecord> {
  userId: string;
  batches: TBatch[];
  records: TRecord[];
  cachedAt: number;
}

export function readStudentAtt<TBatch, TRecord>(
  userId: string,
): StudentAttCache<TBatch, TRecord> | null {
  if (!userId) return null;
  const raw = safeGet(STUDENT_PREFIX + userId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StudentAttCache<TBatch, TRecord>;
    if (parsed.userId !== userId) return null;
    // Student cache TTL is longer (7 days) — historical records don't change
    if (Date.now() - parsed.cachedAt > 7 * 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch { return null; }
}

export function writeStudentAtt<TBatch, TRecord>(
  payload: StudentAttCache<TBatch, TRecord>,
): void {
  if (!payload.userId) return;
  safeSet(STUDENT_PREFIX + payload.userId, JSON.stringify(payload));
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
/**
 * Wipe every attendance cache key from `localStorage`.
 * Called on logout so the next user on a shared device starts clean.
 */
export function purgeAllAttendanceCaches(): void {
  try {
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(PREFIX) || k.startsWith(STUDENT_PREFIX) || k.startsWith("bh_attendance_today_")) {
        remove.push(k);
      }
    }
    remove.forEach(safeRemove);
  } catch { /* ignore */ }
}

/**
 * Boot-time pruning: drop expired entries so storage doesn't grow forever.
 * Call once from `main.tsx` (no-op if storage is unavailable).
 */
export function pruneExpiredAttendanceCaches(): void {
  try {
    const remove: string[] = [];
    const now = Date.now();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!(k.startsWith(PREFIX) || k.startsWith(STUDENT_PREFIX) || k.startsWith("bh_attendance_today_"))) continue;
      const raw = safeGet(k);
      if (!raw) { remove.push(k); continue; }
      try {
        const parsed = JSON.parse(raw) as { cachedAt?: number };
        const age = now - (parsed.cachedAt ?? 0);
        const ttl = k.startsWith(STUDENT_PREFIX) ? 7 * 24 * 60 * 60 * 1000 : TTL_MS;
        if (age > ttl) remove.push(k);
      } catch { remove.push(k); }
    }
    remove.forEach(safeRemove);
  } catch { /* ignore */ }
}
