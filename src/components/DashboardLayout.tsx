import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Users, CalendarCheck, Megaphone,
  FlaskConical, IndianRupee, GraduationCap, Settings,
  LogOut, Zap, ChevronLeft, Menu, X, ShieldCheck,
  BookOpen, Trophy, ClipboardList, UserCircle, BookMarked, PlusCircle, Download,
  MessageSquare, RefreshCw
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchAdminHubData, fetchTeacherHubData, fetchStudentHubData, HUB_STALE_TIME } from "@/lib/hubQueries";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import InstallButton from "@/components/InstallButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import BottomNav from "@/components/BottomNav";
import OfflineBanner from "@/components/OfflineBanner";
import { useDMList } from "@/hooks/useDMList";
import { useAuth } from "@/contexts/AuthContext";

const LAST_ROUTE_KEY = "bh_last_route";

type Role = "admin" | "teacher" | "student" | "parent";

const menusByRole: Record<Role, { icon: React.ElementType; label: string; path: string }[]> = {
  admin: [
    { icon: LayoutDashboard, label: "Overview", path: "/admin" },
    { icon: Users, label: "Batches", path: "/admin/batches" },
    { icon: CalendarCheck, label: "Attendance", path: "/admin/attendance" },
    { icon: MessageSquare, label: "Chats", path: "/admin/chat" },
    { icon: Megaphone, label: "Announcements", path: "/admin/announcements" },
    { icon: FlaskConical, label: "Tests", path: "/admin/tests" },
    { icon: IndianRupee, label: "Fees", path: "/admin/fees" },
    { icon: GraduationCap, label: "Students", path: "/admin/students" },
    { icon: ClipboardList, label: "Team", path: "/admin/team" },
    { icon: ShieldCheck, label: "Approvals", path: "/admin/approvals" },
    { icon: Settings, label: "Settings", path: "/admin/settings" },
  ],
  teacher: [
    { icon: LayoutDashboard, label: "My Dashboard", path: "/teacher" },
    { icon: CalendarCheck, label: "Attendance", path: "/teacher/attendance" },
    { icon: MessageSquare, label: "Chats", path: "/teacher/chat" },
    { icon: Megaphone, label: "Announcements", path: "/teacher/announcements" },
    { icon: FlaskConical, label: "Tests & Scores", path: "/teacher/tests" },
    { icon: BookOpen, label: "Homework / DPP", path: "/teacher/homework" },
    { icon: Settings, label: "Settings", path: "/teacher/settings" },
  ],
  student: [
    { icon: LayoutDashboard, label: "My Dashboard", path: "/student" },
    { icon: PlusCircle, label: "Join a Batch", path: "/student/apply-batch" },
    { icon: CalendarCheck, label: "My Attendance", path: "/student/attendance" },
    { icon: MessageSquare, label: "Chats", path: "/student/chat" },
    { icon: Trophy, label: "Tests & Scores", path: "/student/tests" },
    { icon: BookOpen, label: "Homework / DPP", path: "/student/homework" },
    { icon: IndianRupee, label: "My Fees", path: "/student/fees" },
    { icon: Megaphone, label: "Announcements", path: "/student/announcements" },
    { icon: Settings, label: "Settings", path: "/student/settings" },
  ],
  parent: [
    { icon: LayoutDashboard, label: "Overview", path: "/parent" },
    { icon: UserCircle, label: "My Child", path: "/parent" },
    { icon: CalendarCheck, label: "Attendance", path: "/parent/attendance" },
    { icon: IndianRupee, label: "Fees", path: "/parent/fees" },
    { icon: Megaphone, label: "Announcements", path: "/parent/announcements" },
  ],
};

const roleAuthPaths: Record<Role, string> = {
  admin: "/auth/admin",
  teacher: "/auth/teacher",
  student: "/auth/student",
  parent: "/auth/parent",
};

