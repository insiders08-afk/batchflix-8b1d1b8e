import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Send, Paperclip, X, FileText, Image as ImageIcon,
  Download, Trash2, Edit2, MoreVertical, ThumbsUp, ThumbsDown,
  ArrowDown, Loader2, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDirectMessages } from "@/hooks/useDirectMessages";
import type { DirectMessage } from "@/types/chat";
import { useToast } from "@/hooks/use-toast";
import { formatChatDate, getMessagePreview, roleLabel } from "@/lib/chatUtils";
import { useAuth } from "@/contexts/AuthContext";
import { getOtherRoleFromDmType } from "@/types/chat";
import type { DmType } from "@/types/chat";

const MAX_FILE_SIZE_MB = 10;

// Role-based avatar colors
const ROLE_AVATAR: Record<string, string> = {
  admin:   "gradient-hero",
  teacher: "gradient-hero",
  student: "bg-secondary border border-border",
};
function roleAvatar(role: string) {
  return ROLE_AVATAR[role] ?? "bg-slate-500";
}

export default function DMConversation() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { authUser } = useAuth();

  const currentUserId = authUser?.userId ?? "";
  const currentUserName = authUser?.userName ?? "";
  const currentUserRole = authUser?.userRole ?? "student";
  const instituteCode = authUser?.instituteCode ?? "";

  const [otherUserName, setOtherUserName] = useState("...");
  const [otherUserRole, setOtherUserRole] = useState("");
  const [pageLoading, setPageLoading] = useState(true);

  // Chat UI state
  const [chatInput, setChatInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DirectMessage | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

  // ── Conversation info (only 2 queries now — no auth/profile fetch) ──
  useEffect(() => {
    if (!currentUserId || !conversationId) return;
    const init = async () => {
      const { data: conv } = await supabase
        .from("direct_conversations")
        .select("admin_id, other_user_id, dm_type")
        .eq("id", conversationId)
        .single();

      if (conv) {
        const isAdminSide = conv.admin_id === currentUserId;
        const otherId = isAdminSide ? conv.other_user_id : conv.admin_id;
        const expectedOtherRole = getOtherRoleFromDmType(conv.dm_type as DmType, isAdminSide);

        const { data: otherProfile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", otherId)
          .eq("role", expectedOtherRole as any)
          .maybeSingle();

        setOtherUserName(otherProfile?.full_name || "User");
        setOtherUserRole(expectedOtherRole);
      }

      setPageLoading(false);
    };
    init();
  }, [conversationId, currentUserId]);

  // ── Messages hook ───────────────────────────────────────────
  const {
    messages,
    loading: msgsLoading,
    loadingMore,
    hasMore,
    loadOlderMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    reactToMessage,
    markAsRead,
    channelStatus,
  } = useDirectMessages({
    conversationId: conversationId ?? "",
    currentUserId,
    currentUserName,
    currentUserRole,
    instituteCode,
  });

  // CRIT-01 fix: Only markAsRead when visible + initial scroll done
  useEffect(() => {
    if (!msgsLoading && messages.length > 0 && initialScrollDone.current && document.visibilityState === "visible") {
      markAsRead();
    }
  }, [msgsLoading, messages.length, markAsRead]);

  // CRIT-01: Also mark as read when user returns to tab
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && messages.length > 0 && initialScrollDone.current) {
        markAsRead();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [messages.length, markAsRead]);

  // ── Scroll management (aligned with BatchWorkspace) ──────────────────
  // MED-01 fix: simplified scrollToBottom
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = chatContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setShowScrollDown(false);
  }, []);

  // After messages load for the first time, do a hard instant scroll to bottom.
  // ResizeObserver keeps the user at the bottom if images load and expand the height.
  useEffect(() => {
    if (msgsLoading || pageLoading) return;
    if (messages.length === 0) return;

    // Instant snap to bottom on initial load — use double rAF to ensure DOM is painted
    if (!initialScrollDone.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const container = chatContainerRef.current;
          if (!container) return;
          container.scrollTop = container.scrollHeight;
          initialScrollDone.current = true;
          const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
          setShowScrollDown(distFromBottom > 100);
        });
      });
    }

    const container = chatContainerRef.current;
    if (!container) return;

    // ResizeObserver: if content height grows (e.g. images) AND user is near bottom,
    // keep scrolling so they stay at the bottom.
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
  }, [msgsLoading, pageLoading, messages.length]);

  // Auto-scroll when a NEW message arrives (realtime) — only if already near bottom
  const prevMsgCount = useRef(0);
  useEffect(() => {
    const newCount = messages.length;
    if (!initialScrollDone.current) return; // Don't interfere with initial load
    if (newCount > prevMsgCount.current) {
      const container = chatContainerRef.current;
      if (container) {
        const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (dist < 300) {
          // User was near bottom — scroll for them smoothly
          scrollToBottom("smooth");
        } else {
          // User is reading older messages — just show the button
          setShowScrollDown(true);
        }
      }
    }
    prevMsgCount.current = newCount;
  }, [messages, scrollToBottom]);

  const handleBack = () => {
    navigate(`/${currentUserRole}/chat`);
  };

  // ── File helpers ────────────────────────────────────────────
  const isImage = (type: string | null | undefined) => type?.startsWith("image/");
  const isPDF = (type: string | null | undefined) => type === "application/pdf";

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      // B-4: Use toast instead of alert()
      toast({ title: `File too large (max ${MAX_FILE_SIZE_MB} MB)`, variant: "destructive" });
      return;
    }
    setAttachedFile(file);
    e.target.value = "";
  };

  // ── Send handler ────────────────────────────────────────────
  const handleSend = async () => {
    if ((!chatInput.trim() && !attachedFile) || sendingMsg) return;
    setSendingMsg(true);

    if (editingMessage) {
      await editMessage(editingMessage.id, chatInput.trim());
      setChatInput("");
      setEditingMessage(null);
      setSendingMsg(false);
      return;
    }

    if (attachedFile) setUploadingFile(true);
    await sendMessage({
      text: chatInput.trim(),
      file: attachedFile,
      replyToId: replyingTo?.id,
    });
    if (attachedFile) setUploadingFile(false);

    setChatInput("");
    setAttachedFile(null);
    setReplyingTo(null);
    setEditingMessage(null);
    setSendingMsg(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // B-14: Resolve reactor names from known participants (1-on-1 DM)
  const resolveReactorName = (userId: string) => {
    if (userId === currentUserId) return "You";
    return otherUserName || "User";
  };

  if (pageLoading || msgsLoading) {
    return (
      <div className="fixed inset-0 flex flex-col bg-background">
        <header className="border-b border-border/50 bg-card flex items-center gap-3 px-3 h-14 flex-shrink-0">
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

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* ── Header ── */}
      <header className="border-b border-border/50 bg-card flex items-center gap-3 px-3 h-14 flex-shrink-0">
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={handleBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>

        <div
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0",
            roleAvatar(otherUserRole)
          )}
        >
          {otherUserName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-none truncate">{otherUserName}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{roleLabel(otherUserRole)}</p>
        </div>

        {/* B-14: Real-time "Live" indicator based on channel status */}
        <div className="flex items-center gap-1 text-xs">
          <span className={cn(
            "w-1.5 h-1.5 rounded-full",
            channelStatus === "SUBSCRIBED" ? "bg-success animate-pulse" : "bg-yellow-500"
          )} />
          <span className={channelStatus === "SUBSCRIBED" ? "text-success" : "text-yellow-500"}>
            {channelStatus === "SUBSCRIBED" ? "Live" : "Connecting"}
          </span>
        </div>
      </header>

      {/* ── Messages ── */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-3"
        style={{ touchAction: "pan-y" }}
        onScroll={(e) => {
          const t = e.currentTarget;
          setShowScrollDown(t.scrollHeight - t.scrollTop - t.clientHeight > 100);
          // Load older messages when scrolled to top
          if (t.scrollTop < 60 && hasMore && !loadingMore) {
            loadOlderMessages();
          }
        }}
      >
        {/* Load more indicator */}
        {loadingMore && (
          <div className="flex justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!hasMore && messages.length > 0 && (
          <p className="text-center text-xs text-muted-foreground py-2">Beginning of conversation</p>
        )}

        {messages.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl">💬</span>
            </div>
            <p className="text-sm">No messages yet. Start the conversation!</p>
          </div>
        )}

        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            drag="x"
            dragSnapToOrigin
            // B-25: Aligned drag constraints with tighter values
            dragConstraints={msg.isSelf ? { left: 0, right: 70 } : { left: -70, right: 0 }}
            dragElastic={0.15}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (msg.isSelf && info.offset.x > 60) setReplyingTo(msg);
              else if (!msg.isSelf && info.offset.x < -60) setReplyingTo(msg);
            }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("flex gap-2.5 relative group", msg.isSelf ? "flex-row-reverse" : "flex-row")}
          >
            {/* Avatar for other user */}
            {!msg.isSelf && (
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5",
                  ROLE_AVATAR[msg.sender_role]
                )}
              >
                <span className={cn(ROLE_AVATAR[msg.sender_role] === "gradient-hero" ? "text-white" : "text-foreground")}>
                  {msg.sender_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                </span>
              </div>
            )}

            <div className={cn("max-w-xs lg:max-w-md flex flex-col gap-0.5", msg.isSelf ? "items-end" : "items-start")}>
              {/* Sender name + role (for non-self) */}
              {!msg.isSelf && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold">{msg.sender_name}</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-primary-light text-primary border-primary/20">
                    {roleLabel(msg.sender_role)}
                  </Badge>
                </div>
              )}

              {/* Bubble */}
              <div
                className={cn(
                  "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
                  msg.isSelf
                    ? "gradient-hero text-white rounded-tr-sm"
                    : "bg-card border border-border/60 rounded-tl-sm"
                )}
              >
                {msg.is_deleted ? (
                  <div className="italic text-muted-foreground flex items-center gap-1.5 opacity-80">
                    <Trash2 className="w-3.5 h-3.5" /> This message was deleted
                  </div>
                ) : (
                  <>
                    {/* B-13: Smart reply reference */}
                    {msg.reply_to_id && (
                      <div
                        className={cn(
                          "mb-2 p-2 rounded-lg border-l-4 bg-black/5 text-xs truncate",
                          msg.isSelf ? "border-white/40 text-white/90" : "border-primary/40 text-muted-foreground"
                        )}
                      >
                        {getMessagePreview(messages.find((m) => m.id === msg.reply_to_id) || {})}
                      </div>
                    )}

                    {/* File attachment */}
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
                              // MED-10: Removed onLoad scroll — ResizeObserver handles this
                            />
                          </a>
                        ) : (
                          <a
                            href={msg.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium",
                              msg.isSelf ? "bg-white/20 text-white" : "bg-muted text-foreground"
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

                    {/* Message text — hide if it's just the file emoji prefix */}
                    {msg.message && msg.message !== msg.file_name && !msg.message.startsWith("📎 ") && (
                      <span>{msg.message}</span>
                    )}
                  </>
                )}
              </div>

              {/* Message options (own messages) */}
              {!msg.is_deleted && msg.isSelf && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-5 h-5 absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical className="w-3 h-3 opacity-80" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-32">
                    {new Date(msg.created_at).getTime() > Date.now() - 20 * 60 * 1000 && !msg.file_url && (
                      <DropdownMenuItem
                        onClick={() => {
                          setEditingMessage(msg);
                          setChatInput(msg.message);
                          setTimeout(() => inputRef.current?.focus(), 50);
                        }}
                      >
                        <Edit2 className="w-4 h-4 mr-2" /> Edit
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setMessageToDelete(msg.id)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Timestamp + edited label + reactions */}
              <div className="flex items-center gap-3 mt-1 px-1">
                <span className="text-[10px] text-muted-foreground">
                  {formatChatDate(msg.created_at)}
                  {!msg.is_deleted && msg.is_edited && (
                    <span className="italic opacity-70 ml-1">(Edited)</span>
                  )}
                </span>

                {/* Checkmark or pending indicator for own messages */}
                {msg.isSelf && !msg.is_deleted && (
                  msg.id.startsWith("optimistic-") ? (
                    <Loader2 className="w-3 h-3 text-white/50 flex-shrink-0 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3 text-white/60 flex-shrink-0" />
                  )
                )}

                {/* B-5 (DM): Simplified reaction UI — no "See" button, no count badge in 1-on-1 */}
                <div className="flex items-center gap-2">
                  {(["👍", "👎"] as const).map((emoji) => {
                    const reactors = msg.reactions?.[emoji] || [];
                    const iReacted = reactors.includes(currentUserId);
                    const othersReacted = reactors.length > 0 && !iReacted;
                    const anyReaction = reactors.length > 0;
                    return (
                      <button
                        key={emoji}
                        onClick={() => reactToMessage(msg.id, emoji)}
                        className={cn(
                          "flex items-center gap-1 p-1 rounded-md transition-colors hover:bg-muted",
                          // I reacted — strong highlight
                          iReacted && emoji === "👍" && "text-primary bg-primary/10",
                          iReacted && emoji === "👎" && "text-destructive bg-destructive/10",
                          // Other person reacted — still show colored, slightly lighter
                          othersReacted && emoji === "👍" && "text-primary/80 bg-primary/5",
                          othersReacted && emoji === "👎" && "text-destructive/80 bg-destructive/5",
                          // No reactions at all — dim
                          !anyReaction && "opacity-40"
                        )}
                      >
                        {emoji === "👍" ? <ThumbsUp className={cn("w-3 h-3", anyReaction && "fill-current")} /> : <ThumbsDown className={cn("w-3 h-3", anyReaction && "fill-current")} />}
                        {anyReaction && <span className="text-[10px] font-medium">{reactors.length}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* ── Scroll-to-bottom button ── */}
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
              className="rounded-full shadow-xl gradient-hero text-white border-0 w-11 h-11"
              onClick={() => scrollToBottom("smooth")}
            >
              <ArrowDown className="w-5 h-5" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Reply preview ── */}
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

      {/* ── B-28: Editing context bar ── */}
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

      {/* ── Attached file preview ── */}
      {attachedFile && (
        <div className="px-3 py-2 bg-muted/50 border-t border-border/40 flex items-center gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 bg-card border border-border/50 rounded-lg px-3 py-1.5">
            {attachedFile.type.startsWith("image/") ? (
              <ImageIcon className="w-4 h-4 text-primary flex-shrink-0" />
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
            className="w-7 h-7 text-muted-foreground hover:text-destructive flex-shrink-0"
            onClick={() => setAttachedFile(null)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* ── Chat input ── */}
      <div className="border-t border-border/50 p-3 bg-card flex gap-2 items-end">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
          onChange={handleFileSelect}
        />
        <Button
          variant="ghost"
          size="icon"
          className="w-9 h-9 flex-shrink-0 text-muted-foreground hover:text-primary"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingFile}
        >
          {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
        </Button>

        <input
          ref={inputRef}
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={editingMessage ? "Edit message..." : "Type a message..."}
          className="flex-1 text-sm bg-muted/40 border border-border/40 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all resize-none"
        />

        <Button
          size="icon"
          className="w-9 h-9 flex-shrink-0 gradient-hero border-0 text-white shadow-md"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSend}
          disabled={sendingMsg || (!chatInput.trim() && !attachedFile)}
        >
          {sendingMsg ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : editingMessage ? (
            <Check className="w-4 h-4" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={!!messageToDelete}
        onOpenChange={(open) => !open && setMessageToDelete(null)}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>
              This will hide the message for both participants. You cannot undo this action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => messageToDelete && deleteMessage(messageToDelete).then(() => setMessageToDelete(null))}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
