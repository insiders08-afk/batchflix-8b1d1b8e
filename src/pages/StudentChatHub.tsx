import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MessageSquare, LayoutList, ShieldCheck, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { ChatListItem } from "@/components/chat/ChatListItem";
import { ChatSearchBar } from "@/components/chat/ChatSearchBar";
import { useDMList } from "@/hooks/useDMList";
import { useBatchLastMessages } from "@/hooks/useBatchLastMessages";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

type Tab = "all" | "admin_dm" | "teachers";

interface Batch {
  id: string;
  name: string;
  course: string;
  teacher_id: string | null;
  teacher_name: string | null;
  updated_at: string | null;
}

interface AdminProfile {
  user_id: string;
  full_name: string;
}

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function StudentChatHub() {
  const navigate = useNavigate();
  const { authUser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [startingDM, setStartingDM] = useState(false);

  const currentUserId = authUser?.userId ?? "";
  const instituteCode = authUser?.instituteCode ?? "";
  const instituteName = authUser?.instituteName ?? "";

  const debouncedSearch = useDebounce(search, 250);

  useEffect(() => {
    if (!instituteCode || !currentUserId) return;
    const init = async () => {
      const [enrollRes, adminRes] = await Promise.all([
        supabase.from("students_batches").select("batch_id").eq("student_id", currentUserId),
        supabase.from("profiles").select("user_id, full_name").eq("institute_code", instituteCode).eq("role", "admin").limit(1).single(),
      ]);

      if (adminRes.data) setAdminProfile(adminRes.data);

      if (enrollRes.data && enrollRes.data.length > 0) {
        const batchIds = enrollRes.data.map((e) => e.batch_id);
        const { data: batchData } = await supabase
          .from("batches")
          .select("id, name, course, teacher_id, teacher_name, updated_at")
          .in("id", batchIds)
          .eq("is_active", true)
          .order("updated_at", { ascending: false });
        setBatches(batchData || []);
      }

      setPageLoading(false);
    };
    init();
  }, [instituteCode, currentUserId]);

  const { batchLastMsgs } = useBatchLastMessages(instituteCode);

  const { conversations } = useDMList({
    currentUserId,
    currentUserRole: "student",
    instituteCode,
  });

  // Split conversations by type
  const adminDMs = useMemo(() => conversations.filter((c) => c.dm_type === "admin_student"), [conversations]);
  const teacherDMs = useMemo(() => conversations.filter((c) => c.dm_type === "teacher_student"), [conversations]);

  // Start admin DM
  const startAdminDM = async () => {
    if (!adminProfile || !currentUserId || !instituteCode) return;
    setStartingDM(true);
    const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
      p_admin_id: adminProfile.user_id,
      p_other_user_id: currentUserId,
      p_dm_type: "admin_student",
      p_institute_code: instituteCode,
    });
    setStartingDM(false);
    if (error || !data) return;
    navigate(`/dm/${data}`);
  };

  // Start teacher DM (teacher is "admin_id" side)
  const startTeacherDM = useCallback(async (teacherId: string) => {
    if (!currentUserId || !instituteCode) return;
    setStartingDM(true);
    const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
      p_admin_id: teacherId,
      p_other_user_id: currentUserId,
      p_dm_type: "teacher_student" as any,
      p_institute_code: instituteCode,
    });
    setStartingDM(false);
    if (error || !data) {
      console.error("[startTeacherDM]", error);
      return;
    }
    navigate(`/dm/${data}`);
  }, [currentUserId, instituteCode, navigate]);

  // Build teacher contacts from batches + existing DMs
  const teacherContacts = useMemo(() => {
    interface TeacherContact {
      userId: string;
      name: string;
      batchNames: string[];
      conversationId?: string;
      lastMessage?: string | null;
      lastMessageAt?: string | null;
      unreadCount: number;
    }
    const map = new Map<string, TeacherContact>();

    batches.forEach((b) => {
      if (!b.teacher_id) return;
      const existing = map.get(b.teacher_id);
      if (existing) {
        existing.batchNames.push(b.name);
      } else {
        map.set(b.teacher_id, {
          userId: b.teacher_id,
          name: b.teacher_name || "Teacher",
          batchNames: [b.name],
          unreadCount: 0,
        });
      }
    });

    // Merge existing DM data
    teacherDMs.forEach((c) => {
      const teacherId = c.admin_id; // teacher is admin_id in teacher_student DMs
      const contact = map.get(teacherId);
      if (contact) {
        contact.conversationId = c.id;
        contact.lastMessage = c.last_message_preview;
        contact.lastMessageAt = c.last_message_at;
        contact.unreadCount = c.other_user_unread_count;
      }
    });

    return Array.from(map.values());
  }, [batches, teacherDMs]);

  const q = debouncedSearch.toLowerCase();

  // All threads (batches + all DMs)
  const allThreads = useMemo(() => {
    type Thread = {
      key: string; name: string; subtitle: string;
      lastMessage: string | null; lastMessageAt: string | null;
      unreadCount: number; onClick: () => void; isGroup: boolean;
    };
    const threads: Thread[] = [];

    batches.forEach((b) => {
      const lm = batchLastMsgs[b.id];
      threads.push({
        key: `batch-${b.id}`, name: b.name, subtitle: b.course,
        lastMessage: lm ? lm.last_message : null,
        lastMessageAt: lm ? lm.last_message_at : b.updated_at,
        unreadCount: 0, onClick: () => navigate(`/batch/${b.id}`), isGroup: true,
      });
    });

    // Admin DMs
    adminDMs.forEach((c) => {
      threads.push({
        key: `dm-${c.id}`, name: adminProfile?.full_name ?? "Admin",
        subtitle: "Admin · Private",
        lastMessage: c.last_message_preview, lastMessageAt: c.last_message_at,
        unreadCount: c.other_user_unread_count, onClick: () => navigate(`/dm/${c.id}`), isGroup: false,
      });
    });

    // Teacher DMs
    teacherDMs.forEach((c) => {
      const teacherId = c.admin_id;
      const teacherContact = teacherContacts.find((t) => t.userId === teacherId);
      threads.push({
        key: `dm-${c.id}`, name: teacherContact?.name ?? "Teacher",
        subtitle: "Teacher · Private",
        lastMessage: c.last_message_preview, lastMessageAt: c.last_message_at,
        unreadCount: c.other_user_unread_count, onClick: () => navigate(`/dm/${c.id}`), isGroup: false,
      });
    });

    return threads
      .sort((a, b) => {
        if (!a.lastMessageAt && !b.lastMessageAt) return 0;
        if (!a.lastMessageAt) return 1;
        if (!b.lastMessageAt) return -1;
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      })
      .filter((t) => t.name.toLowerCase().includes(q) || (t.lastMessage ?? "").toLowerCase().includes(q));
  }, [batches, batchLastMsgs, adminDMs, teacherDMs, adminProfile, teacherContacts, navigate, q]);

  if (pageLoading) {
    return (
      <DashboardLayout title="Chats" role="student">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  const TABS = [
    { id: "all" as Tab, label: "All", icon: LayoutList },
    { id: "admin_dm" as Tab, label: "Admin", icon: ShieldCheck },
    { id: "teachers" as Tab, label: "Teachers", icon: BookOpen },
  ];

  return (
    <DashboardLayout title="Chats" role="student">
      <div className="-m-3 sm:-m-4 md:-m-6 flex flex-col h-full min-h-[calc(100vh-60px)]">
        <div className="px-4 pt-4 pb-3 border-b border-border/40 bg-card/80">
          <h2 className="font-display font-bold text-lg truncate">{instituteName}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Your messages</p>

          <div className="mt-3">
            <ChatSearchBar value={search} onChange={setSearch} />
          </div>

          <div className="flex gap-1 mt-3 overflow-x-auto pb-1 scrollbar-hide">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                id={`student-chat-tab-${tab.id}`}
                onClick={() => { setActiveTab(tab.id); setSearch(""); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                  activeTab === tab.id
                    ? "bg-primary text-white shadow-sm"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── ALL TAB ── */}
          {activeTab === "all" && (
            <>
              {allThreads.length === 0 ? (
                <EmptyState icon={MessageSquare} message={debouncedSearch ? "No conversations match your search." : "Join a batch to see your group chats here."} />
              ) : (
                allThreads.map((t) => (
                  <ChatListItem key={t.key} name={t.name} subtitle={t.subtitle} lastMessage={t.lastMessage} lastMessageAt={t.lastMessageAt} unreadCount={t.unreadCount} onClick={t.onClick} isGroup={t.isGroup} />
                ))
              )}
            </>
          )}

          {/* ── ADMIN DM TAB ── */}
          {activeTab === "admin_dm" && (
            <>
              {adminDMs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
                    <ShieldCheck className="w-6 h-6 text-muted-foreground opacity-60" />
                  </div>
                  <p className="text-sm text-muted-foreground max-w-xs mb-4">
                    No private messages yet.{adminProfile ? " Send the first message to your admin." : ""}
                  </p>
                  {adminProfile && (
                    <Button onClick={startAdminDM} disabled={startingDM} size="sm" className="gradient-hero text-white border-0">
                      {startingDM ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Message {adminProfile.full_name}
                    </Button>
                  )}
                </div>
              ) : (
                adminDMs.map((c) => (
                  <ChatListItem
                    key={c.id}
                    name={adminProfile?.full_name ?? "Admin"}
                    subtitle="Private Message"
                    lastMessage={c.last_message_preview}
                    lastMessageAt={c.last_message_at}
                    unreadCount={c.other_user_unread_count}
                    onClick={() => navigate(`/dm/${c.id}`)}
                  />
                ))
              )}
            </>
          )}

          {/* ── TEACHERS TAB ── */}
          {activeTab === "teachers" && (
            <>
              {teacherContacts.length === 0 ? (
                <EmptyState icon={BookOpen} message="No teachers found. Join a batch to see your teachers here." />
              ) : (
                teacherContacts
                  .filter((t) => t.name.toLowerCase().includes(q))
                  .map((t) => (
                    <ChatListItem
                      key={t.userId}
                      name={t.name}
                      subtitle={t.batchNames.join(", ")}
                      lastMessage={t.lastMessage ?? "Tap to message"}
                      lastMessageAt={t.lastMessageAt}
                      unreadCount={t.unreadCount}
                      onClick={() => t.conversationId ? navigate(`/dm/${t.conversationId}`) : startTeacherDM(t.userId)}
                    />
                  ))
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-muted-foreground opacity-60" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
    </div>
  );
}
