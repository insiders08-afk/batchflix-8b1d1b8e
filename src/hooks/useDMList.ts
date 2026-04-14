import { useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DirectConversation } from "@/types/chat";
import { saveHubCache, loadHubCache } from "@/lib/hubCache";

interface UseDMListOptions {
  currentUserId: string;
  currentUserRole: string;
  instituteCode: string;
}

const DM_STALE_TIME = 30 * 1000; // 30 seconds (was 5 min — too stale for chat)

async function fetchDMConversations(
  currentUserId: string,
  currentUserRole: string,
  instituteCode: string
): Promise<DirectConversation[]> {
  if (!currentUserId || !instituteCode) return [];

  let query = supabase
    .from("direct_conversations")
    .select("*")
    .eq("institute_code", instituteCode)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (currentUserRole === "admin") {
    query = query.eq("admin_id", currentUserId);
  } else if (currentUserRole === "teacher") {
    query = query.or(`admin_id.eq.${currentUserId},other_user_id.eq.${currentUserId}`);
  } else {
    query = query.eq("other_user_id", currentUserId);
  }

  const { data } = await query;
  const result = (data || []) as DirectConversation[];

  saveHubCache(`dm_list_${currentUserRole}_${currentUserId}`, result);

  return result;
}

export function useDMList({ currentUserId, currentUserRole, instituteCode }: UseDMListOptions) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel>[]>([]);

  const queryKey = useMemo(
    () => ["dm-list", currentUserId, currentUserRole, instituteCode],
    [currentUserId, currentUserRole, instituteCode]
  );
  const cacheKey = `dm_list_${currentUserRole}_${currentUserId}`;

  const { data: conversations = [], isLoading: loading } = useQuery<DirectConversation[]>({
    queryKey,
    queryFn: () => fetchDMConversations(currentUserId, currentUserRole, instituteCode),
    staleTime: DM_STALE_TIME,
    gcTime: 10 * 60 * 1000,
    enabled: !!currentUserId && !!instituteCode,
    placeholderData: loadHubCache<DirectConversation[]>(cacheKey) || [],
    refetchOnWindowFocus: true,
  });

  const totalUnread = useMemo(() =>
    conversations.reduce((sum, c) => {
      const count = c.admin_id === currentUserId ? c.admin_unread_count : c.other_user_unread_count;
      return sum + (count || 0);
    }, 0),
    [conversations, currentUserId]
  );

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // Real-time subscriptions — listen to BOTH direct_conversations AND direct_messages
  useEffect(() => {
    if (!currentUserId || !instituteCode) return;

    channelRef.current.forEach((ch) => supabase.removeChannel(ch));
    channelRef.current = [];

    const ts = Date.now();
    const channels: ReturnType<typeof supabase.channel>[] = [];

    // Subscribe to direct_conversations changes (triggered by after_direct_message_insert)
    if (currentUserRole === "teacher") {
      const ch1 = supabase
        .channel(`dm-list-other-${currentUserId}-${ts}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "direct_conversations",
          filter: `other_user_id=eq.${currentUserId}`,
        }, () => refetch())
        .subscribe();

      const ch2 = supabase
        .channel(`dm-list-admin-${currentUserId}-${ts}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "direct_conversations",
          filter: `admin_id=eq.${currentUserId}`,
        }, () => refetch())
        .subscribe();

      channels.push(ch1, ch2);
    } else {
      const filterCol = currentUserRole === "admin" ? "admin_id" : "other_user_id";
      const ch = supabase
        .channel(`dm-list-${currentUserId}-${ts}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "direct_conversations",
          filter: `${filterCol}=eq.${currentUserId}`,
        }, () => refetch())
        .subscribe();
      channels.push(ch);
    }

    // Also subscribe to direct_messages INSERT for faster reaction
    // (the trigger updates direct_conversations, but this catches edge cases)
    const msgCh = supabase
      .channel(`dm-msgs-hub-${currentUserId}-${ts}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "direct_messages",
        filter: `institute_code=eq.${instituteCode}`,
      }, () => {
        // Small delay to let the trigger update direct_conversations first
        setTimeout(() => refetch(), 300);
      })
      .subscribe();
    channels.push(msgCh);

    channelRef.current = channels;

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
      channelRef.current = [];
    };
  }, [currentUserId, currentUserRole, instituteCode, refetch]);

  // Refetch on tab visibility
  useEffect(() => {
    if (!currentUserId || !instituteCode) return;
    const handleVis = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [currentUserId, instituteCode, refetch]);

  return { conversations, totalUnread, loading, refetch };
}
