import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2, XCircle, CalendarDays, Users,
  Loader2, Search, BarChart3, Clock, Lock, LockOpen, AlertCircle, Maximize2, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AttendanceAnalyticsModal from "@/components/attendance/AttendanceAnalyticsModal";
import AttendanceCalendarView from "@/components/attendance/AttendanceCalendarView";
import LastMarkedBanner from "@/components/attendance/LastMarkedBanner";
import RollCallMode from "@/components/attendance/RollCallMode";
import { isAttendanceEditable, formatTimingDisplay } from "@/lib/batchTiming";
import { enqueueTask } from "@/lib/offlineQueue";
import { useDirtyGuard } from "@/hooks/useDirtyGuard";

const ATT_CACHE_PREFIX = "bh_attendance_today_";
type CachedAtt = {
  date: string;
  students: StudentProfile[];
  attendance: Record<string, "present" | "absent">;
  batchHistory: AttendanceHistoryItem[];
  cachedAt: number;
};
function readAttCache(batchId: string, today: string): CachedAtt | null {
  try {
    const raw = localStorage.getItem(ATT_CACHE_PREFIX + batchId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAtt;
    return parsed.date === today ? parsed : null;
  } catch { return null; }
}

interface Batch {
  id: string;
  name: string;
  course: string;
  schedule: string | null;
}

interface StudentProfile {
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
}

interface AttendanceHistoryItem {
  date: string;
  present: number;
  total: number;
  pct: number;
}

interface StudentStats {
  student: StudentProfile;
  total: number;
  present: number;
  pct: number;
  history: { date: string; present: boolean }[];
}

export default function TeacherAttendance() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [attendance, setAttendance] = useState<Record<string, "present" | "absent">>({});
  const [batchHistory, setBatchHistory] = useState<AttendanceHistoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [instituteCode, setInstituteCode] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [analyticsStudent, setAnalyticsStudent] = useState<StudentStats | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  // Saved baseline → derives "isDirty" + "hasEverSaved" for the Save/Update button
  const [savedBaseline, setSavedBaseline] = useState<Record<string, "present" | "absent">>({});
  const [hasEverSaved, setHasEverSaved] = useState(false);
  const [lastMarkerKey, setLastMarkerKey] = useState(0);
  const [rollCallOpen, setRollCallOpen] = useState(false);

  // Day-off state
  const [todayIsDayOff, setTodayIsDayOff] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const todayDisplay = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/auth/teacher"); return; }
      setUserId(user.id);
      const { data: code } = await supabase.rpc("get_my_institute_code");
      setInstituteCode(code || "");
      const { data: batchData } = await supabase
        .from("batches").select("id, name, course, schedule")
        .eq("teacher_id", user.id).eq("is_active", true).order("name");
      if (batchData) {
        setBatches(batchData);
        if (batchData.length > 0) setSelectedBatchId(batchData[0].id);
      }
      setLoading(false);
    };
    init();
  }, [navigate]);

  // Check if today is a day-off for the selected batch
  useEffect(() => {
    if (!selectedBatchId) return;
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
          // Primary: machine-readable tag
          const tagMatch = (ann.content || "").match(/day_off_date:(\d{4}-\d{2}-\d{2})/);
          if (tagMatch) return tagMatch[1] === todayKey;
          // Fallback: parse from title
          const titleMatch = ann.title.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
          if (titleMatch) {
            const day = parseInt(titleMatch[1]);
            const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
            const monthIdx = months.indexOf(titleMatch[2].toLowerCase());
            const year = parseInt(titleMatch[3]);
            if (monthIdx !== -1) {
              const key = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              return key === todayKey;
            }
          }
          return false;
        });
        setTodayIsDayOff(found);
      });
  }, [selectedBatchId, today]);

  const loadBatchData = useCallback(async (batchId: string) => {
    if (!batchId) return;
    // Hydrate immediately from today's cache so offline shows real grid
    const cachedAtt = readAttCache(batchId, today);
    if (cachedAtt) {
      setStudents(cachedAtt.students);
      setAttendance(cachedAtt.attendance);
      setBatchHistory(cachedAtt.batchHistory);
      setSavedBaseline(cachedAtt.attendance);
      setHasEverSaved(Object.keys(cachedAtt.attendance).length > 0);
      setLoadingStudents(false);
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setLoadingStudents(false);
      return;
    }
    setLoadingStudents(true);
    try {
      const { data: enrollments } = await supabase.from("students_batches").select("student_id").eq("batch_id", batchId);
      const ids = (enrollments || []).map(e => e.student_id);
      let profiles: StudentProfile[] = [];
      if (ids.length > 0) {
        const { data } = await supabase.from("profiles").select("user_id, full_name, email, phone").in("user_id", ids);
        profiles = (data || []) as StudentProfile[];
      }
      setStudents(profiles);

      // Bug A2 fix: never send `["none"]` into a UUID column — guard with early return
      let todayAtt: { student_id: string; present: boolean }[] = [];
      if (ids.length > 0) {
        const { data } = await supabase.from("attendance").select("student_id, present")
          .eq("batch_id", batchId).eq("date", today)
          .in("student_id", ids);
        todayAtt = data || [];
      }

      // Bug A1 fix: Do NOT pre-fill "present" for unmarked students. Leave them
      // undefined so the UI distinguishes "not taken" from "all present", and a
      // reflexive Save can never silently mark everyone present.
      const attMap: Record<string, "present" | "absent"> = {};
      (todayAtt || []).forEach(a => { attMap[a.student_id] = a.present ? "present" : "absent"; });
      setAttendance(attMap);
      setSavedBaseline(attMap);
      setHasEverSaved(Object.keys(attMap).length > 0);

      const { data: histData } = await supabase.from("attendance").select("date, present, student_id")
        .eq("batch_id", batchId).order("date", { ascending: false }).limit(500);

      const dateMap: Record<string, { present: number; total: number }> = {};
      (histData || []).forEach(a => {
        if (a.date === today) return;
        if (!dateMap[a.date]) dateMap[a.date] = { present: 0, total: 0 };
        dateMap[a.date].total++;
        if (a.present) dateMap[a.date].present++;
      });

      const histItems = Object.entries(dateMap)
        .map(([date, val]) => ({ date, present: val.present, total: val.total, pct: val.total > 0 ? Math.round((val.present / val.total) * 100) : 0 }))
        .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

      setBatchHistory(histItems);

      try {
        localStorage.setItem(ATT_CACHE_PREFIX + batchId, JSON.stringify({
          date: today,
          students: profiles,
          attendance: attMap,
          batchHistory: histItems,
          cachedAt: Date.now(),
        } satisfies CachedAtt));
      } catch { /* ignore */ }
    } finally {
      setLoadingStudents(false);
    }
  }, [today]);

  useEffect(() => { if (selectedBatchId) loadBatchData(selectedBatchId); }, [selectedBatchId, loadBatchData]);

  const selectedBatch = batches.find(b => b.id === selectedBatchId);
  const { editable: attEditable, reason: attLockReason, openTime, lockTime } = isAttendanceEditable(selectedBatch?.schedule ?? null);

  // Combined lock: timing window OR day-off
  const isLocked = !attEditable || todayIsDayOff;

  const toggle = (uid: string) => {
    if (isLocked) return;
    setAttendance(prev => ({ ...prev, [uid]: prev[uid] === "present" ? "absent" : "present" }));
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
      const records = students.map(s => ({
        student_id: s.user_id,
        present: attendance[s.user_id] === "present",
      }));

      // Offline → enqueue & optimistic cache update
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        enqueueTask({
          type: "attendance",
          payload: {
            batch_id: selectedBatchId,
            institute_code: instituteCode,
            date: today,
            marked_by: userId,
            records,
          },
        });
        // Persist current grid to local cache so reload still shows it
        try {
          localStorage.setItem(ATT_CACHE_PREFIX + selectedBatchId, JSON.stringify({
            date: today, students, attendance, batchHistory, cachedAt: Date.now(),
          }));
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
        institute_code: instituteCode, marked_by: userId,
        ...r,
      }));
      const { error } = await supabase.from("attendance").upsert(fullRecords, { onConflict: "batch_id,student_id,date" });
      if (error) throw error;
      setSavedBaseline(attendance);
      setHasEverSaved(true);
      setLastMarkerKey(k => k + 1);
      toast({ title: hasEverSaved ? "✅ Attendance updated!" : "✅ Attendance saved!", description: `${students.length} students recorded.` });
      loadBatchData(selectedBatchId);
    } catch (err: unknown) {
      // Network failure → fall back to queue
      const msg = err instanceof Error ? err.message : "Failed";
      if (/fetch|network/i.test(msg)) {
        enqueueTask({
          type: "attendance",
          payload: {
            batch_id: selectedBatchId,
            institute_code: instituteCode,
            date: today,
            marked_by: userId,
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
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const openStudentAnalytics = async (student: StudentProfile) => {
    setAnalyticsOpen(true); setAnalyticsLoading(true); setAnalyticsStudent(null);
    const { data: attData } = await supabase.from("attendance").select("date, present")
      .eq("batch_id", selectedBatchId).eq("student_id", student.user_id)
      .order("date", { ascending: false }).limit(200);
    const records = attData || [];
    const presentCount = records.filter(a => a.present).length;
    setAnalyticsStudent({
      student, total: records.length, present: presentCount,
      pct: records.length > 0 ? Math.round((presentCount / records.length) * 100) : 0,
      history: records.map(a => ({ date: a.date, present: a.present })),
    });
    setAnalyticsLoading(false);
  };

  const presentCount = Object.values(attendance).filter(v => v === "present").length;
  const pct = students.length > 0 ? Math.round((presentCount / students.length) * 100) : 0;
  const filtered = students.filter(s => s.full_name.toLowerCase().includes(search.toLowerCase()));

  // Dirty-state derivation
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

  const animateRows = students.length <= 30;

  if (loading) return (
    <DashboardLayout title="Attendance" role="teacher">
      <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout title="Attendance" role="teacher">
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row gap-3">
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No batches assigned. Ask your admin to assign you to a batch.</p>
          ) : (
            <Select value={selectedBatchId} onValueChange={handleBatchSwitch}>
              <SelectTrigger className="w-full sm:w-56 h-9">
                <SelectValue placeholder="Select batch" />
              </SelectTrigger>
              <SelectContent>
                {batches.map(b => <SelectItem key={b.id} value={b.id}>{b.name} — {b.course}</SelectItem>)}
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
                { label: "Present", value: todayIsDayOff ? "—" : presentCount, color: "text-success" },
                { label: "Absent", value: todayIsDayOff ? "—" : students.length - presentCount, color: "text-danger" },
                { label: "Rate", value: todayIsDayOff ? "—" : `${pct}%`, color: pct >= 75 ? "text-success" : "text-danger" },
              ].map(s => (
                <Card key={s.label} className="p-4 text-center shadow-card border-border/50">
                  <div className={`text-2xl font-display font-bold ${s.value === "—" ? "text-muted-foreground" : s.color}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </Card>
              ))}
            </div>

            <Card className="shadow-card border-border/50 overflow-hidden">
              <div className="p-4 border-b border-border/50 flex items-center gap-2">
                <Button
                  size="icon" variant="ghost"
                  onClick={() => setRollCallOpen(true)}
                  disabled={isLocked || students.length === 0}
                  className="h-7 w-7 -ml-1"
                  title="Open roll-call mode"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </Button>
                <CalendarDays className="w-4 h-4 text-primary" />
                <span className="font-display font-semibold text-sm">Today — {selectedBatch?.name || "No Batch"}</span>
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
                {isLocked && <Lock className="w-3.5 h-3.5 text-warning" />}
              </div>

              {loadingStudents ? (
                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
                  <Users className="w-8 h-8 mb-2" />
                  <p className="text-sm">No students enrolled in this batch.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/40 max-h-[440px] overflow-y-auto">
                  {filtered.map((s, i) => (
                    <motion.div key={s.user_id}
                      initial={animateRows ? { opacity: 0 } : false}
                      animate={animateRows ? { opacity: 1 } : { opacity: 1 }}
                      transition={animateRows ? { delay: i * 0.02 } : { duration: 0 }}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
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
                            : "bg-danger-light text-danger hover:bg-danger hover:text-white"
                        )}
                      >
                        {attendance[s.user_id] === "present"
                          ? <><CheckCircle2 className="w-3.5 h-3.5" /> Present</>
                          : <><XCircle className="w-3.5 h-3.5" /> Absent</>
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
                {!isLocked && isDirty && (
                  <p className="text-xs text-warning text-center mt-1.5 flex items-center justify-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    You have <span className="font-bold">unsaved changes</span>{hasEverSaved ? " — tap to update" : ""}
                  </p>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="shadow-card border-border/50">
              <div className="p-4 border-b border-border/50 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                <span className="font-display font-semibold text-sm">Recent History</span>
              </div>
              {batchHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <CalendarDays className="w-7 h-7 mb-2" />
                  <p className="text-sm text-center px-4">No previous attendance records yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {batchHistory.map((h, i) => (
                    <div key={i} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium">
                          {new Date(h.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </span>
                        <span className={`text-sm font-bold ${h.pct >= 85 ? "text-success" : h.pct >= 75 ? "text-warning" : "text-danger"}`}>{h.pct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${h.pct >= 85 ? "bg-success" : h.pct >= 75 ? "bg-warning" : "bg-danger"}`} style={{ width: `${h.pct}%` }} />
                      </div>
                      <div className="flex gap-3 mt-1">
                        <span className="text-xs text-muted-foreground">{h.present}/{h.total} present</span>
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
                role="teacher"
                schedule={selectedBatch?.schedule}
                onDayOffChange={() => {
                  setTodayIsDayOff(false);
                  supabase
                    .from("announcements")
                    .select("content")
                    .eq("batch_id", selectedBatchId)
                    .eq("type", "day_off")
                    .then(({ data }) => {
                      if (!data) return;
                      const todayKey = today;
                      setTodayIsDayOff(data.some(ann => {
                        const tagMatch = (ann.content || "").match(/day_off_date:(\d{4}-\d{2}-\d{2})/);
                        return tagMatch ? tagMatch[1] === todayKey : false;
                      }));
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
