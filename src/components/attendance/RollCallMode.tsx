import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, X, ChevronLeft, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Student {
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  students: Student[];
  attendance: Record<string, "present" | "absent">;
  onMark: (userId: string, status: "present" | "absent") => void;
  /** Called once the user reaches the end and confirms — parent should save. */
  onFinish: () => void;
  batchName?: string;
}

/**
 * Full-screen sequential roll-call. Optimised for one-handed phone use during
 * class — single huge tap target, no scrolling, swipe-friendly.
 */
export default function RollCallMode({
  open, onClose, students, attendance, onMark, onFinish, batchName,
}: Props) {
  const [idx, setIdx] = useState(0);

  // Reset to first unmarked student whenever the modal opens
  useEffect(() => {
    if (!open) return;
    const firstUnmarked = students.findIndex(s => !attendance[s.user_id]);
    setIdx(firstUnmarked >= 0 ? firstUnmarked : 0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = students.length;
  const current = students[idx];
  const markedCount = useMemo(
    () => students.filter(s => attendance[s.user_id]).length,
    [students, attendance],
  );

  if (!open || !current) return null;

  const handleMark = (status: "present" | "absent") => {
    onMark(current.user_id, status);
    if (idx < total - 1) {
      setIdx(idx + 1);
    }
  };

  const goBack = () => idx > 0 && setIdx(idx - 1);
  const isLast = idx === total - 1;
  const allMarked = markedCount === total;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-card/80 backdrop-blur">
        <Button size="icon" variant="ghost" onClick={onClose} className="h-9 w-9 -ml-2">
          <X className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">Roll-call · {batchName || "Batch"}</p>
          <p className="text-sm font-display font-semibold">
            {idx + 1} of {total}
            <span className="text-muted-foreground font-normal ml-2">· {markedCount} marked</span>
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={goBack}
          disabled={idx === 0}
          className="h-9 gap-1.5"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </Button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${((idx + 1) / total) * 100}%` }}
        />
      </div>

      {/* Student card */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-6 gap-6 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.user_id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col items-center text-center max-w-md w-full"
          >
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full gradient-hero flex items-center justify-center text-white text-5xl font-display font-bold mb-5 shadow-primary">
              {current.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-1">{current.full_name}</h2>
            <p className="text-sm text-muted-foreground">{current.phone || current.email}</p>

            {attendance[current.user_id] && (
              <div className={cn(
                "mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold",
                attendance[current.user_id] === "present"
                  ? "bg-success-light text-success"
                  : "bg-danger-light text-danger",
              )}>
                {attendance[current.user_id] === "present"
                  ? <><CheckCircle2 className="w-3.5 h-3.5" /> Marked Present</>
                  : <><XCircle className="w-3.5 h-3.5" /> Marked Absent</>}
                <span className="text-muted-foreground ml-1">· tap below to change</span>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Big action buttons — one-handed friendly */}
        <div className="grid grid-cols-2 gap-3 w-full max-w-md">
          <button
            onClick={() => handleMark("absent")}
            className="h-20 sm:h-24 rounded-2xl bg-danger-light text-danger active:scale-95 transition-transform flex flex-col items-center justify-center gap-1.5 font-display font-bold text-lg shadow-card"
          >
            <XCircle className="w-7 h-7" />
            Absent
          </button>
          <button
            onClick={() => handleMark("present")}
            className="h-20 sm:h-24 rounded-2xl bg-success-light text-success active:scale-95 transition-transform flex flex-col items-center justify-center gap-1.5 font-display font-bold text-lg shadow-card"
          >
            <CheckCircle2 className="w-7 h-7" />
            Present
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border/50 px-4 py-3 bg-card/80 backdrop-blur flex items-center gap-2">
        {isLast || allMarked ? (
          <Button
            className="w-full gradient-hero text-white shadow-primary hover:opacity-90 border-0"
            onClick={() => { onFinish(); onClose(); }}
          >
            Done — review &amp; save
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={goBack} disabled={idx === 0} className="gap-1.5">
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </Button>
            <p className="text-xs text-muted-foreground ml-auto">
              {total - markedCount} left
            </p>
          </>
        )}
      </div>
    </div>
  );
}