const roleLabels: Record<Role, string> = {
  admin: "Admin",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
};

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  role?: Role;
}

export default function DashboardLayout({ children, title, role = "admin" }: DashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { authUser, authLoading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [approvalsPending, setApprovalsPending] = useState(0);

  const userName = authUser?.userName ?? "Loading...";
  const userInitials = authUser?.userInitials ?? "..";
  const instituteName = authUser?.instituteName ?? "";
  const instituteCode = authUser?.instituteCode ?? null;
  const currentUserId = authUser?.userId ?? "";
  const authChecked = !authLoading && !!authUser;

  // Register push notification subscription once we have the institute code
  usePushNotifications(instituteCode);

  // DM unread count for bottom nav badge (only for roles that have chat)
  const showBottomNav = role === "admin" || role === "teacher" || role === "student";
  const { totalUnread: dmUnread } = useDMList({
    currentUserId: showBottomNav ? currentUserId : "",
    currentUserRole: role,
    instituteCode: showBottomNav ? (instituteCode ?? "") : "",
  });

  // ── Phase B: Prefetch hub data so Chat opens instantly ────
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!authUser?.instituteCode) return;
    const ic = authUser.instituteCode;
    const uid = authUser.userId;
    const r = authUser.userRole;

    if (r === "admin") {
      queryClient.prefetchQuery({
        queryKey: ["admin-hub", ic],
        queryFn: fetchAdminHubData(ic),
        staleTime: HUB_STALE_TIME,
      });
    } else if (r === "teacher") {
      queryClient.prefetchQuery({
        queryKey: ["teacher-hub", ic, uid],
        queryFn: fetchTeacherHubData(ic, uid),
        staleTime: HUB_STALE_TIME,
      });
    } else if (r === "student") {
      queryClient.prefetchQuery({
        queryKey: ["student-hub", ic, uid],
        queryFn: fetchStudentHubData(ic, uid),
        staleTime: HUB_STALE_TIME,
      });
    }
  }, [authUser, queryClient]);

  // Fix #29: primary paths that appear in BottomNav — hide from mobile hamburger sidebar
  const bottomNavPaths = showBottomNav
    ? new Set([`/${role}`, `/${role}/attendance`, `/${role}/chat`])
    : new Set<string>();

  const menuItems = menusByRole[role];
  const isAdmin = role === "admin";

  // Auth guard — lightweight check using cached context
  useEffect(() => {
    if (authLoading) return;
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    const lastRoute = typeof window !== "undefined" ? localStorage.getItem(LAST_ROUTE_KEY) : null;
    const hasMatchingCachedRole = authUser?.userRole === role || authUser?.userRoles.includes(role);
    if (!authUser) {
      if (isOffline) return;
      navigate(roleAuthPaths[role], { replace: true });
      return;
    }
    // Validate role using cached roles from AuthContext
    if (!hasMatchingCachedRole) {
      if (isOffline && lastRoute?.startsWith(`/${role}`)) return;
      navigate("/role-select", { replace: true });
    }
  }, [authUser, authLoading, navigate, role]);

  // Listen for sign-out events to redirect immediately
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (event === "SIGNED_OUT" || (!session && event !== "INITIAL_SESSION")) {
        navigate(roleAuthPaths[role], { replace: true });
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate, role]);

  // Fetch pending count for admin sidebar badges
  useEffect(() => {
    if (!isAdmin || !authChecked || !instituteCode) return;
    const fetchPending = async () => {
      const [reqRes, appRes] = await Promise.all([
        supabase.from("pending_requests").select("id").eq("status", "pending").eq("institute_code", instituteCode),
        supabase.from("batch_applications").select("id").eq("status", "pending"),
      ]);
      setApprovalsPending((reqRes.data?.length || 0) + (appRes.data?.length || 0));
    };
    fetchPending();
  }, [isAdmin, authChecked, instituteCode]);

  const handleLogout = async () => {
    localStorage.removeItem("batchhub_active_institute");
    await supabase.auth.signOut();
    navigate("/");
  };

  const isActiveItem = (itemPath: string) => location.pathname === itemPath;

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Institute Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-sidebar-border">
        {!collapsed ? (
          <div className="flex-1 min-w-0">
            <p className="text-xs text-sidebar-foreground/60 font-medium truncate">{roleLabels[role]}</p>
            <p className="text-sm font-semibold text-sidebar-foreground truncate">
              {instituteName || "Loading..."}
            </p>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg gradient-hero flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:flex text-sidebar-foreground hover:bg-sidebar-accent w-8 h-8 flex-shrink-0"
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronLeft className={cn("w-4 h-4 transition-transform", collapsed && "rotate-180")} />
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const active = isActiveItem(item.path);
          const showApprovalBadge = isAdmin && approvalsPending > 0 && item.path === "/admin/approvals";
          const isChatItem = item.path.endsWith("/chat");
          const showChatBadge = isChatItem && dmUnread > 0;
          // Fix #29: On mobile, skip items that are in BottomNav to avoid double navigation
          const isBottomNavItem = bottomNavPaths.has(item.path);
          return (
            <Link
              key={`${item.path}-${item.label}`}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
                // Only show on desktop if it's a bottom-nav item (mobile has it in BottomNav)
                isBottomNavItem ? "hidden lg:flex" : "flex",
                active
                  ? "bg-sidebar-primary text-white shadow-primary/30 shadow-md"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className={cn("w-4 h-4 flex-shrink-0", active ? "text-white" : "")} />
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && showApprovalBadge && (
                <span className="text-xs font-bold bg-danger text-white rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                  {approvalsPending}
                </span>
              )}
              {!collapsed && showChatBadge && (
                <span className="text-xs font-bold bg-red-500 text-white rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 flex-shrink-0">
                  {dmUnread > 99 ? "99+" : dmUnread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer — extra bottom padding on mobile so logout isn't hidden behind BottomNav */}
      <div className={cn("px-2 pb-4 border-t border-sidebar-border pt-4", showBottomNav && "pb-24 lg:pb-4")}>
        {!collapsed && (
          <div className="flex items-center gap-3 px-3 mb-3">
            <div className="w-8 h-8 rounded-full gradient-hero flex items-center justify-center text-white text-xs font-bold">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-sidebar-foreground truncate">{userName}</p>
              <p className="text-xs text-sidebar-foreground/60">{roleLabels[role]}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent w-full transition-colors"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col bg-sidebar flex-shrink-0 transition-all duration-300",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar — max-w so it never covers full screen */}
      <aside className={cn(
        "fixed left-0 top-0 bottom-0 w-[72vw] max-w-[260px] bg-sidebar z-50 lg:hidden transition-transform duration-300",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <SidebarContent />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <OfflineBanner />
        {/* Top bar */}
        <header className="h-14 border-b border-border/50 bg-card flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden w-9 h-9 flex-shrink-0"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
            {title && <h1 className="font-display font-semibold text-base sm:text-lg truncate">{title}</h1>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9"
              onClick={() => {
                queryClient.invalidateQueries();
              }}
              title="Refresh data"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <ThemeToggle showLabel className="hidden sm:flex" />
            <ThemeToggle className="sm:hidden" />
            <InstallButton />
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-1.5">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              Live
            </div>
            <div className="w-8 h-8 rounded-full gradient-hero flex items-center justify-center text-white text-xs font-bold">
              {userInitials}
            </div>
          </div>
        </header>

        <main className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6",
          showBottomNav && "pb-20 lg:pb-6" // extra bottom padding for bottom nav on mobile
        )}>
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation — only for admin/teacher/student */}
      {showBottomNav && (
        <BottomNav role={role as "admin" | "teacher" | "student"} chatUnreadCount={dmUnread} />
      )}
    </div>
  );
}
