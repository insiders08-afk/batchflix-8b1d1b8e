import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MessageSquare,
  ArrowLeft,
  Send,
  Loader2,
  Paperclip,
  FileText,
  Image,
  X,
  Download,
  ThumbsUp,
  ThumbsDown,
  ArrowDown,
  Edit2,
  Trash2,
  MoreVertical,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { sendPushNotification, getBatchStudentIds } from "@/lib/pushNotifications";
import { formatChatDate, getMessagePreview } from "@/lib/chatUtils";
import { saveCachedMessages, loadCachedMessages } from "@/lib/chatCache";
import { enqueueTask } from "@/lib/offlineQueue";

const BATCH_MSG_PAGE_SIZE = 50;
const MAX_FILE_SIZE_MB = 10;

interface BatchInfo {
  id: string;
  name: string;
  course: string;
  teacher_name: string | null;
  teacher_id: string | null;
  institute_code: string;
}

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  message: string;
  created_at: string;
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  isSelf?: boolean;
  reply_to_id?: string | null;
  reactions?: Record<string, string[]>;
  is_deleted?: boolean;
  is_edited?: boolean;
}

function sortBatchMessages(messages: ChatMessage[]) {
  return [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

function normalizeBatchMessage(message: ChatMessage, currentUserId: string): ChatMessage {
  return {
    ...message,
    reactions: (message.reactions ?? {}) as Record<string, string[]>,
    isSelf: message.sender_id === currentUserId,
  };
}

function matchesOptimisticBatchMessage(local: ChatMessage, incoming: ChatMessage) {
  return (
    local.id.startsWith("optimistic-") &&
    local.sender_id === incoming.sender_id &&
    local.message === incoming.message &&
    (local.file_url ?? null) === (incoming.file_url ?? null) &&
    (local.reply_to_id ?? null) === (incoming.reply_to_id ?? null)
  );
}

function mergeFetchedBatchMessages(fetched: ChatMessage[], existing: ChatMessage[]) {
  const pendingOptimistic = existing.filter(
    (local) =>
      local.id.startsWith("optimistic-") &&
      !fetched.some((incoming) => matchesOptimisticBatchMessage(local, incoming)),
  );
  return sortBatchMessages([...fetched, ...pendingOptimistic]);
}

export default function BatchWorkspace() {
  const { id: batchId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { authUser } = useAuth();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialScrollDone = useRef(false);
  const mountedRef = useRef(true);
  const chatChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const currentUserId = authUser?.userId ?? "";
  const currentUserName = authUser?.userName ?? "";
  const currentUserRole = authUser?.userRole ?? "student";
  const [studentCount, setStudentCount] = useState(0);
  const [criticalLoading, setCriticalLoading] = useState(true);
  const [chatChannelStatus, setChatChannelStatus] = useState<string>("CONNECTING");

  // Chat
  const batchCacheKey = `batch_${batchId}`;
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadCachedMessages<ChatMessage>(batchCacheKey)
  );
  const [hasMoreMsgs, setHasMoreMsgs] = useState(true);
  const [loadingMoreMsgs, setLoadingMoreMsgs] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [reactionsViewerMsg, setReactionsViewerMsg] = useState<ChatMessage | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mark batch as read on mount and tab focus + zero unread badge in hub cache
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!batchId || !currentUserId) return;
    const markRead = async () => {
      if (document.visibilityState === "visible") {
        await supabase.rpc("mark_batch_read", { p_batch_id: batchId });
        const ic = authUser?.instituteCode ?? "";
        if (ic) {
          queryClient.setQueryData<Record<string, number>>(
            ["batch-unread-counts", currentUserId, ic],
            (prev) => ({ ...(prev ?? {}), [batchId]: 0 })
          );
          queryClient.invalidateQueries({
            queryKey: ["batch-unread-counts", currentUserId, ic],
          });
        }
      }
    };
    void markRead();
    const handleVisibilityChange = () => {
      void markRead();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [batchId, currentUserId, authUser?.instituteCode, queryClient]);

  const handleBack = () => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  // Load batch info + initial messages
  useEffect(() => {
    if (!batchId || !currentUserId) return;
    const init = async () => {
      try {
        const [batchRes, countRes, msgsRes] = await Promise.all([
          supabase.from("batches").select("*").eq("id", batchId).single(),
          supabase.from("students_batches").select("id", { count: "exact" }).eq("batch_id", batchId),
          supabase.from("batch_messages").select("*").eq("batch_id", batchId).order("created_at", { ascending: false }).limit(BATCH_MSG_PAGE_SIZE),
        ]);

        if (batchRes.data) setBatch(batchRes.data);
        setStudentCount(countRes.count || 0);
        if (msgsRes.data) {
          const mapped = msgsRes.data
            .reverse()
            .map((m) => normalizeBatchMessage(m as ChatMessage, currentUserId));
          setMessages((prev) => {
            const next = mergeFetchedBatchMessages(mapped, prev);
            saveCachedMessages(batchCacheKey, next);
            return next;
          });
          setHasMoreMsgs(msgsRes.data.length === BATCH_MSG_PAGE_SIZE);
        }
      } catch (err) {
        console.error("[BatchWorkspace] init error:", err);
      } finally {
        setCriticalLoading(false);
      }
    };
    init();
  }, [batchId, currentUserId, batchCacheKey]);

  // Load older batch messages (scroll-up pagination)
  const loadOlderBatchMessages = useCallback(async () => {
    if (!batchId || loadingMoreMsgs || !hasMoreMsgs) return;
    setLoadingMoreMsgs(true);
    const oldest = messages[0];
    if (!oldest) { setLoadingMoreMsgs(false); return; }

    const { data } = await supabase
      .from("batch_messages")
      .select("*")
      .eq("batch_id", batchId)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(BATCH_MSG_PAGE_SIZE);

    if (data) {
      const mapped = data.reverse().map((m) => ({
        ...m,
        reactions: (m.reactions ?? {}) as Record<string, string[]>,
        isSelf: m.sender_id === currentUserId,
      }));
      setMessages((prev) => [...mapped, ...prev]);
      setHasMoreMsgs(data.length === BATCH_MSG_PAGE_SIZE);
    } else {
      setHasMoreMsgs(false);
    }
    setLoadingMoreMsgs(false);
  }, [batchId, currentUserId, messages, loadingMoreMsgs, hasMoreMsgs]);

  // Realtime chat subscription
  useEffect(() => {
    if (!batchId) return;

    if (chatChannelRef.current) {
      supabase.removeChannel(chatChannelRef.current);
      chatChannelRef.current = null;
    }

    setChatChannelStatus("CONNECTING");

    const channel = supabase
      .channel(`batch-chat-${batchId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "batch_messages", filter: `batch_id=eq.${batchId}` },
        (payload) => {
          if (!mountedRef.current) return;
          const msg = normalizeBatchMessage(payload.new as ChatMessage, currentUserId);
          setMessages((prev) => {
            const filtered = prev.filter((m) => !matchesOptimisticBatchMessage(m, msg));
            if (filtered.some((m) => m.id === msg.id)) return filtered;
            const next = sortBatchMessages([...filtered, msg]);
            saveCachedMessages(batchCacheKey, next);
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "batch_messages", filter: `batch_id=eq.${batchId}` },
        (payload) => {
          if (!mountedRef.current) return;
          const updated = payload.new as ChatMessage;
          setMessages((prev) => {
            const next = prev.map((m) =>
              m.id === updated.id
                ? {
                    ...m,
                    reactions: (updated.reactions ?? {}) as Record<string, string[]>,
                    message: updated.message,
                    is_deleted: updated.is_deleted,
                    is_edited: updated.is_edited,
                    file_url: updated.file_url,
                    file_name: updated.file_name,
                    file_type: updated.file_type,
                  }
                : m,
            );
            saveCachedMessages(batchCacheKey, next);
            return next;
          });
        },
      )
      .subscribe((status) => {
        if (!mountedRef.current) return;
        setChatChannelStatus(status);
      });

    chatChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      if (chatChannelRef.current === channel) {
        chatChannelRef.current = null;
      }
    };
  }, [batchId, currentUserId, batchCacheKey]);

  // Core scroll helper
  const scrollToBottom = useCallback((_behavior: ScrollBehavior = "smooth") => {
    const container = chatContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollDown(distFromBottom > 100);
  }, []);

  // Initial-load scroll-to-bottom + ResizeObserver
  useEffect(() => {
    if (criticalLoading) return;
    if (messages.length === 0) return;

    const container = chatContainerRef.current;
    if (!container) return;

    if (!initialScrollDone.current) {
      container.scrollTop = container.scrollHeight;
      initialScrollDone.current = true;
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollDown(distFromBottom > 100);
    }

    const observer = new ResizeObserver(() => {
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (dist < 300) {
        container.scrollTop = container.scrollHeight;
        setShowScrollDown(false);
      }
    });
    observer.observe(container);

    const handleResize = () => {
      if (initialScrollDone.current) {
        const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (dist < 300) {
          container.scrollTop = container.scrollHeight;
        }
      }
    };
    window.visualViewport?.addEventListener("resize", handleResize);

    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [criticalLoading, messages.length]);

  // Auto-scroll for incoming realtime messages
  const prevMsgCount = useRef(0);
  useEffect(() => {
    const newCount = messages.length;
    if (!initialScrollDone.current) return;

    if (newCount > prevMsgCount.current) {
      const container = chatContainerRef.current;
      if (container) {
        const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (dist < 300) {
          scrollToBottom("smooth");
        } else {
          setShowScrollDown(true);
        }
      }
    }
    prevMsgCount.current = newCount;
  }, [messages, scrollToBottom]);

  const uploadChatFile = async (file: File): Promise<{ url: string; name: string; type: string } | null> => {
    if (!currentUserId) return null;
    const ext = file.name.split(".").pop() || "bin";
    const mimeType = file.type || (ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : "application/octet-stream");
    const path = `${currentUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from("chat-files")
      .upload(path, file, { contentType: mimeType, upsert: false });
    if (error) {
      toast({ title: "Upload error", description: error.message, variant: "destructive" });
      return null;
    }
    const { data: publicData } = supabase.storage.from("chat-files").getPublicUrl(path);
    return { url: publicData.publicUrl, name: file.name, type: mimeType };
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast({ title: `File too large (max ${MAX_FILE_SIZE_MB} MB)`, variant: "destructive" });
      return;
    }
    setAttachedFile(file);
    e.target.value = "";
  };

  const sendMessage = async () => {
    if ((!chatInput.trim() && !attachedFile) || !batch || !currentUserId) return;
    setSendingMsg(true);

    if (editingMessage) {
      const { error } = await supabase
        .from("batch_messages")
        .update({ message: chatInput.trim(), is_edited: true })
        .eq("id", editingMessage.id);

      if (!error) {
        setChatInput("");
        setEditingMessage(null);
        setTimeout(() => inputRef.current?.focus(), 50);
      } else {
        toast({ title: "Failed to edit message", variant: "destructive" });
      }
      setSendingMsg(false);
      return;
    }

    let fileData: { url: string; name: string; type: string } | null = null;
    if (attachedFile) {
      setUploadingFile(true);
      fileData = await uploadChatFile(attachedFile);
      setUploadingFile(false);
      if (!fileData) {
        toast({ title: "File upload failed", variant: "destructive" });
        setSendingMsg(false);
        return;
      }
    }

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      sender_id: currentUserId,
      sender_name: currentUserName,
      sender_role: currentUserRole,
      message: chatInput.trim() || (fileData ? `📎 ${fileData.name}` : ""),
      created_at: new Date().toISOString(),
      file_url: fileData?.url ?? null,
      file_name: fileData?.name ?? null,
      file_type: fileData?.type ?? null,
      reply_to_id: replyingTo?.id ?? null,
      reactions: {},
      is_deleted: false,
      is_edited: false,
      isSelf: true,
    };
    setMessages((prev) => {
      const next = sortBatchMessages([...prev, optimisticMsg]);
      saveCachedMessages(batchCacheKey, next);
      return next;
    });
    scrollToBottom("smooth");

    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    if (offline) {
      if (fileData) {
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== optimisticId);
          saveCachedMessages(batchCacheKey, next);
          return next;
        });
        toast({
          title: "You're offline",
          description: "File attachments need an internet connection.",
          variant: "destructive",
        });
        setSendingMsg(false);
        return;
      }
      enqueueTask({
        type: "batch_message",
        payload: {
          batch_id: batchId!,
          institute_code: batch.institute_code,
          sender_id: currentUserId,
          sender_name: currentUserName,
          sender_role: currentUserRole,
          message: chatInput.trim(),
          reply_to_id: replyingTo?.id ?? null,
          optimisticId,
        },
      });
      setChatInput("");
      setReplyingTo(null);
      setSendingMsg(false);
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }

    const { data: insertedMessage, error } = await supabase
      .from("batch_messages")
      .insert({
        batch_id: batchId!,
        institute_code: batch.institute_code,
        sender_id: currentUserId,
        sender_name: currentUserName,
        sender_role: currentUserRole,
        message: chatInput.trim() || (fileData ? `📎 ${fileData.name}` : ""),
        file_url: fileData?.url ?? null,
        file_name: fileData?.name ?? null,
        file_type: fileData?.type ?? null,
        reply_to_id: replyingTo?.id ?? null,
      } as any)
      .select()
      .single();

    if (!error && insertedMessage) {
      const normalizedInserted = normalizeBatchMessage(insertedMessage as ChatMessage, currentUserId);
      setMessages((prev) => {
        const withoutOptimistic = prev.filter(
          (m) => m.id !== optimisticId && !matchesOptimisticBatchMessage(m, normalizedInserted),
        );
        if (withoutOptimistic.some((m) => m.id === normalizedInserted.id)) {
          saveCachedMessages(batchCacheKey, withoutOptimistic);
          return withoutOptimistic;
        }
        const next = sortBatchMessages([...withoutOptimistic, normalizedInserted]);
        saveCachedMessages(batchCacheKey, next);
        return next;
      });

      setChatInput("");
      setAttachedFile(null);
      setReplyingTo(null);
      setEditingMessage(null);
      setTimeout(() => inputRef.current?.focus(), 50);

      const msgText = chatInput.trim() || `📎 ${fileData?.name || "File shared"}`;

      if ((currentUserRole === "teacher" || currentUserRole === "admin") && batch) {
        const studentIds = await getBatchStudentIds(batchId!);
        if (studentIds.length > 0) {
          sendPushNotification({
            institute_code: batch.institute_code,
            title: `${currentUserName} (${batch.name})`,
            body: msgText,
            url: `/batch/${batchId}`,
            target_user_ids: studentIds,
          });
        }
      }

      if (currentUserRole === "student" && batch?.teacher_id) {
        sendPushNotification({
          institute_code: batch.institute_code,
          title: `${currentUserName} in ${batch.name}`,
          body: msgText,
          url: `/batch/${batchId}`,
          target_user_ids: [batch.teacher_id],
        });
      }
    } else {
      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== optimisticId);
        saveCachedMessages(batchCacheKey, next);
        return next;
      });
      toast({ title: "Failed to send message", description: error?.message, variant: "destructive" });
    }
    setSendingMsg(false);
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;

    const currentReactions = msg.reactions || {};
    const users = currentReactions[emoji] || [];
    const hasReacted = users.includes(currentUserId);

    const newUsers = hasReacted ? users.filter((id) => id !== currentUserId) : [...users, currentUserId];
    const newReactions = { ...currentReactions, [emoji]: newUsers };

    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: newReactions } : m)));

    const { error } = await supabase
      .from("batch_messages")
      .update({ reactions: newReactions } as any)
      .eq("id", messageId);

    if (error) {
      toast({ title: "Error updating reaction", variant: "destructive" });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: currentReactions } : m)));
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    const { error } = await supabase
      .from("batch_messages")
      .update({
        is_deleted: true,
        message: "This message was deleted",
        file_url: null,
        file_name: null,
        file_type: null,
      })
      .eq("id", messageId);

    if (error) {
      toast({ title: "Error deleting message", variant: "destructive" });
    }
    setMessageToDelete(null);
  };

  const resolveReactorNames = (userIds: string[]) => {
    return userIds.map((id) => {
      if (id === currentUserId) return "You";
      if (id === batch?.teacher_id) return batch.teacher_name || "Teacher";
      return "Member";
    });
  };

  const isImage = (type: string | null | undefined) => type?.startsWith("image/");
  const isPDF = (type: string | null | undefined) => type === "application/pdf";

  if (criticalLoading) {
    return (
      <div className="fixed inset-0 flex flex-col bg-background">
        <header className="border-b border-border/50 bg-card flex items-center gap-3 px-4 h-14 flex-shrink-0">
          <div className="w-8 h-8 bg-muted rounded-lg animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-muted rounded w-32 animate-pulse" />
            <div className="h-2.5 bg-muted rounded w-20 animate-pulse" />
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <p className="text-muted-foreground mb-3">Batch not found</p>
          <Button onClick={handleBack}>Go Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card flex items-center gap-3 px-4 h-14 flex-shrink-0">
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={handleBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="w-8 h-8 rounded-lg gradient-hero flex items-center justify-center text-white text-xs font-bold">
          {batch.name.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-semibold text-sm leading-none">{batch.name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {batch.teacher_name || "No teacher"} · {studentCount} students
          </p>
        </div>
        <Badge variant="secondary" className="text-xs hidden sm:flex">
          {batch.course}
        </Badge>
        <div className={`flex items-center gap-1 text-xs ${chatChannelStatus === "SUBSCRIBED" ? "text-success" : "text-warning"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${chatChannelStatus === "SUBSCRIBED" ? "bg-success animate-pulse" : "bg-warning"}`} />
          {chatChannelStatus === "SUBSCRIBED" ? "Live" : "Connecting…"}
        </div>
      </header>

      {/* Chat surface (full-screen, no tabs) */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <div
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-3"
          onScroll={(e) => {
            const target = e.currentTarget;
            const distFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
            setShowScrollDown(distFromBottom > 100);
            if (target.scrollTop < 60 && hasMoreMsgs && !loadingMoreMsgs) {
              loadOlderBatchMessages();
            }
          }}
        >
          {loadingMoreMsgs && (
            <div className="flex justify-center py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!hasMoreMsgs && messages.length > 0 && (
            <p className="text-center text-xs text-muted-foreground py-2">Beginning of conversation</p>
          )}

          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No messages yet. Start the conversation!</p>
            </div>
          )}

          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              drag="x"
              dragSnapToOrigin={true}
              dragConstraints={msg.isSelf ? { left: 0, right: 70 } : { left: -70, right: 0 }}
              dragElastic={0.15}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                if (msg.isSelf && info.offset.x > 60) {
                  setReplyingTo(msg);
                } else if (!msg.isSelf && info.offset.x < -60) {
                  setReplyingTo(msg);
                }
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("flex gap-2.5 relative group", msg.isSelf ? "flex-row-reverse" : "flex-row")}
            >
              {!msg.isSelf && (
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5",
                    msg.sender_role === "teacher" || msg.sender_role === "admin"
                      ? "gradient-hero"
                      : "bg-secondary border border-border",
                  )}
                >
                  <span
                    className={
                      msg.sender_role === "teacher" || msg.sender_role === "admin" ? "" : "text-foreground"
                    }
                  >
                    {msg.sender_name
                      .split(" ")
                      .map((n: string) => n[0])
                      .join("")
                      .slice(0, 2)}
                  </span>
                </div>
              )}
              <div
                className={cn(
                  "max-w-xs lg:max-w-md",
                  msg.isSelf ? "items-end" : "items-start",
                  "flex flex-col gap-0.5",
                )}
              >
                {!msg.isSelf && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold">{msg.sender_name}</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-xs px-1.5 py-0",
                        (msg.sender_role === "teacher" || msg.sender_role === "admin") &&
                          "bg-primary-light text-primary border-primary/20",
                      )}
                    >
                      {msg.sender_role}
                    </Badge>
                  </div>
                )}
                <div
                  className={cn(
                    "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
                    msg.isSelf
                      ? "gradient-hero text-white rounded-tr-sm"
                      : "bg-card border border-border/60 rounded-tl-sm",
                  )}
                >
                  {msg.is_deleted ? (
                    <div className="italic text-muted-foreground flex items-center gap-1.5 opacity-80">
                      <Trash2 className="w-3.5 h-3.5" /> This message was deleted
                    </div>
                  ) : (
                    <>
                      {msg.reply_to_id && (
                        <div
                          className={cn(
                            "mb-2 p-2 rounded-lg border-l-4 bg-black/5 text-xs truncate",
                            msg.isSelf ? "border-white/40 text-white/90" : "border-primary/40 text-muted-foreground",
                          )}
                        >
                          {getMessagePreview(messages.find((m) => m.id === msg.reply_to_id) || {})}
                        </div>
                      )}
                      {msg.file_url && (
                        <div className="mb-1.5">
                          {isImage(msg.file_type) ? (
                            <a href={msg.file_url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={msg.file_url}
                                alt={msg.file_name || "image"}
                                className="max-w-[200px] max-h-[160px] rounded-lg object-cover border border-white/20"
                                loading="lazy"
                                width={200}
                                height={160}
                                onLoad={() => {
                                  const container = chatContainerRef.current;
                                  if (!container) return;
                                  const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
                                  if (dist < 300) container.scrollTop = container.scrollHeight;
                                }}
                              />
                            </a>
                          ) : (
                            <a
                              href={msg.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium",
                                msg.isSelf ? "bg-white/20 text-white" : "bg-muted text-foreground",
                              )}
                            >
                              {isPDF(msg.file_type) ? (
                                <FileText className="w-4 h-4 flex-shrink-0" />
                              ) : (
                                <Download className="w-4 h-4 flex-shrink-0" />
                              )}
                              <span className="truncate max-w-[140px]">{msg.file_name || "Download file"}</span>
                            </a>
                          )}
                        </div>
                      )}
                      {msg.message && msg.message !== msg.file_name && (
                        <span>{msg.message}</span>
                      )}
                    </>
                  )}
                </div>
                {!msg.is_deleted && msg.isSelf && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="w-5 h-5 absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="w-3 h-3 text-current opacity-80" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      {new Date(msg.created_at).getTime() > Date.now() - 20 * 60 * 1000 && !msg.file_url && (
                        <DropdownMenuItem onClick={() => { setEditingMessage(msg); setChatInput(msg.message); setTimeout(() => inputRef.current?.focus(), 50); }}>
                          <Edit2 className="w-4 h-4 mr-2" /> Edit
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-danger focus:text-danger" onClick={() => setMessageToDelete(msg.id)}>
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <div className="flex items-center gap-3 mt-1 px-1">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    {formatChatDate(msg.created_at)}
                    {msg.is_edited && <span className="italic opacity-70">(Edited)</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReaction(msg.id, "👍")}
                      className={cn(
                        "flex items-center gap-1 p-1 rounded-md transition-colors hover:bg-muted",
                        msg.reactions?.["👍"]?.includes(currentUserId) && "text-primary bg-primary-light/30",
                      )}
                    >
                      <ThumbsUp className="w-3 h-3" />
                      {msg.reactions?.["👍"]?.length > 0 && (
                        <span className="text-[10px] font-bold">{msg.reactions["👍"].length}</span>
                      )}
                    </button>
                    <button
                      onClick={() => handleReaction(msg.id, "👎")}
                      className={cn(
                        "flex items-center gap-1 p-1 rounded-md transition-colors hover:bg-muted",
                        msg.reactions?.["👎"]?.includes(currentUserId) && "text-danger bg-danger-light/30",
                      )}
                    >
                      <ThumbsDown className="w-3 h-3" />
                      {msg.reactions?.["👎"]?.length > 0 && (
                        <span className="text-[10px] font-bold">{msg.reactions["👎"].length}</span>
                      )}
                    </button>
                    {(Object.keys(msg.reactions || {}).reduce((acc, cur) => acc + (msg.reactions?.[cur]?.length || 0), 0) > 0) && (
                      <button
                        onClick={() => setReactionsViewerMsg(msg)}
                        className="text-[10px] font-semibold text-primary hover:underline ml-1"
                      >
                        See
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Reactions Viewer Dialog */}
        {reactionsViewerMsg && (
          <Dialog open={!!reactionsViewerMsg} onOpenChange={(open) => !open && setReactionsViewerMsg(null)}>
            <DialogContent className="sm:max-w-xs">
              <DialogHeader>
                <DialogTitle className="font-display">Reactions</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2 max-h-[60vh] overflow-y-auto">
                {["👍", "👎"].map((emoji) => {
                  const userIds = reactionsViewerMsg.reactions?.[emoji] || [];
                  if (userIds.length === 0) return null;
                  const names = resolveReactorNames(userIds);
                  return (
                    <div key={emoji} className="space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <span>{emoji}</span>
                        <Badge variant="secondary" className="px-1.5 py-0 min-w-5 justify-center">{userIds.length}</Badge>
                      </h4>
                      <div className="space-y-1.5 pl-2 border-l-2 border-border/50">
                        {names.map((name, i) => (
                          <p key={userIds[i] || i} className="text-sm">{name}</p>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!messageToDelete} onOpenChange={(open) => !open && setMessageToDelete(null)}>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete message?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently hide the message from everyone in the batch. You cannot undo this action.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-danger text-white hover:bg-danger/90"
                onClick={() => messageToDelete && handleDeleteMessage(messageToDelete)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Replying-to preview */}
        {replyingTo && (
          <div className="px-4 py-2 bg-muted/30 border-t border-border/40 flex items-center justify-between animate-in slide-in-from-bottom-2">
            <div className="flex-1 min-w-0 border-l-2 border-primary pl-3 py-1">
              <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
                Replying to {replyingTo.sender_name}
              </p>
              <p className="text-sm text-muted-foreground truncate">{getMessagePreview(replyingTo)}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 rounded-full"
              onClick={() => setReplyingTo(null)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Editing context bar */}
        {editingMessage && (
          <div className="px-4 py-2 bg-amber-500/10 border-t border-amber-500/20 flex items-center justify-between">
            <div className="flex-1 min-w-0 border-l-2 border-amber-500 pl-3 py-1">
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Editing message</p>
              <p className="text-sm text-muted-foreground truncate">{editingMessage.message}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 rounded-full"
              onClick={() => { setEditingMessage(null); setChatInput(""); }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        {attachedFile && (
          <div className="px-3 py-2 bg-muted/50 border-t border-border/40 flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0 bg-card border border-border/50 rounded-lg px-3 py-1.5">
              {attachedFile.type.startsWith("image/") ? (
                <Image className="w-4 h-4 text-primary flex-shrink-0" />
              ) : (
                <FileText className="w-4 h-4 text-primary flex-shrink-0" />
              )}
              <span className="text-xs truncate text-foreground">{attachedFile.name}</span>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {(attachedFile.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-muted-foreground hover:text-danger flex-shrink-0"
              onClick={() => setAttachedFile(null)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {/* Scroll-to-bottom FAB */}
        <AnimatePresence>
          {showScrollDown && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-[80px] right-4 z-20"
            >
              <Button
                size="icon"
                className="rounded-full shadow-xl gradient-hero text-white border-0 w-11 h-11 hover:opacity-90"
                onClick={() => scrollToBottom("smooth")}
              >
                <ArrowDown className="w-5 h-5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat input */}
        <div className="border-t border-border/50 p-3 bg-card flex gap-2 items-end" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
            onChange={handleFileSelect}
          />
          <Button
            onMouseDown={(e) => e.preventDefault()}
            variant="ghost"
            size="icon"
            className="w-9 h-9 text-muted-foreground hover:text-primary flex-shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={sendingMsg || uploadingFile}
            title="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Input
            ref={inputRef}
            placeholder={editingMessage ? "Edit your message..." : "Type a message..."}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            className="flex-1 h-9"
          />
          {editingMessage ? (
            <>
              <Button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setEditingMessage(null); setChatInput(""); }}
                size="icon"
                variant="ghost"
                className="w-9 h-9 flex-shrink-0"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </Button>
              <Button
                onMouseDown={(e) => e.preventDefault()}
                onClick={sendMessage}
                size="icon"
                disabled={sendingMsg || !chatInput.trim()}
                className="w-9 h-9 gradient-hero text-white border-0 hover:opacity-90 flex-shrink-0"
              >
                {sendingMsg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </Button>
            </>
          ) : (
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={sendMessage}
              size="icon"
              disabled={sendingMsg || (!chatInput.trim() && !attachedFile)}
              className="w-9 h-9 gradient-hero text-white border-0 hover:opacity-90 flex-shrink-0"
            >
              {sendingMsg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
