import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MessageSquare, LayoutList, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { ChatListItem } from "@/components/chat/ChatListItem";
import { ChatSearchBar } from "@/components/chat/ChatSearchBar";
import { useDMList } from "@/hooks/useDMList";
import type { BatchLastMessage } from "@/types/chat";

type Tab = "all" | "admin_dm";

interface Batch {
  id: string;
  name: string;
  course: string;
  updated_at: string | null;
}

export default function StudentChatHub() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchLastMsgs, setBatchLastMsgs] = useState<Record<string, BatchLastMessage>>({});
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("institute_code")
        .eq("user_id", user.id)
        .single();
      if (!profile?.institute_code) return;
      const ic = profile.institute_code;
      setInstituteCode(ic);

      const { data: inst } = await supabase
        .from("institutes")
        .select("institute_name, city")
        .eq("institute_code", ic)
        .single();
      if (inst) {
        setInstituteName(`${inst.institute_name}${inst.city ? ", " + inst.city : ""}`);
      }

      // Student's enrolled batches
      const { data: enrollments } = await supabase
        .from("students_batches")
        .select("batch_id")
        .eq("student_id", user.id);

      if (enrollments && enrollments.length > 0) {
        const batchIds = enrollments.map((e) => e.batch_id);
        const { data: batchData } = await supabase
          .from("batches")
          .select("id, name, course, updated_at")
          .in("id", batchIds)
          .eq("is_active", true)
          .order("updated_at", { ascending: false });
        setBatches(batchData || []);
      }

      const { data: blm } = await supabase.rpc("get_batch_last_messages", {
        p_institute_code: ic,
      });
      const blmMap: Record<string, BatchLastMessage> = {};
      (blm || []).forEach((row: BatchLastMessage) => {
        blmMap[row.batch_id] = row;
      });
      setBatchLastMsgs(blmMap);

      setPageLoading(false);
    };
    init();
  }, []);

  const { conversations } = useDMList({
    currentUserId,
    currentUserRole: "student",
    instituteCode,
  });

  const q = search.toLowerCase();
  const filteredBatches = batches.filter(
    (b) => b.name.toLowerCase().includes(q) || b.course.toLowerCase().includes(q)
  );

  const allThreads = useMemo(() => {
    type Thread = {
      key: string;
      name: string;
      subtitle: string;
      lastMessage: string | null;
      lastMessageAt: string | null;
      unreadCount: number;
      onClick: () => void;
      isGroup: boolean;
    };
    const threads: Thread[] = [];

    batches.forEach((b) => {
      const lm = batchLastMsgs[b.id];
      threads.push({
        key: `batch-${b.id}`,
        name: b.name,
        subtitle: b.course,
        lastMessage: lm ? lm.last_message : null,
        lastMessageAt: lm ? lm.last_message_at : b.updated_at,
        unreadCount: 0,
        onClick: () => navigate(`/batch/${b.id}`),
        isGroup: true,
      });
    });

    conversations.forEach((c) => {
      threads.push({
        key: `dm-${c.id}`,
        name: "Admin",
        subtitle: "Private Message",
        lastMessage: c.last_message_preview,
        lastMessageAt: c.last_message_at,
        unreadCount: c.other_user_unread_count,
        onClick: () => navigate(`/dm/${c.id}`),
        isGroup: false,
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
  }, [batches, batchLastMsgs, conversations, navigate, q]);

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
    { id: "admin_dm" as Tab, label: "Admin DM", icon: ShieldCheck },
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
                onClick={() => setActiveTab(tab.id)}
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
          {activeTab === "all" && (
            <>
              {allThreads.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  message={
                    search
                      ? "No conversations match your search."
                      : "Join a batch to see your group chats here."
                  }
                />
              ) : (
                allThreads.map((t) => (
                  <ChatListItem
                    key={t.key}
                    name={t.name}
                    subtitle={t.subtitle}
                    lastMessage={t.lastMessage}
                    lastMessageAt={t.lastMessageAt}
                    unreadCount={t.unreadCount}
                    onClick={t.onClick}
                    isGroup={t.isGroup}
                  />
                ))
              )}
            </>
          )}

          {activeTab === "admin_dm" && (
            <>
              {conversations.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  message="No private messages from your admin yet."
                />
              ) : (
                conversations.map((c) => (
                  <ChatListItem
                    key={c.id}
                    name="Admin"
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
        </div>
      </div>
    </DashboardLayout>
  );
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: React.ElementType;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-muted-foreground opacity-60" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
    </div>
  );
}
