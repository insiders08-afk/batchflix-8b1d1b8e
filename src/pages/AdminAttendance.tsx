import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, CheckCircle2, XCircle, Clock, CalendarDays, Loader2, Users, BarChart3, Lock, LockOpen, AlertCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import AttendanceAnalyticsModal from "@/components/attendance/AttendanceAnalyticsModal";
import AttendanceCalendarView from "@/components/attendance/AttendanceCalendarView";
import LastMarkedBanner from "@/components/attendance/LastMarkedBanner";

import { isAttendanceEditable, formatTimingDisplay, isLegacyUnstructuredSchedule } from "@/lib/batchTiming";
import { enqueueTask } from "@/lib/offlineQueue";
import { useDirtyGuard } from "@/hooks/useDirtyGuard";
import { isDayOff, loadDayOffDatesForBatch, invalidateDayOff, getLocalTodayKey } from "@/lib/dayOff";
import { readTodayAtt, writeTodayAtt, type TodayAttendanceCache } from "@/lib/attendanceCache";

type Batch = Tables<"batches">;
type Profile = Tables<"profiles">;

interface AttendanceHistoryItem {
  date: string;
  present: number;
  absent: number;
  pct: number;
}

interface StudentStats {
  student: { user_id: string; full_name: string; email: string; phone: string | null };
  total: number;
  present: number;
  pct: number;
  history: { date: string; present: boolean }[];
}

