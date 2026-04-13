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

const DM_STALE_TIME = 5 * 60 * 1000; // 5 minutes

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

  // Persist to sessionStorage for instant hydration
  saveHubCache(`dm_list_${currentUserRole}_${currentUserId}`, result);

  return result;
}

export function useDMList({ currentUserId, currentUserRole, instituteCode }: UseDMListOptions) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel>[]>([]);

  const queryKey = ["dm-list", currentUserId, currentUserRole, instituteCode];
  const cacheKey = `dm_list_${currentUserRole}_${currentUserId}`;

  const { data: conversations = [], isLoading: loading } = useQuery<DirectConversation[]>({
    queryKey,
    queryFn: () => fetchDMConversations(currentUserId, currentUserRole, instituteCode),
    staleTime: DM_STALE_TIME,
    gcTime: 10 * 60 * 1000,
    enabled: !!currentUserId && !!instituteCode,
    placeholderData: loadHubCache<DirectConversation[]>(cacheKey) || [],
  });

  // Position-aware unread count
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

  // Real-time subscriptions to invalidate query on changes
  useEffect(() => {
    if (!currentUserId || !instituteCode) return;

    channelRef.current.forEach((ch) => supabase.removeChannel(ch));
    channelRef.current = [];

    const ts = Date.now();
    const channels: ReturnType<typeof supabase.channel>[] = [];

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

    channelRef.current = channels;

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
      channelRef.current = [];
    };
  }, [currentUserId, currentUserRole, instituteCode, refetch]);

  return { conversations, totalUnread, loading, refetch };
}
