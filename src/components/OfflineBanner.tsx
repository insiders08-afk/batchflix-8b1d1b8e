import { WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Slim banner shown at the top of the app when the device goes offline.
 * Lives inside DashboardLayout so it appears across all role dashboards.
 */
export default function OfflineBanner() {
  const isOnline = useOnlineStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ y: -32, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -32, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="w-full bg-amber-500/95 text-amber-950 text-xs font-medium px-3 py-1.5 flex items-center justify-center gap-2 shadow-sm"
          role="status"
          aria-live="polite"
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>You're offline — messages will sync when reconnected.</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
