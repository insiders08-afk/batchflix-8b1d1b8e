import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MessageSquare, LayoutList, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { ChatListItem } from "@/components/chat/ChatListItem";
import { ChatSearchBar } from "@/components/chat/ChatSearchBar";
import { useDMList } from "@/hooks/useDMList";
import { Button } from "@/components/ui/button";
import type { BatchLastMessage } from "@/types/chat";

type Tab = "all" | "admin_dm";

interface Batch {
  id: string;
  name: string;
  course: string;
  teacher_name: string | null;
  updated_at: string | null;
}

interface AdminProfile {
  user_id: string;
  full_name: string;
}

// Fix #25: simple debounce hook
function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function TeacherChatHub() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchLastMsgs, setBatchLastMsgs] = useState<Record<string, BatchLastMessage>>({});
  // Fix #13: fetch actual admin name
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [startingDM, setStartingDM] = useState(false);

  // Fix #25: debounced search prevents jank on each keystroke
  const debouncedSearch = useDebounce(search, 250);

  // Fix #9: refetch batch last messages when page becomes visible (back from DM)
  const fetchBatchLastMsgs = useCallback(async (ic: string) => {
    const { data: blm } = await supabase.rpc("get_batch_last_messages", {
      p_institute_code: ic,
    });
    const map: Record<string, BatchLastMessage> = {};
    (blm || []).forEach((row: BatchLastMessage) => { map[row.batch_id] = row; });
    setBatchLastMsgs(map);
  }, []);

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

      // Run all independent queries in parallel
      const [instRes, batchRes, blmRes, adminRes] = await Promise.all([
        supabase.from("institutes").select("institute_name, city").eq("institute_code", ic).single(),
        supabase.from("batches").select("id, name, course, teacher_name, updated_at").eq("institute_code", ic).eq("teacher_id", user.id).eq("is_active", true).order("updated_at", { ascending: false }),
        supabase.rpc("get_batch_last_messages", { p_institute_code: ic }),
        supabase.from("profiles").select("user_id, full_name").eq("institute_code", ic).eq("role", "admin").limit(1).single(),
      ]);

      if (instRes.data) {
        setInstituteName(`${instRes.data.institute_name}${instRes.data.city ? ", " + instRes.data.city : ""}`);
      }
      setBatches(batchRes.data || []);
      const map: Record<string, BatchLastMessage> = {};
      (blmRes.data || []).forEach((row: BatchLastMessage) => { map[row.batch_id] = row; });
      setBatchLastMsgs(map);
      if (adminRes.data) setAdminProfile(adminRes.data);

      setPageLoading(false);
    };
    init();
  }, [fetchBatchLastMsgs]);

  // Fix #9: re-fetch batch last messages when the tab becomes visible again
  useEffect(() => {
    if (!instituteCode) return;
    const handleVis = () => {
      if (document.visibilityState === "visible") fetchBatchLastMsgs(instituteCode);
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [instituteCode, fetchBatchLastMsgs]);

  const { conversations } = useDMList({
    currentUserId,
    currentUserRole: "teacher",
    instituteCode,
  });

  // Fix #3: Teacher can now initiate DM with admin
  const startAdminDM = async () => {
    if (!adminProfile || !currentUserId || !instituteCode) return;
    setStartingDM(true);
    const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
      p_admin_id: adminProfile.user_id,
      p_other_user_id: currentUserId,
      p_dm_type: "admin_teacher",
      p_institute_code: instituteCode,
    });
    setStartingDM(false);
    if (error || !data) {
      console.error("[startAdminDM]", error);
      return;
    }
    navigate(`/dm/${data}`);
  };

  const q = debouncedSearch.toLowerCase();
  const filteredBatches = batches.filter(
    (b) => b.name.toLowerCase().includes(q) || b.course.toLowerCase().includes(q)
  );

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
        // Fix #13: show real admin name
        name: adminProfile?.full_name ?? "Admin",
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
  }, [batches, batchLastMsgs, conversations, adminProfile, navigate, q]);

  if (pageLoading) {
    return (
      <DashboardLayout title="Chats" role="teacher">
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
    <DashboardLayout title="Chats" role="teacher">
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
                id={`teacher-chat-tab-${tab.id}`}
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
                    debouncedSearch
                      ? "No conversations match your search."
                      : "You have no assigned batches yet."
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
                <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
                    <ShieldCheck className="w-6 h-6 text-muted-foreground opacity-60" />
                  </div>
                  <p className="text-sm text-muted-foreground max-w-xs mb-4">
                    No private messages yet.{adminProfile ? " Send the first message to your admin." : ""}
                  </p>
                  {/* Fix #3: Allow teacher to initiate DM */}
                  {adminProfile && (
                    <Button
                      onClick={startAdminDM}
                      disabled={startingDM}
                      size="sm"
                      className="gradient-hero text-white border-0"
                    >
                      {startingDM ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Message {adminProfile.full_name}
                    </Button>
                  )}
                </div>
              ) : (
                conversations.map((c) => (
                  <ChatListItem
                    key={c.id}
                    name={adminProfile?.full_name ?? "Admin"} // Fix #13: real name
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
