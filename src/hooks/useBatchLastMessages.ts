import { useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BatchLastMessage } from "@/types/chat";
import { saveHubCache, loadHubCache } from "@/lib/hubCache";

const STALE_TIME = 30 * 1000;

async function fetchBatchLastMsgs(instituteCode: string): Promise<Record<string, BatchLastMessage>> {
  if (!instituteCode) return {};
  const { data } = await supabase.rpc("get_batch_last_messages", {
    p_institute_code: instituteCode,
  });
  const map: Record<string, BatchLastMessage> = {};
  (data || []).forEach((row: BatchLastMessage) => {
    map[row.batch_id] = row;
  });
  saveHubCache(`batch_last_msgs_${instituteCode}`, map);
  return map;
}

export function useBatchLastMessages(instituteCode: string) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const queryKey = useMemo(() => ["batch-last-msgs", instituteCode], [instituteCode]);
  const cacheKey = `batch_last_msgs_${instituteCode}`;

  // initialData (not placeholderData) so the cache survives offline errors.
  const cached = useMemo(
    () => loadHubCache<Record<string, BatchLastMessage>>(cacheKey) || {},
    [cacheKey]
  );

  const { data: batchLastMsgs = {} } = useQuery<Record<string, BatchLastMessage>>({
    queryKey,
    queryFn: () => fetchBatchLastMsgs(instituteCode),
    staleTime: STALE_TIME,
    gcTime: 10 * 60 * 1000,
    enabled: !!instituteCode,
    initialData: Object.keys(cached).length > 0 ? cached : undefined,
    initialDataUpdatedAt: 0,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // MED-04: Only trigger on INSERT events (edits/reactions don't change last message)
  useEffect(() => {
    if (!instituteCode) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`batch-msgs-hub-${instituteCode}-${Date.now()}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "batch_messages",
        filter: `institute_code=eq.${instituteCode}`,
      }, () => refetch())
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [instituteCode, refetch]);

  // Refetch on tab visibility
  useEffect(() => {
    if (!instituteCode) return;
    const handleVis = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [instituteCode, refetch]);

  return { batchLastMsgs, refetchBatchLastMsgs: refetch };
}
