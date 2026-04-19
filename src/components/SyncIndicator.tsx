import { CloudOff, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  subscribeDeadLetter,
  getDeadLetter,
  clearDeadLetter,
  type DeadLetterEntry,
} from "@/lib/offlineQueue";

/**
 * Compact pill shown in the top bar when there are queued offline writes
 * OR dead-letter entries that need user attention.
 *
 * - Offline + queue > 0: shows queue count with cloud-off icon.
 * - Online + queue > 0: shows spinner ("syncing N…") while flushing.
 * - Dead-letter > 0:    shows amber warning chip with count, opens dialog.
 * - Tap (online): manual retry.
 */
export function SyncIndicator() {
  const { pendingCount, flushNow } = useOfflineQueue();
  const isOnline = useOnlineStatus();
  const [syncing, setSyncing] = useState(false);
  const [deadCount, setDeadCount] = useState(0);
  const [deadOpen, setDeadOpen] = useState(false);
  const [deadEntries, setDeadEntries] = useState<DeadLetterEntry[]>([]);

  useEffect(() => subscribeDeadLetter(setDeadCount), []);

  // Auto-flush when we come back online with pending items
  useEffect(() => {
    if (!isOnline || pendingCount === 0) return;
    let cancelled = false;
    setSyncing(true);
    flushNow().finally(() => { if (!cancelled) setSyncing(false); });
    return () => { cancelled = true; };
  }, [isOnline, pendingCount, flushNow]);

  const openDeadLetter = () => {
    setDeadEntries(getDeadLetter());
    setDeadOpen(true);
  };

  const handleManualRetry = () => {
    if (!isOnline) return;
    setSyncing(true);
    void flushNow().finally(() => setSyncing(false));
  };

  if (pendingCount === 0 && deadCount === 0) return null;

  return (
    <>
      <div className="flex items-center gap-1.5">
        {pendingCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleManualRetry}
                className={cn(
                  "flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 transition-colors",
                  isOnline
                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                    : "bg-muted text-muted-foreground",
                )}
                aria-label={`${pendingCount} pending sync`}
              >
                {syncing && isOnline ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : isOnline ? (
                  <RefreshCw className="w-3.5 h-3.5" />
                ) : (
                  <CloudOff className="w-3.5 h-3.5" />
                )}
                <span>{pendingCount}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isOnline
                ? syncing
                  ? `Syncing ${pendingCount} pending…`
                  : `${pendingCount} queued — tap to retry`
                : `${pendingCount} change${pendingCount === 1 ? "" : "s"} will sync when back online`}
            </TooltipContent>
          </Tooltip>
        )}

        {deadCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openDeadLetter}
                className="flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
                aria-label={`${deadCount} failed sync`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{deadCount}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {deadCount} change{deadCount === 1 ? "" : "s"} failed to sync — tap to view
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <Dialog open={deadOpen} onOpenChange={setDeadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              Failed to sync ({deadEntries.length})
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {deadEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No failed syncs.</p>
            ) : (
              deadEntries.map((e, i) => (
                <div key={i} className="border border-border/50 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold capitalize">{e.task.type.replace("_", " ")}</span>
                    <span className="text-muted-foreground">
                      {new Date(e.failedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                  <p className="text-muted-foreground break-words">{e.lastError}</p>
                  {e.task.type === "attendance" && (
                    <p className="text-muted-foreground">
                      Batch: <span className="font-mono">{e.task.payload.batch_id.slice(0, 8)}…</span> ·{" "}
                      {e.task.payload.records.length} students · {e.task.payload.date}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeadOpen(false)}>
              Close
            </Button>
            {deadEntries.length > 0 && (
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  clearDeadLetter();
                  setDeadEntries([]);
                }}
              >
                Clear all
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
