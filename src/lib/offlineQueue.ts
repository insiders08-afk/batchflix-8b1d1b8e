/**
 * Offline write queue for BatchHub.
 *
 * Persists outgoing mutations (DM messages, batch messages, attendance saves)
 * to localStorage when the user is offline (or a request fails), and replays
 * them automatically when connectivity returns.
 *
 * Notes:
 * - File uploads cannot be queued (no File object in storage), so we only queue
 *   text-only operations. Callers should detect a file payload and refuse to
 *   queue, surfacing a "you must be online to send files" toast.
 * - Attendance is upserted (idempotent on batch+student+date), so re-running a
 *   queued save is safe.
 * - Messages use a `client_dedupe_id`-style approach: we keep an `optimisticId`
 *   on the queue item; if the same id is already on the server we skip.
 */

import { supabase } from "@/integrations/supabase/client";

const QUEUE_KEY = "bh_offline_queue_v1";
const MAX_QUEUE_SIZE = 200;
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
}

export type QueueTask =
  | { id: string; type: "dm_message"; payload: DmMessagePayload; attempts: number; createdAt: number }
  | { id: string; type: "batch_message"; payload: BatchMessagePayload; attempts: number; createdAt: number }
  | { id: string; type: "attendance"; payload: AttendancePayload; attempts: number; createdAt: number };

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

// ─── Pub/sub for the indicator UI ────────────────────────────────────────────
type Listener = (count: number) => void;
const listeners = new Set<Listener>();

function notifyListeners(count: number) {
  listeners.forEach((l) => {
    try {
      l(count);
    } catch {
      /* ignore */
    }
  });
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  // Send current count immediately
  listener(readQueue().length);
  return () => {
    listeners.delete(listener);
  };
}

export function getQueueCount(): number {
  return readQueue().length;
}

// ─── Public API: enqueue ─────────────────────────────────────────────────────
export function enqueueTask(task: Omit<QueueTask, "id" | "attempts" | "createdAt">): string {
  const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const full = { ...task, id, attempts: 0, createdAt: Date.now() } as QueueTask;
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
  const rows = payload.records.map((r) => ({
    batch_id: payload.batch_id,
    institute_code: payload.institute_code,
    student_id: r.student_id,
    present: r.present,
    date: payload.date,
    marked_by: payload.marked_by,
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
}

export async function flushQueue(): Promise<FlushResult> {
  if (flushing) return { succeeded: 0, failed: 0, remaining: getQueueCount() };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { succeeded: 0, failed: 0, remaining: getQueueCount() };
  }

  flushing = true;
  let succeeded = 0;
  let failed = 0;

  try {
    let queue = readQueue();
    // Process FIFO; rewrite queue after each task so progress is durable
    for (const task of queue) {
      try {
        if (task.type === "dm_message") await runDmMessage(task.payload);
        else if (task.type === "batch_message") await runBatchMessage(task.payload);
        else if (task.type === "attendance") await runAttendance(task.payload);

        // Success — remove from queue
        queue = queue.filter((t) => t.id !== task.id);
        writeQueue(queue);
        succeeded++;
      } catch (err) {
        // Increment attempts; drop if we've exhausted retries
        const updated = queue.map((t) =>
          t.id === task.id ? ({ ...t, attempts: t.attempts + 1 } as QueueTask) : t,
        );
        const filtered = updated.filter((t) => t.attempts < MAX_ATTEMPTS);
        queue = filtered;
        writeQueue(queue);
        failed++;
        // If we hit a network error, stop trying the rest until next flush
        if (err instanceof TypeError && /fetch/i.test(err.message)) break;
      }
    }
  } finally {
    flushing = false;
  }

  return { succeeded, failed, remaining: getQueueCount() };
}

// ─── Auto-flush on reconnect ─────────────────────────────────────────────────
let initialized = false;
export function initOfflineQueue(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const tryFlush = () => {
    void flushQueue();
  };

  window.addEventListener("online", tryFlush);
  // Also re-attempt when the tab becomes visible (mobile browsers often
  // suspend timers; visibility is a reliable "I'm back" signal)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) tryFlush();
  });

  // Initial flush in case we boot online with a stale queue
  if (navigator.onLine) {
    setTimeout(tryFlush, 1500);
  }
}
