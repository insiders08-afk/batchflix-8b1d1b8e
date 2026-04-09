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
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const totalUnread = conversations.reduce((sum, c) => {
    const count = currentUserRole === "admin" ? c.admin_unread_count : c.other_user_unread_count;
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
    } else {
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

    const filterCol = currentUserRole === "admin" ? "admin_id" : "other_user_id";
    const channelName = `dm-list-${currentUserId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_conversations",
          filter: `${filterCol}=eq.${currentUserId}`,
        },
        () => {
          // Refresh the full list on any change
          fetchConversations();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, currentUserRole, instituteCode, fetchConversations]);

  return { conversations, totalUnread, loading, refetch: fetchConversations };
}
