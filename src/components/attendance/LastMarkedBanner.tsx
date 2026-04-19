import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  batchId: string;
  date: string; // YYYY-MM-DD
  /** bump this number to force a refetch (e.g. after a save) */
  refreshKey?: number;
}

interface Marker {
  marker_id: string | null;
  marker_name: string | null;
  marked_at: string | null;
  rows_count: number;
}

/**
 * "Last marked by Ravi at 4:32 PM (60 students)" — sits above the grid so
 * a second user (e.g. admin) sees that a teacher has already saved before
 * they overwrite. Powered by the `get_attendance_last_marker` RPC.
 */
export default function LastMarkedBanner({ batchId, date, refreshKey = 0 }: Props) {
  const [marker, setMarker] = useState<Marker | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!batchId || !date) { setMarker(null); return; }
    (async () => {
      const { data, error } = await supabase.rpc("get_attendance_last_marker", {
        p_batch_id: batchId,
        p_date: date,
      });
      if (cancelled) return;
      if (error || !data || data.length === 0) { setMarker(null); return; }
      setMarker(data[0] as Marker);
    })();
    return () => { cancelled = true; };
  }, [batchId, date, refreshKey]);

  if (!marker || !marker.marked_at) return null;

  const when = new Date(marker.marked_at).toLocaleTimeString("en-IN", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });
  const who = marker.marker_name || "Someone";
  const count = marker.rows_count;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg text-xs border bg-primary/5 border-primary/20 text-primary">
      <History className="w-3.5 h-3.5 flex-shrink-0" />
      <span>
        Last marked by <span className="font-semibold">{who}</span> at{" "}
        <span className="font-semibold">{when}</span>{" "}
        <span className="text-muted-foreground">({count} {count === 1 ? "student" : "students"})</span>
      </span>
    </div>
  );
}
