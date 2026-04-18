/**
 * useDMPrefetch — Offline pre-warm for top DM threads
 *
 * Fires after the DM list loads and silently fetches the newest 50 messages
 * for the top-10 conversations (sorted by last_message_at) into localStorage.
 *
 * Per-conversation throttling (1 min) keeps the cache fresh while preventing
 * request storms on repeated re-renders. Always re-fetches after the throttle
 * window so the cached 50-message tail stays current.
 */
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { saveCachedMessages } from "@/lib/chatCache";
import type { DirectConversation } from "@/types/chat";

const PREFETCH_TOP_N = 10;
const PREFETCH_LIMIT = 50;
const PER_CONV_THROTTLE_MS = 60 * 1000;
const lastPrefetchByConv: Record<string, number> = {};

async function prefetchConversation(conv: DirectConversation) {
  const cacheKey = `dm_${conv.id}`;
  const now = Date.now();
  // Per-conversation throttle so we don't refetch the same chat on every
  // hub re-render, but always refresh after the throttle expires so the
  // cached 50-message window stays current.
  if (now - (lastPrefetchByConv[conv.id] || 0) < PER_CONV_THROTTLE_MS) return;
  lastPrefetchByConv[conv.id] = now;

  try {
    const { data } = await supabase
      .from("direct_messages")
      .select("*")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(PREFETCH_LIMIT);

    if (data && data.length > 0) {
      saveCachedMessages(cacheKey, [...data].reverse());
    }
  } catch {
    // Prefetch is best-effort — silently ignore failures
  }
}

export function useDMPrefetch(conversations: DirectConversation[]) {
  useEffect(() => {
    if (conversations.length === 0) return;

    // Take the top-N most recently active conversations
    const top = conversations
      .filter((c) => c.last_message_at) // only those with activity
      .slice(0, PREFETCH_TOP_N);

    if (top.length === 0) return;

    // Run during idle time so we don't compete with the UI
    const idle =
      typeof requestIdleCallback !== "undefined"
        ? requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 300);

    idle(() => {
      // Fire all prefetch requests concurrently in the idle window
      top.forEach((conv) => prefetchConversation(conv));
    });
  }, [conversations]);
}
