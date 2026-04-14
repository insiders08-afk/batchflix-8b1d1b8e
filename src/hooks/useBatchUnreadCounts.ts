import { useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  return map;
}

export function useBatchUnreadCounts(userId: string, instituteCode: string) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const queryKey = useMemo(
    () => ["batch-unread-counts", userId, instituteCode],
    [userId, instituteCode]
  );

  const { data: batchUnreadCounts = {} } = useQuery<Record<string, number>>({
    queryKey,
    queryFn: () => fetchBatchUnreadCounts(userId, instituteCode),
    staleTime: STALE_TIME,
    gcTime: 10 * 60 * 1000,
    enabled: !!userId && !!instituteCode,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // Listen for new batch messages to refresh unread counts
  useEffect(() => {
    if (!userId || !instituteCode) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`batch-unread-${userId}-${Date.now()}`)
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

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
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
