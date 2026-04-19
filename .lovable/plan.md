# Attendance — Production-Grade Audit & Fix Plan

## Files in scope (scanned)

**Pages**: `AdminAttendance.tsx`, `TeacherAttendance.tsx`, `StudentAttendance.tsx`, `ParentDashboard.tsx`, `BatchWorkspace.tsx` (attendance tab + saveAttendance).
**Components**: `AttendanceCalendarView.tsx`, `AttendanceAnalyticsModal.tsx`.
**Libs/hooks**: `lib/batchTiming.ts`, `lib/offlineQueue.ts`, `hooks/useOfflineQueue.ts`, `components/SyncIndicator.tsx`.
**Routing/Layout**: `App.tsx`, `DashboardLayout.tsx`, `lib/prefetchRoutes.ts`.
**DB**: `attendance` table + unique index `(batch_id, student_id, date)` ✅ already in place.

---

## A. Bugs (must-fix)

1. **Teacher inserts a row for every student even when "Not taken"** — `TeacherAttendance.loadBatchData` defaults `attMap[uid] = "present"` (line 177) for students with no DB record. If the teacher never opens the page but autosaves (or hits "Save" by reflex), those students get marked present. Admin page already fixed this (leaves undefined). Apply same fix to Teacher + BatchWorkspace.
2. `**enrolledIds.in("none")` SQL hack on Teacher** (line 174) — sends a literal `"none"` string into a UUID column → "invalid input syntax for type uuid" on empty batches. Mirror Admin's early-return guard.
3. **Admin "All Absent" before any DB record exists is a destructive default** — combined with bug #1 means switching batches mid-day can flip already-saved present students. Need confirmation modal if `Object.keys(attendance).length === 0` and saving.
4. `**getMyInstituteCode()` typo** in code comments (`get my_institute_code` with space) — actual call is correct, but fragile. Cosmetic; flagging only.
5. `**new Date(r.date)` in StudentAttendance heatmap** parses YYYY-MM-DD as UTC midnight → in IST timezone, `getDate()` returns the correct day, but `getMonth()` can shift on edge dates near month-end if user is in a westward TZ. Use `dateKeyToLocalDate()` everywhere (already used in CalendarView).
6. **Optimistic cache write does not include `marked_by`/`institute_code**`, so when offline and the queue replays it inserts with correct fields, but the local cache UI shows stale data until next refetch.

---

## B. UX Barriers

1. **No "saved by whom/when last" phrase**
2. **No "unsaved changes" guard** — switching batch dropdown or navigating away silently loses marks. must a mark ' 'you have **unsaved changes**''
3. **Day-off banner duplication** — comment says "duplicate removed" but logic still re-queries inside `onDayOffChange` callback inline → 2 round-trips per day-off toggle.
4. **Save button says "Save Attendance" even when nothing changed** — should detect dirty state and disable. like for very first attendance marking it must show save attendance and then update attendance while editing attendance with 'you have **unsaved changes**' until saved/updated.
5. **No autosave** — teachers in 2-hour classes lose marks if they accidentally close tab.
6. take all absent by default, in tab above marking attendance list.
7. attendance locked is also at below of marking attendance list, no need there as we already have it below batch name and timings.

---

## C. Real-World Coaching-Center Edge Cases

1. **60 students in 2 minutes** — current `motion.div` per row with 0.02s stagger = 1.2s animation lag for 60. Disable framer animation when `students.length > 30`.
2. **Switching batch mid-session** — no autosave + no dirty-prompt → data loss. Must commit on dropdown change.
3. **Concurrent admin+teacher** — see bug A6/A7. Must show "marked by Teacher Ravi at 4:32 PM — overwrite?" before saving.
4. **Power loss mid-save** — if 30 of 60 rows committed before crash, on reload only those 30 are in `attendance`, the other 30 are blank. Current code maps "no row = no mark", which is correct, but UX should say "Partial save detected — 30/60 marked, please review".
5. **Cross-batch contamination** — RLS enforces `institute_code`, but **no RLS rule prevents an admin from marking a student in batch X using batch Y's id**. The unique index is on `(batch_id, student_id, date)`, so a student enrolled in two batches gets two separate rows, which is correct. But the UI should refuse if `student_id` is not in `students_batches` for that batch (sanity check). Currently no such guard.
6. **Holiday / strike / sudden cancellation** — currently can only mark day-off in advance via calendar. Need "cancel today's class" button on Today's attendance panel.

---

## D. Offline / PWA Architecture Gaps

1. **No `bh_attendance_today_admin_<batchId>` cache eviction** — caches accumulate forever. Need TTL (delete if `cachedAt > 24h old`) and a daily cleanup at boot.
2. **Cache key collisions across institutes** — `bh_attendance_today_<batchId>` is unique per batch, but on shared device (one tablet, multiple teachers) a logout doesn't clear other-user caches. Already noted in Phase 1 sessionPersistence — but attendance caches must also be purged on logout.
3. **Service-worker doesn't precache the attendance route's data fetch** — only the JS chunk. So on first offline boot of a route, even with SW cache hit on the chunk, the page still tries the network. Acceptable since localStorage cache covers it, but document it.
4. **Offline queue replay fires on `online` event only** — `visibilitychange` is added, but mobile Safari often suppresses both for 30s after wake. Add a manual "Retry sync" button in SyncIndicator.
5. **Queue task has no `institute_code` validation on replay** — if the user switches institutes (multi-role) before the queue drains, the task replays under the wrong RLS context. Need to capture `auth.uid()` at enqueue and abort if mismatched on replay.
6. **No conflict resolution on replay** — if teacher marks offline at 4 PM, admin overrides online at 5 PM, then teacher comes online at 6 PM, the teacher's queue replays and overwrites admin's correction. Need `If-Match` style guard via `updated_at` or just timestamp the queue payload and let server-side trigger reject older writes.
7. **Queue MAX_ATTEMPTS=5 silently drops** — for attendance this means lost data. Move dropped tasks to a `bh_offline_queue_dead_letter` and surface in SyncIndicator with "X failed, tap to view".

---

## E. Cross-Institute / Cross-Batch Isolation


| Vector                 | Current state                                                     | Risk                                                                          |
| ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| RLS on `attendance`    | `institute_code = get_my_institute_code()`                        | ✅ safe                                                                        |
| Cache keys             | per `batchId` only                                                | ⚠️ Shared device leakage between users — purge on logout                      |
| Offline queue          | global `bh_offline_queue_v1`                                      | ⚠️ Replays under whoever is logged in. Tag with `userId` and skip if mismatch |
| Day-off announcements  | per `batch_id`                                                    | ✅ safe                                                                        |
| Student profile lookup | `.in("user_id", ids)` filtered through RLS `institute_code` match | ✅ safe                                                                        |
| `marked_by` field      | `auth.uid()`                                                      | ✅ safe                                                                        |


---

## F. Improvements / Features for Ground-Level Adaptation

1. **One-tap "Repeat yesterday's attendance"** — in tier-2/3 tutoring 90% of the class is the same regulars. Pre-populate from yesterday's record with a "Use yesterday" button.
2. **Roll-call mode** — full-screen sequential student photo + Present/Absent buttons, optimised for fast tap on a phone held in one hand. add 'expand button ' in header of attendance marking list at left of date.

---

