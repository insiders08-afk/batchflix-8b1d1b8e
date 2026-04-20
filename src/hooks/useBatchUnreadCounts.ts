import { useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { saveHubCache, loadHubCache } from "@/lib/hubCache";

const STALE_TIME = 30 * 1000;

async function fetchBatchUnreadCounts(
  userId: string,
  instituteCode: string
): Promise<Record<string, number>> {
  if (!userId || !instituteCode) return {};
  const { data } = await supabase.rpc("get_batch_unread_counts", {
    p_user_id: userId,
    p_institute_code: instituteCode,
  });
  const map: Record<string, number> = {};
  (data || []).forEach((row: { batch_id: string; unread_count: number }) => {
    map[row.batch_id] = Number(row.unread_count);
  });
  saveHubCache(`batch_unread_${userId}_${instituteCode}`, map);
  return map;
}

export function useBatchUnreadCounts(userId: string, instituteCode: string) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel>[]>([]);

  const queryKey = useMemo(
    () => ["batch-unread-counts", userId, instituteCode],
    [userId, instituteCode]
  );
  const cacheKey = `batch_unread_${userId}_${instituteCode}`;

  // initialData so unread badges survive offline cold-starts.
  const cached = useMemo(
    () => loadHubCache<Record<string, number>>(cacheKey) || {},
    [cacheKey]
  );

  const { data: batchUnreadCounts = {} } = useQuery<Record<string, number>>({
    queryKey,
    queryFn: () => fetchBatchUnreadCounts(userId, instituteCode),
    staleTime: STALE_TIME,
    gcTime: 10 * 60 * 1000,
    enabled: !!userId && !!instituteCode,
    initialData: cached,
    initialDataUpdatedAt: 0,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // Listen for new batch messages to refresh unread counts
  useEffect(() => {
    if (!userId || !instituteCode) return;

    channelRef.current.forEach((channel) => supabase.removeChannel(channel));
    channelRef.current = [];

    const ts = Date.now();

    const messageChannel = supabase
      .channel(`batch-unread-messages-${userId}-${ts}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "batch_messages",
          filter: `institute_code=eq.${instituteCode}`,
        },
        () => refetch()
      )
      .subscribe();

    const readsChannel = supabase
      .channel(`batch-unread-reads-${userId}-${ts}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "batch_message_reads",
          filter: `user_id=eq.${userId}`,
        },
        () => refetch()
      )
      .subscribe();

    channelRef.current = [messageChannel, readsChannel];

    return () => {
      [messageChannel, readsChannel].forEach((channel) => supabase.removeChannel(channel));
      channelRef.current = [];
    };
  }, [userId, instituteCode, refetch]);

  // Refetch on tab visibility
  useEffect(() => {
    if (!userId || !instituteCode) return;
    const handleVis = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [userId, instituteCode, refetch]);

  return { batchUnreadCounts, refetchBatchUnreadCounts: refetch };
}
