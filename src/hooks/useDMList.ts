import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DirectConversation } from "@/types/chat";

interface UseDMListOptions {
  currentUserId: string;
  currentUserRole: string;
  instituteCode: string;
}

export function useDMList({ currentUserId, currentUserRole, instituteCode }: UseDMListOptions) {
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel>[]>([]);

  // Position-aware unread count: check which side the user is on per conversation
  const totalUnread = conversations.reduce((sum, c) => {
    const count = c.admin_id === currentUserId ? c.admin_unread_count : c.other_user_unread_count;
    return sum + (count || 0);
  }, 0);

  const fetchConversations = useCallback(async () => {
    if (!currentUserId || !instituteCode) return;

    let query = supabase
      .from("direct_conversations")
      .select("*")
      .eq("institute_code", instituteCode)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (currentUserRole === "admin") {
      query = query.eq("admin_id", currentUserId);
    } else if (currentUserRole === "teacher") {
      // Teacher appears as other_user_id in admin-teacher DMs
      // and as admin_id in teacher-student DMs
      query = query.or(`admin_id.eq.${currentUserId},other_user_id.eq.${currentUserId}`);
    } else {
      // Student is always other_user_id
      query = query.eq("other_user_id", currentUserId);
    }

    const { data } = await query;
    if (data) {
      setConversations(data as DirectConversation[]);
    }
    setLoading(false);
  }, [currentUserId, currentUserRole, instituteCode]);

  useEffect(() => {
    if (!currentUserId || !instituteCode) return;
    fetchConversations();
  }, [fetchConversations]);

  // Real-time: listen for conversation list updates
  useEffect(() => {
    if (!currentUserId || !instituteCode) return;

    // Clean up previous channels
    channelRef.current.forEach((ch) => supabase.removeChannel(ch));
    channelRef.current = [];

    const ts = Date.now();
    const channels: ReturnType<typeof supabase.channel>[] = [];

    if (currentUserRole === "teacher") {
      // Teacher needs two subscriptions: one for each column they can appear in
      const ch1 = supabase
        .channel(`dm-list-other-${currentUserId}-${ts}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "direct_conversations",
          filter: `other_user_id=eq.${currentUserId}`,
        }, () => fetchConversations())
        .subscribe();

      const ch2 = supabase
        .channel(`dm-list-admin-${currentUserId}-${ts}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "direct_conversations",
          filter: `admin_id=eq.${currentUserId}`,
        }, () => fetchConversations())
        .subscribe();

      channels.push(ch1, ch2);
    } else {
      const filterCol = currentUserRole === "admin" ? "admin_id" : "other_user_id";
      const ch = supabase
        .channel(`dm-list-${currentUserId}-${ts}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "direct_conversations",
          filter: `${filterCol}=eq.${currentUserId}`,
        }, () => fetchConversations())
        .subscribe();
      channels.push(ch);
    }

    channelRef.current = channels;

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
      channelRef.current = [];
    };
  }, [currentUserId, currentUserRole, instituteCode, fetchConversations]);

  return { conversations, totalUnread, loading, refetch: fetchConversations };
}
