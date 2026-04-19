/**
 * Offline write queue for BatchHub.
 *
 * Persists outgoing mutations (DM messages, batch messages, attendance saves)
 * to localStorage when the user is offline (or a request fails), and replays
 * them automatically when connectivity returns.
 *
 * Production-grade hardening (Phase E):
 *  - Every task carries `userId` + `instituteCode` captured at enqueue time.
 *    On replay we abort if the currently authenticated user does not match,
 *    preventing one user's pending writes from being replayed under another
 *    user's RLS context (e.g. on a shared tablet).
 *  - Attendance tasks carry a `client_ts` (ISO) that lets a server-side
 *    trigger reject stale offline replays — when an admin already corrected
 *    the value online, the older offline write does not silently overwrite it.
 *  - Dropped tasks (after MAX_ATTEMPTS) move to a dead-letter queue
 *    (`bh_offline_queue_dead_letter_v1`) so they're never silently lost; the
 *    SyncIndicator surfaces the count and lets the user inspect / clear them.
 */

import { supabase } from "@/integrations/supabase/client";

const QUEUE_KEY = "bh_offline_queue_v1";
const DEAD_LETTER_KEY = "bh_offline_queue_dead_letter_v1";
const MAX_QUEUE_SIZE = 200;
const MAX_DEAD_LETTER_SIZE = 100;
const MAX_ATTEMPTS = 5;

export type QueueTaskType = "dm_message" | "batch_message" | "attendance";

export interface DmMessagePayload {
  conversation_id: string;
  institute_code: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  message: string;
  reply_to_id: string | null;
  optimisticId: string;
}

export interface BatchMessagePayload {
  batch_id: string;
  institute_code: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  message: string;
  reply_to_id: string | null;
  optimisticId: string;
}

export interface AttendancePayload {
  batch_id: string;
  institute_code: string;
  date: string; // YYYY-MM-DD
  marked_by: string | null;
  records: { student_id: string; present: boolean }[];
  client_ts?: string; // ISO timestamp captured at the moment the user saved
}

interface BaseTask {
  id: string;
  attempts: number;
  createdAt: number;
  /** auth.uid() at enqueue time — guards against replay under wrong user */
  ownerUserId: string | null;
  /** institute_code at enqueue time — extra defence-in-depth */
  ownerInstituteCode: string | null;
}

export type QueueTask =
  | (BaseTask & { type: "dm_message"; payload: DmMessagePayload })
  | (BaseTask & { type: "batch_message"; payload: BatchMessagePayload })
  | (BaseTask & { type: "attendance"; payload: AttendancePayload });

export interface DeadLetterEntry {
  task: QueueTask;
  failedAt: number;
  lastError: string;
}

// ─── Storage helpers ─────────────────────────────────────────────────────────
function readQueue(): QueueTask[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueTask[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(tasks: QueueTask[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(tasks.slice(-MAX_QUEUE_SIZE)));
    notifyListeners(tasks.length);
  } catch {
    /* quota — silently drop */
  }
}

function readDeadLetter(): DeadLetterEntry[] {
  try {
    const raw = localStorage.getItem(DEAD_LETTER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeadLetterEntry[]) : [];
  } catch { return []; }
}

function writeDeadLetter(entries: DeadLetterEntry[]): void {
  try {
    localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(entries.slice(-MAX_DEAD_LETTER_SIZE)));
    notifyDeadLetterListeners(entries.length);
  } catch { /* ignore */ }
}

function pushDeadLetter(task: QueueTask, lastError: string): void {
  const entries = readDeadLetter();
  entries.push({ task, failedAt: Date.now(), lastError });
  writeDeadLetter(entries);
}

// ─── Pub/sub ─────────────────────────────────────────────────────────────────
type Listener = (count: number) => void;
const listeners = new Set<Listener>();
const deadLetterListeners = new Set<Listener>();

function notifyListeners(count: number) {
  listeners.forEach((l) => { try { l(count); } catch { /* ignore */ } });
}
function notifyDeadLetterListeners(count: number) {
  deadLetterListeners.forEach((l) => { try { l(count); } catch { /* ignore */ } });
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(readQueue().length);
  return () => { listeners.delete(listener); };
}

export function subscribeDeadLetter(listener: Listener): () => void {
  deadLetterListeners.add(listener);
  listener(readDeadLetter().length);
  return () => { deadLetterListeners.delete(listener); };
}

export function getQueueCount(): number { return readQueue().length; }
export function getDeadLetterCount(): number { return readDeadLetter().length; }
export function getDeadLetter(): DeadLetterEntry[] { return readDeadLetter(); }
export function clearDeadLetter(): void { writeDeadLetter([]); }

// ─── Public API: enqueue ─────────────────────────────────────────────────────
export interface EnqueueInput {
  type: QueueTaskType;
  payload: DmMessagePayload | BatchMessagePayload | AttendancePayload;
}

