import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { BatchLastMessage } from "@/types/chat";

/**
 * Hook that fetches batch last messages and subscribes to realtime
 * updates on `batch_messages` so the chat hub list stays current.
 */
export function useBatchLastMessages(instituteCode: string) {
  const [batchLastMsgs, setBatchLastMsgs] = useState<Record<string, BatchLastMessage>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchBatchLastMsgs = useCallback(async () => {
    if (!instituteCode) return;
    const { data } = await supabase.rpc("get_batch_last_messages", {
      p_institute_code: instituteCode,
    });
    const map: Record<string, BatchLastMessage> = {};
    (data || []).forEach((row: BatchLastMessage) => {
      map[row.batch_id] = row;
    });
    setBatchLastMsgs(map);
  }, [instituteCode]);

  // Initial fetch
  useEffect(() => {
    fetchBatchLastMsgs();
  }, [fetchBatchLastMsgs]);

  // Realtime: listen for any batch_messages changes in this institute
  useEffect(() => {
    if (!instituteCode) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channelName = `batch-msgs-hub-${instituteCode}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "batch_messages",
          filter: `institute_code=eq.${instituteCode}`,
        },
        () => {
          fetchBatchLastMsgs();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [instituteCode, fetchBatchLastMsgs]);

  // Refetch on visibility change (coming back from a DM/batch)
  useEffect(() => {
    if (!instituteCode) return;
    const handleVis = () => {
      if (document.visibilityState === "visible") fetchBatchLastMsgs();
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [instituteCode, fetchBatchLastMsgs]);

  return { batchLastMsgs, refetchBatchLastMsgs: fetchBatchLastMsgs };
}
