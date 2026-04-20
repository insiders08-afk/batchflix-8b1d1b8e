import { useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DirectConversation, DirectMessage } from "@/types/chat";
import { saveHubCache, loadHubCache } from "@/lib/hubCache";
import { saveCachedMessages, loadCachedMessages } from "@/lib/chatCache";

interface UseDMListOptions {
  currentUserId: string;
  currentUserRole: string;
  instituteCode: string;
}

const DM_STALE_TIME = 30 * 1000;

// Offline pre-warm: cache last N messages for the top K most-recent
// conversations so opening any of them offline shows real history
// instead of a blank screen.
const PREWARM_TOP_CHATS = 10;
const PREWARM_MESSAGES_PER_CHAT = 50;
const PREWARM_THROTTLE_MS = 60 * 1000; // 1 min between attempts (per chat key)
// Per-conversation last-warm timestamps so we refresh recent chats
// without spamming the server. A chat is re-warmed at most once a minute.
const lastPrewarmByConv: Record<string, number> = {};

async function prewarmTopConversationMessages(
  conversations: DirectConversation[],
  currentUserId: string
): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  // Pick top-K conversations by recency. Always refresh the cache for the
  // top chats (not just empty ones) so the latest 50 msgs are always ready
  // for offline viewing. Per-conv throttle prevents request storms.
  const now = Date.now();
  const candidates = conversations
    .filter((c) => c.last_message_at)
    .slice(0, PREWARM_TOP_CHATS)
    .filter((c) => (now - (lastPrewarmByConv[c.id] || 0)) >= PREWARM_THROTTLE_MS);

  if (candidates.length === 0) return;
  candidates.forEach((c) => { lastPrewarmByConv[c.id] = now; });

  // Run in parallel with a soft cap; even on slow networks 10 concurrent
  // 20-row queries against an indexed table return well under a second.
  await Promise.allSettled(
    candidates.map(async (c) => {
      const { data, error } = await supabase
        .from("direct_messages")
        .select("*")
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: false })
        .limit(PREWARM_MESSAGES_PER_CHAT);
      if (error || !data) return;
      // Store oldest-first so the conversation page can render directly.
      const ordered: DirectMessage[] = [...data].reverse().map((m) => ({
        ...(m as DirectMessage),
        isSelf: (m as DirectMessage).sender_id === currentUserId,
      }));
      saveCachedMessages(`dm_${c.id}`, ordered);
    })
  );
}

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
  // B7 fix: separate debounce timestamps for INSERT vs UPDATE so a brand-new
  // conversation's INSERT + immediate UPDATE (from the trigger) don't
  // collapse into one event under flaky networks → unread badge stays accurate.
  const lastInsertRefetchRef = useRef(0);
  const lastUpdateRefetchRef = useRef(0);

  const queryKey = useMemo(
    () => ["dm-list", currentUserId, currentUserRole, instituteCode],
    [currentUserId, currentUserRole, instituteCode]
  );
  const cacheKey = `dm_list_${currentUserRole}_${currentUserId}`;

  // Use `initialData` (not `placeholderData`) so the cached list survives
  // offline fetch errors. With `placeholderData`, a failed query leaves
  // `data` undefined and the chat list disappears. `initialData` seeds
  // the query cache itself, so it remains the source of truth until a
  // successful refetch replaces it.
  const cachedList = useMemo(
    () => loadHubCache<DirectConversation[]>(cacheKey) || [],
    [cacheKey]
  );

  const { data: conversations = [], isLoading: loading } = useQuery<DirectConversation[]>({
    queryKey,
    queryFn: () => fetchDMConversations(currentUserId, currentUserRole, instituteCode),
    staleTime: DM_STALE_TIME,
    gcTime: 10 * 60 * 1000,
    enabled: !!currentUserId && !!instituteCode,
    initialData: cachedList,
    initialDataUpdatedAt: 0, // mark stale so a background refetch still fires when online
    refetchOnWindowFocus: true,
  });

  const totalUnread = useMemo(() =>
    conversations.reduce((sum, c) => {
      const count = c.admin_id === currentUserId ? c.admin_unread_count : c.other_user_unread_count;
      return sum + (count || 0);
    }, 0),
    [conversations, currentUserId]
  );

  // Offline pre-warm: whenever the conversation list changes (login,
  // refetch, realtime update), opportunistically cache the latest 20
  // messages of the top 10 chats so DMConversation pages render
  // instantly when offline. Throttled so it doesn't spam the network.
  useEffect(() => {
    if (!currentUserId || conversations.length === 0) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    void prewarmTopConversationMessages(conversations, currentUserId);
  }, [conversations, currentUserId]);

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // B7: separate debounces for INSERT and UPDATE so consecutive events
  // for the same conversation (typical of a brand-new DM) both reach us.
  const debouncedRefetchInsert = useCallback(() => {
    const now = Date.now();
    if (now - lastInsertRefetchRef.current < 500) return;
    lastInsertRefetchRef.current = now;
    refetch();
  }, [refetch]);

  const debouncedRefetchUpdate = useCallback(() => {
    const now = Date.now();
    if (now - lastUpdateRefetchRef.current < 500) return;
    lastUpdateRefetchRef.current = now;
    refetch();
  }, [refetch]);

  // HIGH-02: Use optimistic updates from realtime payload instead of full refetch
  const handleConversationUpdate = useCallback(
    (payload: { new: unknown }) => {
      const updated = payload.new as unknown as DirectConversation;
      queryClient.setQueryData<DirectConversation[]>(queryKey, (prev) => {
        if (!prev) return prev;
        const exists = prev.some((c) => c.id === updated.id);
        let next: DirectConversation[];
        if (exists) {
          next = prev.map((c) => (c.id === updated.id ? updated : c));
        } else {
          next = [...prev, updated];
        }
        return next.sort((a, b) => {
          if (!a.last_message_at && !b.last_message_at) return 0;
          if (!a.last_message_at) return 1;
          if (!b.last_message_at) return -1;
          return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
        });
      });
    },
    [queryClient, queryKey]
  );

  // Real-time subscriptions — listen to direct_conversations only (trigger handles updates)
  // CRIT-03 fix: Removed redundant direct_messages INSERT listener
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
        }, (payload) => {
          if (payload.eventType === "UPDATE") {
            handleConversationUpdate(payload as { new: Record<string, unknown> });
            debouncedRefetchUpdate();
          } else {
            debouncedRefetchInsert();
          }
        })
        .subscribe();

      const ch2 = supabase
        .channel(`dm-list-admin-${currentUserId}-${ts}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "direct_conversations",
          filter: `admin_id=eq.${currentUserId}`,
        }, (payload) => {
          if (payload.eventType === "UPDATE") {
            handleConversationUpdate(payload as { new: Record<string, unknown> });
            debouncedRefetchUpdate();
          } else {
            debouncedRefetchInsert();
          }
        })
        .subscribe();

      channels.push(ch1, ch2);
    } else {
      const filterCol = currentUserRole === "admin" ? "admin_id" : "other_user_id";
      const ch = supabase
        .channel(`dm-list-${currentUserId}-${ts}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "direct_conversations",
          filter: `${filterCol}=eq.${currentUserId}`,
        }, (payload) => {
          if (payload.eventType === "UPDATE") {
            handleConversationUpdate(payload as { new: Record<string, unknown> });
            debouncedRefetchUpdate();
          } else {
            debouncedRefetchInsert();
          }
        })
        .subscribe();
      channels.push(ch);
    }

    channelRef.current = channels;

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
      channelRef.current = [];
    };
  }, [currentUserId, currentUserRole, instituteCode, debouncedRefetchInsert, debouncedRefetchUpdate, handleConversationUpdate]);

  // Refetch on tab visibility
  useEffect(() => {
    if (!currentUserId || !instituteCode) return;
    const handleVis = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [currentUserId, instituteCode, refetch]);

  // HIGH-06: Reconnection handler for offline/online transitions
  useEffect(() => {
    if (!currentUserId || !instituteCode) return;
    const handler = () => {
      if (navigator.onLine) refetch();
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [currentUserId, instituteCode, refetch]);

  return { conversations, totalUnread, loading, refetch };
}