export default function AdminAttendance() {
  const { toast } = useToast();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [students, setStudents] = useState<Profile[]>([]);
  const [attendance, setAttendance] = useState<Record<string, "present" | "absent">>({});
  const [history, setHistory] = useState<AttendanceHistoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [instituteCode, setInstituteCode] = useState("");
  const [userId, setUserId] = useState<string>("");

  const [analyticsStudent, setAnalyticsStudent] = useState<StudentStats | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  // Saved baseline → derives "isDirty" + "hasEverSaved" for the Save/Update button
  const [savedBaseline, setSavedBaseline] = useState<Record<string, "present" | "absent">>({});
  const [hasEverSaved, setHasEverSaved] = useState(false);
  const [lastMarkerKey, setLastMarkerKey] = useState(0); // bump after save → refetch banner

  // B1 fix: use local timezone, not UTC, so "today" doesn't roll to tomorrow
  // for users east of UTC after midnight UTC (~5:30 AM IST).
  const today = getLocalTodayKey();
  const todayDisplay = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long" });

  useEffect(() => {
    const fetchBatches = async () => {
      setLoadingBatches(true);
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || "");
      const { data: code } = await supabase.rpc("get_my_institute_code");
      setInstituteCode(code || "");
      const { data, error } = await supabase.from("batches").select("*").eq("institute_code", code || "").eq("is_active", true).order("name");
      if (!error && data) {
        setBatches(data);
        if (data.length > 0) setSelectedBatchId(data[0].id);
      }
      setLoadingBatches(false);
    };
    fetchBatches();
  }, []);

  const loadBatchData = useCallback(async (batchId: string) => {
    if (!batchId) return;

    // 1. Hydrate immediately from today's cache so offline / cold-start
    //    paints the real grid before any query resolves.
    //    B5 fix: cache is now namespaced by userId so a logout (or another
    //    admin logging in on a shared tablet) cannot leak grids.
    const cached = userId ? readTodayAtt<Profile>("admin", userId, batchId, today) : null;
    if (cached) {
      setStudents(cached.students);
      setAttendance(cached.attendance);
      setHistory(cached.history as AttendanceHistoryItem[]);
      setSavedBaseline(cached.attendance);
      setHasEverSaved(Object.keys(cached.attendance).length > 0);
      setLoadingStudents(false);
    }

    // 2. Don't even attempt the network when offline — cache is authoritative.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setLoadingStudents(false);
      return;
    }

    setLoadingStudents(true);
    try {
      const { data: enrollments } = await supabase.from("students_batches").select("student_id").eq("batch_id", batchId);
      const enrolledIds = (enrollments || []).map(e => e.student_id);
      let profiles: Profile[] = [];
      if (enrolledIds.length > 0) {
        const { data: profileData } = await supabase.from("profiles").select("*").in("user_id", enrolledIds);
        profiles = profileData || [];
      }
      setStudents(profiles);

      const studentIds = profiles.map(p => p.user_id);

      // Fix #5: early-return instead of ["none"] hack
      const attMap: Record<string, "present" | "absent"> = {};
      if (studentIds.length > 0) {
        const { data: todayAtt } = await supabase
          .from("attendance").select("student_id, present")
          .eq("batch_id", batchId).eq("date", today)
          .in("student_id", studentIds);

        // Fix #8: Only populate from actual DB records — leave students without records
        // as undefined so we can distinguish "not taken" from "all present"
        (todayAtt || []).forEach(a => { attMap[a.student_id] = a.present ? "present" : "absent"; });
      }
      setAttendance(attMap);
      setSavedBaseline(attMap);
      setHasEverSaved(Object.keys(attMap).length > 0);

      const { data: histData } = await supabase.from("attendance").select("date, present")
        .eq("batch_id", batchId).neq("date", today).order("date", { ascending: false }).limit(200);

      const dateMap: Record<string, { present: number; total: number }> = {};
      (histData || []).forEach(a => {
        if (!dateMap[a.date]) dateMap[a.date] = { present: 0, total: 0 };
        dateMap[a.date].total++;
        if (a.present) dateMap[a.date].present++;
      });

      const histItems: AttendanceHistoryItem[] = Object.entries(dateMap).slice(0, 5).map(([date, val]) => ({
        date: new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        present: val.present, absent: val.total - val.present,
        pct: val.total > 0 ? Math.round((val.present / val.total) * 100) : 0,
      }));
      setHistory(histItems);

      // 3. Persist freshest snapshot for next cold start.
      if (userId) {
        writeTodayAtt<Profile>("admin", userId, batchId, {
          date: today,
          students: profiles,
          attendance: attMap,
          history: histItems,
          cachedAt: Date.now(),
        });
      }
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to load", variant: "destructive" });
    } finally {
      setLoadingStudents(false);
    }
  }, [today, toast, userId]);

  useEffect(() => { if (selectedBatchId) loadBatchData(selectedBatchId); }, [selectedBatchId, loadBatchData]);

  const selectedBatch = batches.find(b => b.id === selectedBatchId);
  const { editable: attEditable, reason: attLockReason, openTime, lockTime } = isAttendanceEditable(selectedBatch?.schedule ?? null);
  // B2: surface a yellow warning when the schedule is non-empty but unparseable
  // (legacy free-text). In that case the time-lock is silently disabled.
  const isLegacySchedule = isLegacyUnstructuredSchedule(selectedBatch?.schedule ?? null);

  // A3 fix: use the centralised dayOff helper instead of duplicating regex parsing
  // here. The helper is already used by the calendar/analytics modal, so day-off
  // detection is now consistent across the entire app.
  const [todayIsDayOff, setTodayIsDayOff] = useState(false);
  useEffect(() => {
    if (!selectedBatchId) { setTodayIsDayOff(false); return; }
    setTodayIsDayOff(false);
    isDayOff(selectedBatchId, today).then(setTodayIsDayOff);
  }, [selectedBatchId, today]);

  const isLocked = !attEditable || todayIsDayOff;

  const toggle = (userId: string) => {
    if (isLocked) return;
    setAttendance(prev => {
      const current = prev[userId];
      // If not taken yet, default to present on first click
      if (!current) return { ...prev, [userId]: "present" };
      return { ...prev, [userId]: current === "present" ? "absent" : "present" };
    });
  };

  const markAll = (status: "present" | "absent") => {
    if (isLocked) return;
    setAttendance(Object.fromEntries(students.map(s => [s.user_id, status])));
  };

  const saveAttendance = async () => {
    if (!selectedBatchId || students.length === 0) return;
    if (todayIsDayOff) {
      toast({ title: "Day Off", description: "Today is marked as a day off for this batch. No attendance saved.", variant: "destructive" });
      return;
    }
    if (!attEditable) {
      toast({ title: "Attendance locked", description: attLockReason, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const records = students.map(s => ({
        student_id: s.user_id,
        present: attendance[s.user_id] === "present",
      }));

      // Offline → enqueue & persist optimistic state to cache
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        enqueueTask({
          type: "attendance",
          payload: {
            batch_id: selectedBatchId,
            institute_code: instituteCode,
            date: today,
            marked_by: user?.id ?? null,
            records,
          },
        });
        try {
          localStorage.setItem(ATT_CACHE_PREFIX + selectedBatchId, JSON.stringify({
            date: today, students, attendance, history, cachedAt: Date.now(),
          } satisfies CachedAtt));
        } catch { /* ignore */ }
        setSavedBaseline(attendance);
        setHasEverSaved(true);
        setLastMarkerKey(k => k + 1);
        toast({ title: "📥 Saved offline", description: "Will sync when back online." });
        setSaving(false);
        return;
      }

      const fullRecords = records.map(r => ({
        batch_id: selectedBatchId, date: today,
        institute_code: instituteCode, marked_by: user?.id ?? null,
        ...r,
      }));
      const { error } = await supabase.from("attendance").upsert(fullRecords, { onConflict: "batch_id,student_id,date" });
      if (error) throw error;
      setSavedBaseline(attendance);
      setHasEverSaved(true);
      setLastMarkerKey(k => k + 1);
      toast({ title: hasEverSaved ? "✅ Attendance updated!" : "✅ Attendance saved!", description: `Saved for ${students.length} students.` });
      loadBatchData(selectedBatchId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      if (/fetch|network/i.test(msg)) {
        const { data: { user } } = await supabase.auth.getUser();
        enqueueTask({
          type: "attendance",
          payload: {
            batch_id: selectedBatchId,
            institute_code: instituteCode,
            date: today,
            marked_by: user?.id ?? null,
            records: students.map(s => ({
              student_id: s.user_id,
              present: attendance[s.user_id] === "present",
            })),
          },
        });
        setSavedBaseline(attendance);
        setHasEverSaved(true);
        setLastMarkerKey(k => k + 1);
        toast({ title: "📥 Saved offline", description: "Will sync when back online." });
      } else {
        toast({ title: "Error saving attendance", description: msg, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const openStudentAnalytics = async (student: Profile) => {
    setAnalyticsOpen(true); setAnalyticsLoading(true); setAnalyticsStudent(null);
    const { data: attData } = await supabase.from("attendance").select("date, present")
      .eq("batch_id", selectedBatchId).eq("student_id", student.user_id)
      .order("date", { ascending: false }).limit(200);
    const records = attData || [];
    const presentCount = records.filter(a => a.present).length;
    setAnalyticsStudent({
      student: { user_id: student.user_id, full_name: student.full_name, email: student.email, phone: student.phone },
      total: records.length, present: presentCount,
      pct: records.length > 0 ? Math.round((presentCount / records.length) * 100) : 0,
      history: records.map(a => ({ date: a.date, present: a.present })),
    });
    setAnalyticsLoading(false);
  };

  const presentCount = Object.values(attendance).filter(v => v === "present").length;
  const pct = students.length > 0 ? Math.round((presentCount / students.length) * 100) : 0;
  const filtered = students.filter(s => s.full_name.toLowerCase().includes(search.toLowerCase()));

  // Dirty-state derivation: compare current grid against last saved baseline
  const isDirty = useMemo(() => {
    const keys = new Set([...Object.keys(attendance), ...Object.keys(savedBaseline)]);
    for (const k of keys) {
      if (attendance[k] !== savedBaseline[k]) return true;
    }
    return false;
  }, [attendance, savedBaseline]);

  const { confirmIfDirty } = useDirtyGuard(isDirty && !isLocked);

  const handleBatchSwitch = (newBatchId: string) => {
    if (!confirmIfDirty()) return;
    setSelectedBatchId(newBatchId);
  };

  // One-tap "Use yesterday" — pull yesterday's attendance pattern and pre-fill.
  const repeatYesterday = useCallback(async () => {
    if (!selectedBatchId || students.length === 0 || isLocked) return;
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const yKey = yest.toISOString().split("T")[0];
    const ids = students.map(s => s.user_id);
    const { data, error } = await supabase
      .from("attendance").select("student_id, present")
      .eq("batch_id", selectedBatchId).eq("date", yKey)
      .in("student_id", ids);
    if (error || !data || data.length === 0) {
      toast({ title: "No record for yesterday", description: "Nothing to copy from.", variant: "destructive" });
      return;
    }
    const map: Record<string, "present" | "absent"> = {};
    data.forEach(r => { map[r.student_id] = r.present ? "present" : "absent"; });
    setAttendance(prev => ({ ...prev, ...map }));
    toast({ title: "📋 Pre-filled from yesterday", description: `${data.length} students copied — review then Save.` });
  }, [selectedBatchId, students, isLocked, toast]);

  // Disable framer animation past 30 students — perf sensitivity for large classes
  const animateRows = students.length <= 30;

  return (
    <DashboardLayout title="Attendance">
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row gap-3">
          {loadingBatches ? (
            <div className="w-56 h-9 bg-muted animate-pulse rounded-md" />
          ) : (
            <Select value={selectedBatchId} onValueChange={handleBatchSwitch}>
              <SelectTrigger className="w-full sm:w-56 h-9">
                <SelectValue placeholder="Select batch" />
              </SelectTrigger>
              <SelectContent>
                {batches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search students..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" variant="outline" onClick={() => markAll("present")}
              disabled={isLocked}
              className={cn("h-9 gap-1.5", !isLocked ? "text-success border-success/30 hover:bg-success-light" : "opacity-40 cursor-not-allowed")}>
              <CheckCircle2 className="w-3.5 h-3.5" /> All Present
            </Button>
            <Button size="sm" variant="outline" onClick={() => markAll("absent")}
              disabled={isLocked}
              className={cn("h-9 gap-1.5", !isLocked ? "text-danger border-danger/30 hover:bg-danger-light" : "opacity-40 cursor-not-allowed")}>
              <XCircle className="w-3.5 h-3.5" /> All Absent
            </Button>
          </div>
        </div>

        {/* Single consolidated info banner: schedule + status chip (red lock / green open + last-marker) */}
        {selectedBatch?.schedule && (() => {
          const t = (() => { try { const p = JSON.parse(selectedBatch.schedule!); return p.days?.length ? p : null; } catch { return null; } })();
          const todayName = new Date().toLocaleDateString("en-IN", { weekday: "long" });
          const fmt = (h: number, m: number, ap: string) => `${h}:${String(m).padStart(2, "0")} ${ap}`;
          const lockLabel = todayIsDayOff
            ? "Day off"
            : !attEditable
              ? (attLockReason.startsWith("No class")
                  ? `No class today (${todayName})`
                  : attLockReason.startsWith("Attendance opens")
                    ? `Opens ${openTime}`
                    : `Closed at ${lockTime}`)
              : null;
          if (!t) return null;
          return (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg text-xs bg-muted/30 border border-border/40">
              <CalendarDays className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span className="font-semibold text-foreground">{t.days.join(", ")}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{fmt(t.startHour, t.startMinute, t.startAmPm)} – {fmt(t.endHour, t.endMinute, t.endAmPm)}</span>
              <span className="text-muted-foreground">· Today: <span className="font-semibold text-foreground">{todayName}</span></span>
              {lockLabel ? (
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-danger/10 text-danger border border-danger/25 font-semibold">
                  <Lock className="w-3 h-3" /> {lockLabel}
                </span>
              ) : (
                <span className="ml-auto inline-flex flex-wrap items-center gap-1 px-2 py-0.5 rounded-md bg-success/10 text-success border border-success/25 font-semibold">
                  <LockOpen className="w-3 h-3" /> Window open · locks {lockTime}
                  {selectedBatchId && <LastMarkedBanner batchId={selectedBatchId} date={today} refreshKey={lastMarkerKey} inline />}
                </span>
              )}
            </div>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Present", value: todayIsDayOff ? "—" : presentCount, color: "success" },
                { label: "Absent", value: todayIsDayOff ? "—" : students.length - presentCount, color: "danger" },
                { label: "Attendance %", value: todayIsDayOff ? "—" : `${pct}%`, color: pct >= 75 ? "success" : "danger" },
              ].map(s => (
                <Card key={s.label} className="p-4 text-center shadow-card border-border/50">
                  <div className={`text-2xl font-display font-bold ${s.value === "—" ? "text-muted-foreground" : s.color === "success" ? "text-success" : "text-danger"}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </Card>
              ))}
            </div>

            <Card className="shadow-card border-border/50 overflow-hidden">
              <div className="p-4 border-b border-border/50 flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                <span className="font-display font-semibold text-sm">{selectedBatch?.name || "No Batch"}</span>
                <Badge variant="secondary" className="ml-auto text-xs">{todayDisplay}</Badge>
                <Button
                  size="sm" variant="outline"
                  onClick={repeatYesterday}
                  disabled={isLocked || students.length === 0}
                  className="h-7 px-2 gap-1 text-xs"
                  title="Pre-fill from yesterday's attendance"
                >
                  <RotateCcw className="w-3 h-3" /> Yesterday
                </Button>
                {!attEditable && <Lock className="w-3.5 h-3.5 text-warning" />}
              </div>

              {loadingStudents ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
                  <Users className="w-8 h-8 mb-2" />
                  <p className="text-sm">No students enrolled in this batch.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/40 max-h-[420px] overflow-y-auto">
                  {filtered.map((s, i) => (
                    <motion.div key={s.id}
                      initial={animateRows ? { opacity: 0 } : false}
                      animate={animateRows ? { opacity: 1 } : { opacity: 1 }}
                      transition={animateRows ? { delay: i * 0.02 } : { duration: 0 }}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
                      <button className="flex items-center gap-3 flex-1 text-left" onClick={() => openStudentAnalytics(s)}>
                        <div className="w-8 h-8 rounded-full gradient-hero flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {s.full_name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                        </div>
                        <div>
                          <p className="text-sm font-medium hover:text-primary transition-colors">{s.full_name}</p>
                          <p className="text-xs text-muted-foreground">{s.phone || s.email}</p>
                        </div>
                        <BarChart3 className="w-3.5 h-3.5 text-muted-foreground ml-1 flex-shrink-0" />
                      </button>
                      <button
                        onClick={() => toggle(s.user_id)}
                        disabled={isLocked}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ml-3",
                          isLocked ? "opacity-50 cursor-not-allowed" : "",
                          attendance[s.user_id] === "present"
                            ? "bg-success-light text-success hover:bg-success hover:text-white"
                            : attendance[s.user_id] === "absent"
                            ? "bg-danger-light text-danger hover:bg-danger hover:text-white"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        )}
                      >
                        {attendance[s.user_id] === "present"
                          ? <><CheckCircle2 className="w-3.5 h-3.5" /> Present</>
                          : attendance[s.user_id] === "absent"
                          ? <><XCircle className="w-3.5 h-3.5" /> Absent</>
                          : <><Clock className="w-3.5 h-3.5" /> Not taken</>
                        }
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}

              <div className="p-4 border-t border-border/50">
                <Button
                  className={cn(
                    "w-full border-0",
                    isLocked
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : isDirty || !hasEverSaved
                        ? "gradient-hero text-white shadow-primary hover:opacity-90"
                        : "bg-success/10 text-success hover:bg-success/15",
                  )}
                  onClick={saveAttendance}
                  disabled={saving || students.length === 0 || isLocked || (hasEverSaved && !isDirty)}
                >
                  {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                    : todayIsDayOff ? <><Lock className="w-4 h-4 mr-2" />Day Off — No Attendance</>
                    : !attEditable ? <><Lock className="w-4 h-4 mr-2" />Attendance Locked</>
                    : hasEverSaved
                      ? (isDirty ? "Update Attendance" : <><CheckCircle2 className="w-4 h-4 mr-2" />All changes saved</>)
                      : "Save Attendance"}
                </Button>
                {/* Dirty-state footnote — the "you have unsaved changes" star */}
                {!isLocked && isDirty && (
                  <p className="text-xs text-warning text-center mt-1.5 flex items-center justify-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    You have <span className="font-bold">unsaved changes</span>{hasEverSaved ? " — tap to update" : ""}
                  </p>
                )}
                {/* Removed redundant lock notice — already shown above the grid */}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="shadow-card border-border/50">
              <div className="p-4 border-b border-border/50 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                <span className="font-display font-semibold text-sm">Recent History</span>
              </div>
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground px-4 text-center">
                  <CalendarDays className="w-7 h-7 mb-2" />
                  <p className="text-sm">No previous records yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {history.map((h, i) => (
                    <div key={i} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{h.date}</span>
                        <span className={`text-sm font-bold ${h.pct >= 85 ? "text-success" : h.pct >= 75 ? "text-warning" : "text-danger"}`}>{h.pct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${h.pct >= 85 ? "bg-success" : h.pct >= 75 ? "bg-warning" : "bg-danger"}`} style={{ width: `${h.pct}%` }} />
                      </div>
                      <div className="flex gap-3 mt-1">
                        <span className="text-xs text-muted-foreground">{h.present} present</span>
                        <span className="text-xs text-muted-foreground">{h.absent} absent</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {selectedBatchId && (
              <AttendanceCalendarView
                batchId={selectedBatchId}
                batchName={selectedBatch?.name}
                instituteCode={instituteCode}
                role="admin"
                schedule={selectedBatch?.schedule}
                onDayOffChange={() => {
                  // Re-check day-off status for today when calendar changes
                  setTodayIsDayOff(false);
                  supabase
                    .from("announcements")
                    .select("content, title")
                    .eq("batch_id", selectedBatchId)
                    .eq("type", "day_off")
                    .then(({ data }) => {
                      if (!data) return;
                      const todayKey = today;
                      const found = data.some(ann => {
                        const tagMatch = (ann.content || "").match(/day_off_date:(\d{4}-\d{2}-\d{2})/);
                        if (tagMatch) return tagMatch[1] === todayKey;
                        return false;
                      });
                      setTodayIsDayOff(found);
                    });
                }}
              />
            )}
          </div>
        </div>
      </div>

      <AttendanceAnalyticsModal
        open={analyticsOpen}
        onClose={() => { setAnalyticsOpen(false); setAnalyticsStudent(null); }}
        stats={analyticsStudent}
        loading={analyticsLoading}
        batchId={selectedBatchId}
        schedule={selectedBatch?.schedule}
      />
    </DashboardLayout>
  );
}
