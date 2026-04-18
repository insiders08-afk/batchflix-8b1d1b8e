import { CloudOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Compact pill shown in the top bar when there are queued offline writes.
 * - Offline + queue > 0: shows queue count with cloud-off icon.
 * - Online + queue > 0: shows spinner ("syncing N…") while flushing.
 * - Online + queue 0:   hidden.
 */
export function SyncIndicator() {
  const { pendingCount, flushNow } = useOfflineQueue();
  const isOnline = useOnlineStatus();
  const [syncing, setSyncing] = useState(false);

  // Trigger a flush whenever we come back online with pending items
  useEffect(() => {
    if (!isOnline || pendingCount === 0) return;
    let cancelled = false;
    setSyncing(true);
    flushNow().finally(() => {
      if (!cancelled) setSyncing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isOnline, pendingCount, flushNow]);

  if (pendingCount === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            if (isOnline) {
              setSyncing(true);
              void flushNow().finally(() => setSyncing(false));
            }
          }}
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
  );
}
