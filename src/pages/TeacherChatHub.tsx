import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MessageSquare, LayoutList, ShieldCheck, GraduationCap, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { ChatListItem } from "@/components/chat/ChatListItem";
import { ChatSearchBar } from "@/components/chat/ChatSearchBar";
import { useDMList } from "@/hooks/useDMList";
import { useBatchLastMessages } from "@/hooks/useBatchLastMessages";
import { Button } from "@/components/ui/button";

type Tab = "all" | "admin_dm" | "students";

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

interface StudentSearchResult {
  user_id: string;
  full_name: string;
  role_based_code: string | null;
}

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
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [startingDM, setStartingDM] = useState(false);

  // Profile map: userId → full_name (for DM other users)
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});

  // Student search
  const [searchResults, setSearchResults] = useState<StudentSearchResult[]>([]);
  const [searchingStudents, setSearchingStudents] = useState(false);

  const debouncedSearch = useDebounce(search, 250);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("institute_code")
        .eq("user_id", user.id)
        .eq("role", "teacher")
        .maybeSingle();
      if (!profile?.institute_code) return;
      const ic = profile.institute_code;
      setInstituteCode(ic);

      const [instRes, batchRes, adminRes] = await Promise.all([
        supabase.from("institutes").select("institute_name, city").eq("institute_code", ic).single(),
        supabase.from("batches").select("id, name, course, teacher_name, updated_at").eq("institute_code", ic).eq("teacher_id", user.id).eq("is_active", true).order("updated_at", { ascending: false }),
        supabase.from("profiles").select("user_id, full_name").eq("institute_code", ic).eq("role", "admin").limit(1).single(),
      ]);

      if (instRes.data) {
        setInstituteName(`${instRes.data.institute_name}${instRes.data.city ? ", " + instRes.data.city : ""}`);
      }
      setBatches(batchRes.data || []);
      if (adminRes.data) setAdminProfile(adminRes.data);

      setPageLoading(false);
    };
    init();
  }, []);

  const { batchLastMsgs } = useBatchLastMessages(instituteCode);

  const { conversations } = useDMList({
    currentUserId,
    currentUserRole: "teacher",
    instituteCode,
  });

  // Fetch profiles for all "other" users in conversations
  useEffect(() => {
    if (!currentUserId || conversations.length === 0) return;
    const otherIds = [...new Set(conversations.map((c) =>
      c.admin_id === currentUserId ? c.other_user_id : c.admin_id
    ))];
    if (otherIds.length === 0) return;

    supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", otherIds)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        data.forEach((p) => {
          if (!map[p.user_id]) map[p.user_id] = p.full_name;
        });
        setProfileMap(map);
      });
  }, [currentUserId, conversations]);

  // Student search (active only on students tab)
  useEffect(() => {
    if (activeTab !== "students" || !debouncedSearch || debouncedSearch.length < 2 || !instituteCode) {
      setSearchResults([]);
      return;
    }
    const doSearch = async () => {
      setSearchingStudents(true);
      const q = `%${debouncedSearch}%`;
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, role_based_code")
        .eq("institute_code", instituteCode)
        .eq("role", "student")
        .eq("status", "approved")
        .or(`full_name.ilike.${q},role_based_code.ilike.${q}`)
        .limit(20);
      setSearchResults(data || []);
      setSearchingStudents(false);
    };
    doSearch();
  }, [activeTab, debouncedSearch, instituteCode]);

  // Start admin DM
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
    if (error || !data) return;
    navigate(`/dm/${data}`);
  };

  // Start student DM (teacher is "admin_id" side)
  const startStudentDM = useCallback(async (studentId: string) => {
    if (!currentUserId || !instituteCode) return;
    setStartingDM(true);
    const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
      p_admin_id: currentUserId,
      p_other_user_id: studentId,
      p_dm_type: "teacher_student" as any,
      p_institute_code: instituteCode,
    });
    setStartingDM(false);
    if (error || !data) {
      console.error("[startStudentDM]", error);
      return;
    }
    navigate(`/dm/${data}`);
  }, [currentUserId, instituteCode, navigate]);

  const getOtherName = useCallback((c: typeof conversations[0]) => {
    const otherId = c.admin_id === currentUserId ? c.other_user_id : c.admin_id;
    // For admin DMs, use adminProfile name; otherwise use profileMap
    if (c.dm_type === "admin_teacher") return adminProfile?.full_name ?? profileMap[otherId] ?? "Admin";
    return profileMap[otherId] ?? "Student";
  }, [currentUserId, adminProfile, profileMap]);

  const getUnreadCount = useCallback((c: typeof conversations[0]) => {
    return c.admin_id === currentUserId ? c.admin_unread_count : c.other_user_unread_count;
  }, [currentUserId]);

  const q = debouncedSearch.toLowerCase();

  // Split conversations by type
  const adminDMs = useMemo(() => conversations.filter((c) => c.dm_type === "admin_teacher"), [conversations]);
  const studentDMs = useMemo(() => conversations.filter((c) => c.dm_type === "teacher_student"), [conversations]);

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

    conversations.forEach((c) => {
      const name = getOtherName(c);
      const subtitle = c.dm_type === "admin_teacher" ? "Admin" : "Student";
      threads.push({
        key: `dm-${c.id}`, name, subtitle: `Private · ${subtitle}`,
        lastMessage: c.last_message_preview, lastMessageAt: c.last_message_at,
        unreadCount: getUnreadCount(c), onClick: () => navigate(`/dm/${c.id}`), isGroup: false,
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
  }, [batches, batchLastMsgs, conversations, getOtherName, getUnreadCount, navigate, q]);

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
    { id: "admin_dm" as Tab, label: "Admin", icon: ShieldCheck },
    { id: "students" as Tab, label: "Students", icon: GraduationCap },
  ];

  return (
    <DashboardLayout title="Chats" role="teacher">
      <div className="-m-3 sm:-m-4 md:-m-6 flex flex-col h-full min-h-[calc(100vh-60px)]">
        <div className="px-4 pt-4 pb-3 border-b border-border/40 bg-card/80">
          <h2 className="font-display font-bold text-lg truncate">{instituteName}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Your messages</p>

          <div className="mt-3">
            <ChatSearchBar
              value={search}
              onChange={setSearch}
              placeholder={activeTab === "students" ? "Search students by name or ID…" : "Search conversations…"}
            />
          </div>

          <div className="flex gap-1 mt-3 overflow-x-auto pb-1 scrollbar-hide">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                id={`teacher-chat-tab-${tab.id}`}
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
                <EmptyState icon={MessageSquare} message={debouncedSearch ? "No conversations match your search." : "You have no assigned batches yet."} />
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
                    unreadCount={getUnreadCount(c)}
                    onClick={() => navigate(`/dm/${c.id}`)}
                  />
                ))
              )}
            </>
          )}

          {/* ── STUDENTS TAB ── */}
          {activeTab === "students" && (
            <StudentsTab
              search={debouncedSearch}
              studentDMs={studentDMs}
              searchResults={searchResults}
              searchingStudents={searchingStudents}
              profileMap={profileMap}
              currentUserId={currentUserId}
              startingDM={startingDM}
              onStartDM={startStudentDM}
              onOpenDM={(id) => navigate(`/dm/${id}`)}
              getUnreadCount={getUnreadCount}
            />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

// ── Students Tab Component ──
function StudentsTab({
  search, studentDMs, searchResults, searchingStudents,
  profileMap, currentUserId, startingDM, onStartDM, onOpenDM, getUnreadCount,
}: {
  search: string;
  studentDMs: any[];
  searchResults: StudentSearchResult[];
  searchingStudents: boolean;
  profileMap: Record<string, string>;
  currentUserId: string;
  startingDM: boolean;
  onStartDM: (id: string) => void;
  onOpenDM: (id: string) => void;
  getUnreadCount: (c: any) => number;
}) {
  // If searching, show search results
  if (search.length >= 2) {
    if (searchingStudents) {
      return (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      );
    }
    if (searchResults.length === 0) {
      return <EmptyState icon={Search} message="No students found matching your search." />;
    }

    // Check which students already have an active DM
    const existingDMMap = new Map<string, string>();
    studentDMs.forEach((c) => {
      existingDMMap.set(c.other_user_id, c.id);
    });

    return (
      <>
        <div className="px-4 py-2 text-xs text-muted-foreground font-medium">
          {searchResults.length} student{searchResults.length !== 1 ? "s" : ""} found
        </div>
        {searchResults.map((s) => {
          const existingConvoId = existingDMMap.get(s.user_id);
          return (
            <ChatListItem
              key={s.user_id}
              name={s.full_name}
              subtitle={s.role_based_code ? `ID: ${s.role_based_code}` : "Student"}
              lastMessage={existingConvoId ? "Tap to open chat" : "Tap to start a conversation"}
              onClick={() => existingConvoId ? onOpenDM(existingConvoId) : onStartDM(s.user_id)}
            />
          );
        })}
      </>
    );
  }

  // Default: show existing student DM conversations
  if (studentDMs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <GraduationCap className="w-6 h-6 text-muted-foreground opacity-60" />
        </div>
        <p className="text-sm text-muted-foreground max-w-xs mb-2">No student conversations yet.</p>
        <p className="text-xs text-muted-foreground">Search for a student by name or ID to start a chat.</p>
      </div>
    );
  }

  return (
    <>
      {studentDMs.map((c) => {
        const studentId = c.other_user_id;
        const name = profileMap[studentId] ?? "Student";
        return (
          <ChatListItem
            key={c.id}
            name={name}
            subtitle="Student · Private"
            lastMessage={c.last_message_preview}
            lastMessageAt={c.last_message_at}
            unreadCount={getUnreadCount(c)}
            onClick={() => onOpenDM(c.id)}
          />
        );
      })}
    </>
  );
}

interface StudentSearchResult {
  user_id: string;
  full_name: string;
  role_based_code: string | null;
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
