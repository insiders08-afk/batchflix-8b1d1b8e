import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Users, GraduationCap, LayoutList } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { ChatListItem } from "@/components/chat/ChatListItem";
import { ChatSearchBar } from "@/components/chat/ChatSearchBar";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { useDMList } from "@/hooks/useDMList";
import { useBatchLastMessages } from "@/hooks/useBatchLastMessages";
import { useBatchUnreadCounts } from "@/hooks/useBatchUnreadCounts";
import { useAuth } from "@/contexts/AuthContext";
import type { DirectConversation } from "@/types/chat";
import { saveHubCache, loadHubCache } from "@/lib/hubCache";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminHubData, HUB_STALE_TIME, HUB_GC_TIME } from "@/lib/hubQueries";
import type { AdminHubData, HubBatch, HubUserProfile } from "@/lib/hubQueries";

type Tab = "all" | "batches" | "teachers" | "students";

export default function AdminChatHub() {
  const navigate = useNavigate();
  const { authUser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");

  const currentUserId = authUser?.userId ?? "";
  const instituteCode = authUser?.instituteCode ?? "";
  const instituteName = authUser?.instituteName ?? "";

  const { data, isLoading } = useQuery<AdminHubData>({
    queryKey: ["admin-hub", instituteCode],
    queryFn: fetchAdminHubData(instituteCode),
    staleTime: HUB_STALE_TIME,
    gcTime: HUB_GC_TIME,
    enabled: !!instituteCode,
    placeholderData: {
      batches: loadHubCache<HubBatch[]>("admin_batches") || [],
      teachers: loadHubCache<HubUserProfile[]>("admin_teachers") || [],
      students: loadHubCache<HubUserProfile[]>("admin_students") || [],
    },
  });

  const batches = data?.batches || [];
  const teachers = data?.teachers || [];
  const students = data?.students || [];

  useEffect(() => {
    if (!data) return;
    saveHubCache("admin_batches", data.batches);
    saveHubCache("admin_teachers", data.teachers);
    saveHubCache("admin_students", data.students);
  }, [data]);

  const { batchLastMsgs } = useBatchLastMessages(instituteCode);
  // HIGH-01: Batch group chat unread counts
  const { batchUnreadCounts } = useBatchUnreadCounts(currentUserId, instituteCode);

  const { conversations } = useDMList({
    currentUserId,
    currentUserRole: "admin",
    instituteCode,
  });

  const convByUser = useMemo(() => {
    const map: Record<string, DirectConversation> = {};
    conversations.forEach((c) => {
      map[c.other_user_id] = c;
    });
    return map;
  }, [conversations]);

  // MED-08: Pre-compute profileById map for O(1) lookup
  const profileById = useMemo(() => {
    const m: Record<string, HubUserProfile> = {};
    teachers.forEach((t) => { m[t.user_id] = t; });
    students.forEach((s) => { m[s.user_id] = s; });
    return m;
  }, [teachers, students]);

  const openDM = async (userId: string, dmType: "admin_teacher" | "admin_student") => {
    if (!currentUserId || !instituteCode) return;
    const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
      p_admin_id: currentUserId,
      p_other_user_id: userId,
      p_dm_type: dmType,
      p_institute_code: instituteCode,
    });
    if (error || !data) {
      console.error("[openDM]", error);
      return;
    }
    navigate(`/dm/${data}`);
  };

  const q = search.toLowerCase();
  const filteredBatches = batches.filter(
    (b) => b.name.toLowerCase().includes(q) || b.course.toLowerCase().includes(q)
  );
  const filteredTeachers = teachers.filter((t) => t.full_name.toLowerCase().includes(q));
  const filteredStudents = students.filter((s) => s.full_name.toLowerCase().includes(q));

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
        unreadCount: batchUnreadCounts[b.id] || 0,
        onClick: () => navigate(`/batch/${b.id}`), isGroup: true,
      });
    });

    conversations.forEach((c) => {
      const person = profileById[c.other_user_id];
      threads.push({
        key: `dm-${c.id}`,
        name: person?.full_name ?? "Unknown",
        subtitle: person?.role === "teacher" ? "Teacher" : "Student",
        lastMessage: c.last_message_preview,
        lastMessageAt: c.last_message_at,
        unreadCount: c.admin_unread_count,
        onClick: () => navigate(`/dm/${c.id}`), isGroup: false,
      });
    });

    return threads
      .sort((a, b) => {
        if (!a.lastMessageAt && !b.lastMessageAt) return 0;
        if (!a.lastMessageAt) return 1;
        if (!b.lastMessageAt) return -1;
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      })
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.lastMessage ?? "").toLowerCase().includes(q)
      );
  }, [batches, batchLastMsgs, batchUnreadCounts, conversations, profileById, navigate, q]);

  if (isLoading && !data) {
    return (
      <DashboardLayout title="Chats" role="admin">
        <div className="-m-3 sm:-m-4 md:-m-6 flex flex-col h-full min-h-[calc(100vh-60px)]">
          <div className="px-4 pt-4 pb-3 border-b border-border/40 bg-card/80">
            <div className="h-5 bg-muted rounded animate-pulse w-32 mb-2" />
            <div className="h-3 bg-muted rounded animate-pulse w-44" />
            <div className="mt-3 h-9 bg-muted rounded-lg animate-pulse" />
            <div className="flex gap-1 mt-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-7 bg-muted rounded-full animate-pulse w-20" />
              ))}
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-10 h-10 rounded-full bg-muted animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded animate-pulse w-28" />
                  <div className="h-2.5 bg-muted rounded animate-pulse w-40" />
                </div>
                <div className="h-2 bg-muted rounded animate-pulse w-8 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "all", label: "All", icon: LayoutList },
    { id: "batches", label: "Batch Chats", icon: MessageSquare },
    { id: "teachers", label: "Teachers", icon: Users },
    { id: "students", label: "Students", icon: GraduationCap },
  ];

  return (
    <DashboardLayout title="Chats" role="admin">
      <div className="-m-3 sm:-m-4 md:-m-6 flex flex-col h-full min-h-[calc(100vh-60px)]">
        <div className="px-4 pt-4 pb-3 border-b border-border/40 bg-card/80">
          <h2 className="font-display font-bold text-lg truncate">{instituteName}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Messages &amp; conversations</p>

          <div className="mt-3">
            <ChatSearchBar value={search} onChange={setSearch} />
          </div>

          <div className="flex gap-1 mt-3 overflow-x-auto pb-1 scrollbar-hide">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                id={`admin-chat-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                  activeTab === tab.id
                    ? "bg-primary text-white shadow-sm"
                    : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
                )}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === "all" && (
            <>
              {allThreads.length === 0 ? (
                <ChatEmptyState icon={MessageSquare} message={search ? "No conversations match your search." : "No conversations yet. Start chatting from the Teachers or Students tabs."} />
              ) : (
                allThreads.map((t) => (
                  <ChatListItem key={t.key} name={t.name} subtitle={t.subtitle} lastMessage={t.lastMessage} lastMessageAt={t.lastMessageAt} unreadCount={t.unreadCount} onClick={t.onClick} isGroup={t.isGroup} />
                ))
              )}
            </>
          )}

          {activeTab === "batches" && (
            <>
              {filteredBatches.length === 0 ? (
                <ChatEmptyState icon={MessageSquare} message={search ? "No batches match your search." : "No active batches yet."} />
              ) : (
                filteredBatches.map((b) => {
                  const lm = batchLastMsgs[b.id];
                  return (
                    <ChatListItem key={b.id} name={b.name} subtitle={b.course} lastMessage={lm?.last_message ?? null} lastMessageAt={lm?.last_message_at ?? b.updated_at} unreadCount={batchUnreadCounts[b.id] || 0} onClick={() => navigate(`/batch/${b.id}`)} isGroup />
                  );
                })
              )}
            </>
          )}

          {activeTab === "teachers" && (
            <>
              {filteredTeachers.length === 0 ? (
                <ChatEmptyState icon={Users} message={search ? "No teachers match your search." : "No teachers in your institute yet."} />
              ) : (
                filteredTeachers.map((t) => {
                  const conv = convByUser[t.user_id];
                  return (
                    <ChatListItem key={t.user_id} name={t.full_name} subtitle="Teacher" lastMessage={conv?.last_message_preview ?? null} lastMessageAt={conv?.last_message_at ?? null} unreadCount={conv?.admin_unread_count ?? 0} onClick={() => openDM(t.user_id, "admin_teacher")} />
                  );
                })
              )}
            </>
          )}

          {activeTab === "students" && (
            <>
              {filteredStudents.length === 0 ? (
                <ChatEmptyState icon={GraduationCap} message={search ? "No students match your search." : "No students enrolled yet."} />
              ) : (
                filteredStudents.map((s) => {
                  const conv = convByUser[s.user_id];
                  return (
                    <ChatListItem key={s.user_id} name={s.full_name} subtitle="Student" lastMessage={conv?.last_message_preview ?? null} lastMessageAt={conv?.last_message_at ?? null} unreadCount={conv?.admin_unread_count ?? 0} onClick={() => openDM(s.user_id, "admin_student")} />
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
