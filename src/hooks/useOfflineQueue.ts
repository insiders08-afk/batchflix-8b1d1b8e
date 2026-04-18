import { useEffect, useState } from "react";
import { subscribeQueue, flushQueue } from "@/lib/offlineQueue";

/**
 * React hook exposing the current offline-queue size.
 * The count updates live as tasks are added/flushed.
 */
export function useOfflineQueue() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    const unsubscribe = subscribeQueue(setCount);
    return unsubscribe;
  }, []);

  return {
    pendingCount: count,
    flushNow: flushQueue,
  };
}
