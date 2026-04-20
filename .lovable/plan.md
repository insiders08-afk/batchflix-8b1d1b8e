# Deep Audit — Attendance · Chats · Approvals · Batches · Routing · Offline

Scoped to root config + the requested feature surfaces. Tests/DPP/Homework/Fees explicitly skipped.

---

## A. Critical bugs (correctness — fix soon)

**A1. SW navigation fallback dies on email recovery / OAuth deep links.**  
`sw.ts` falls back to `/index.html` for every navigation request. The denylist only excludes paths starting with `/api/`, `/_*`, or having a file extension. Supabase password-recovery URLs land at `/reset-password#access_token=…` (no extension, not denylisted) — works because we serve the SPA shell — but `/reset-password` after a `recovery` flow that races with the SW can mis-route on the very first SW activation. More importantly there's no denylist for `/auth/*` callbacks. Low risk today, but worth pinning.

**A2. `attendance_after_write_audit` writes one row per student per save.**  
Today’s grid of 60 students = 60 audit rows per save. Across 3 saves/day × 30 days × 50 batches = ~270k rows/year per institute. There’s no purge job and the table has no index hint in the schema. Will degrade `LastMarkedBanner` RPC over a year.

**A3. `is_day_off` RPC + page-level fallback both LIKE-scan announcements.**  
The RPC uses `content LIKE '%day_off_date:YYYY-MM-DD%'` and the React layer re-implements the same regex match with a fallback to title parsing. Three-pronged duplication (RPC + AdminAttendance + TeacherAttendance + AttendanceCalendarView + AttendanceAnalyticsModal) — five places parse the same string. We already have `lib/dayOff.ts` with a 60s in-memory cache, **but nobody uses it**. Pages still hit `announcements` directly with regex parsing.

**A4. `useDirectMessages` has stale-closure on `loadOlderMessages`.**  
`messages` is in the dep array. Every state update recreates `loadOlderMessages`, breaking referential equality and triggering re-renders in `DMConversation`'s scroll handler. Same shape in `BatchChat.tsx`.

**A5. Batch-chat optimistic offline path drops file attachments silently.**  
`BatchChat.sendMessage` removes the optimistic message and shows an error toast when offline + file is attached, but the file may already be uploaded to Storage (because upload runs *before* the offline check). Result: orphan bytes in `chat-files/` bucket that nothing references, no cleanup. Same in `useDirectMessages.uploadFile`.

**A6. Push-subscription hook deletes ALL of the user’s subs on every register.**  
`usePushNotifications` calls `delete().eq("user_id", session.user.id)` then re-inserts. A user with the app open on desktop AND mobile loses one device’s subscription whenever the other registers. The unique key should be `(user_id, endpoint)`.

**A7. `BatchChat` mark-read loop fires on every visibility change.**  
`mark_batch_read` RPC runs once on mount, then every visibility-visible event. No debounce. A user toggling tabs 10 times = 10 RPCs.

**A8. `notify_dm_push` trigger reads `current_setting('app.service_role_key', true)`.**  
This GUC is not standard and isn't set anywhere visible in the migrations. If unset, the PERFORM still runs but with empty Authorization → `send-push-notifications` rejects with 401. DM pushes likely fail silently in production. Verify with edge function logs.

**A10. Offline queue replay can resurrect deleted attendance.**  
Stale-replay guard on `attendance_before_write` only blocks when `marked_at_client_ts` is older than the existing row. If an admin **deleted** a row online (via DELETE policy) while a teacher's offline queue had a save, the replay re-inserts the row because there’s no row to compare against → `INSERT` branch wins.

---

## B. Real-world UX edge cases

**B2. Schedule parse fails silently for legacy/free-text schedules.**  
`parseBatchTiming` returns `null` for plain-text schedules → `isAttendanceEditable` returns `editable:true, openTime:""`, attendance unrestricted. Existing institutes with old schedules get no time lock.

**B5. Offline cache namespaces are inconsistent.**  

- `bh_attendance_today_admin_<batchId>` (AdminAttendance)  
- `bh_attendance_today_<batchId>` (TeacherAttendance — no role suffix)  
On a shared tablet where both an admin and teacher log in, they read each other's attendance grid. `attendanceCache.ts` already provides namespaced helpers (`bh_att_v2_…`) keyed by userId — pages don't use it. The `purgeAllAttendanceCaches` does try to clean `bh_attendance_today_*` on logout, but pages still create fresh keys.

**B6. Offline DM/Batch text replay uses default `created_at = now()`.**  
A message composed at 9:00 AM offline, replayed at 11:00 AM, appears as 11:00 AM in the chat. Should send `created_at: payload.client_ts` like attendance.

**B7. `useDMList` realtime fires `*` filter on `direct_conversations` then debounces full refetch by 500ms.**  
On first message in a brand-new conversation, you get an INSERT (handled optimistically) AND the cascading UPDATE 100ms later from the trigger → both fire. Single-shot debounce can swallow the second event under flaky networks → unread badge stale until next visibility refetch.

**B8. Push notification `tag: "batchhub-announcement"` collapses ALL notifications.**  
A second push replaces the first. Students get one notification at a time; if 5 announcements arrive while phone's locked, only the last is visible. Should tag per-batch or per-conversation.

**B10. Hub list goes blank for 1 frame on tab return.**  
`refetchOnWindowFocus: true` on `useDMList` but `staleTime: 30s`. On tab return after >30s the query refetches; if cache had >0 items it stays, but if user just logged in fresh and conversations is `[]`, it stays `[]` until refetch. UX subtlety only.

**B12. Read receipts can race the realtime UPDATE.**  
`mark_dm_read` runs once initial scroll done. If a new message arrives during that very moment, the unread counter never increments (already zeroed). Functional but receipts can show stale.

**B14. Dirty-guard on browser close uses deprecated `e.returnValue`.**  
Works on most browsers but Chrome ignores the message string. `useDirtyGuard` confirm prompt also blocks programmatic navigation that bypasses `confirmIfDirty()` — only `handleBatchSwitch` calls it. Sidebar/back-button navigation does NOT call it → silent data loss.

---