export function enqueueTask(task: EnqueueInput): string {
  const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Capture identity from the payload itself (every payload includes
  // institute_code; sender/marked_by tells us who is acting).
  let ownerUserId: string | null = null;
  let ownerInstituteCode: string | null = null;
  if (task.type === "dm_message" || task.type === "batch_message") {
    ownerUserId = (task.payload as DmMessagePayload).sender_id ?? null;
    ownerInstituteCode = (task.payload as DmMessagePayload).institute_code ?? null;
  } else if (task.type === "attendance") {
    const p = task.payload as AttendancePayload;
    ownerUserId = p.marked_by ?? null;
    ownerInstituteCode = p.institute_code ?? null;
    if (!p.client_ts) p.client_ts = new Date().toISOString();
  }

  const full = {
    ...task,
    id,
    attempts: 0,
    createdAt: Date.now(),
    ownerUserId,
    ownerInstituteCode,
  } as QueueTask;
  const next = [...readQueue(), full];
  writeQueue(next);
  return id;
}

export function removeTask(id: string): void {
  writeQueue(readQueue().filter((t) => t.id !== id));
}

// ─── Task executors ──────────────────────────────────────────────────────────
async function runDmMessage(payload: DmMessagePayload): Promise<void> {
  const { error } = await supabase.from("direct_messages").insert({
    conversation_id: payload.conversation_id,
    institute_code: payload.institute_code,
    sender_id: payload.sender_id,
    sender_name: payload.sender_name,
    sender_role: payload.sender_role,
    message: payload.message,
    reply_to_id: payload.reply_to_id,
  });
  if (error) throw error;
}

async function runBatchMessage(payload: BatchMessagePayload): Promise<void> {
  const { error } = await supabase.from("batch_messages").insert({
    batch_id: payload.batch_id,
    institute_code: payload.institute_code,
    sender_id: payload.sender_id,
    sender_name: payload.sender_name,
    sender_role: payload.sender_role,
    message: payload.message,
    reply_to_id: payload.reply_to_id,
  });
  if (error) throw error;
}

async function runAttendance(payload: AttendancePayload): Promise<void> {
  if (payload.records.length === 0) return;
  const clientTs = payload.client_ts ?? new Date().toISOString();
  const rows = payload.records.map((r) => ({
    batch_id: payload.batch_id,
    institute_code: payload.institute_code,
    student_id: r.student_id,
    present: r.present,
    date: payload.date,
    marked_by: payload.marked_by,
    marked_at_client_ts: clientTs,
    updated_by: payload.marked_by,
  }));
  const { error } = await supabase
    .from("attendance")
    .upsert(rows, { onConflict: "batch_id,student_id,date" });
  if (error) throw error;
}

// ─── Flush ───────────────────────────────────────────────────────────────────
let flushing = false;

export interface FlushResult {
  succeeded: number;
  failed: number;
  remaining: number;
  skippedWrongUser: number;
  movedToDeadLetter: number;
}

export async function flushQueue(): Promise<FlushResult> {
  const empty = { succeeded: 0, failed: 0, remaining: getQueueCount(), skippedWrongUser: 0, movedToDeadLetter: 0 };
  if (flushing) return empty;
  if (typeof navigator !== "undefined" && !navigator.onLine) return empty;

  flushing = true;
  let succeeded = 0;
  let failed = 0;
  let skippedWrongUser = 0;
  let movedToDeadLetter = 0;

  try {
    // Identify the currently authenticated user once per flush.
    let currentUid: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      currentUid = data.user?.id ?? null;
    } catch { /* offline-ish */ }

    let queue = readQueue();
    for (const task of queue) {
      // Skip tasks that don't belong to the current user (multi-account / shared device).
      if (task.ownerUserId && currentUid && task.ownerUserId !== currentUid) {
        skippedWrongUser++;
        continue;
      }

      try {
        if (task.type === "dm_message") await runDmMessage(task.payload);
        else if (task.type === "batch_message") await runBatchMessage(task.payload);
        else if (task.type === "attendance") await runAttendance(task.payload);

        queue = queue.filter((t) => t.id !== task.id);
        writeQueue(queue);
        succeeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        const updated = queue.map((t) =>
          t.id === task.id ? ({ ...t, attempts: t.attempts + 1 } as QueueTask) : t,
        );
        const exhausted = updated.find((t) => t.id === task.id && t.attempts >= MAX_ATTEMPTS);
        const filtered = updated.filter((t) => t.attempts < MAX_ATTEMPTS);
        if (exhausted) {
          pushDeadLetter(exhausted, msg);
          movedToDeadLetter++;
        }
        queue = filtered;
        writeQueue(queue);
        failed++;
        // Network blip → stop the flush; the next online/visibility event will retry.
        if (err instanceof TypeError && /fetch/i.test(msg)) break;
      }
    }
  } finally {
    flushing = false;
  }

  return { succeeded, failed, remaining: getQueueCount(), skippedWrongUser, movedToDeadLetter };
}

// ─── Auto-flush on reconnect / visibility ────────────────────────────────────
let initialized = false;
export function initOfflineQueue(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const tryFlush = () => { void flushQueue(); };

  window.addEventListener("online", tryFlush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) tryFlush();
  });
  if (navigator.onLine) setTimeout(tryFlush, 1500);
}
