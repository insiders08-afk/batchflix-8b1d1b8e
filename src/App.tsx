import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { pickSkeletonForPath } from "@/components/skeletons/RouteSkeletons";

// TEMP: every route lazy-loaded so we can compare offline-mode chunk loading
// behaviour vs. the previous "eagerly load critical routes" baseline. The
// service worker precache (vite-plugin-pwa) still ships every chunk, so each
// of these dynamic imports resolves from cache when offline.
const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminAttendance = lazy(() => import("./pages/AdminAttendance"));
const AdminChatHub = lazy(() => import("./pages/AdminChatHub"));
const BatchChat = lazy(() => import("./pages/BatchChat"));
const TeacherDashboard = lazy(() => import("./pages/TeacherDashboard"));
const TeacherAttendance = lazy(() => import("./pages/TeacherAttendance"));
const TeacherChatHub = lazy(() => import("./pages/TeacherChatHub"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const StudentAttendance = lazy(() => import("./pages/StudentAttendance"));
const StudentChatHub = lazy(() => import("./pages/StudentChatHub"));
const DMConversation = lazy(() => import("./pages/DMConversation"));

const AdminDemo = lazy(() => import("./pages/demo/AdminDemo"));
const StudentBatchApply = lazy(() => import("./pages/StudentBatchApply"));

const RoleSelection = lazy(() => import("./pages/RoleSelection"));
const AdminBatches = lazy(() => import("./pages/AdminBatches"));
const AdminStudents = lazy(() => import("./pages/AdminStudents"));
const AdminFees = lazy(() => import("./pages/AdminFees"));
const AdminAnnouncements = lazy(() => import("./pages/AdminAnnouncements"));
const AdminTests = lazy(() => import("./pages/AdminTests"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const AdminApprovals = lazy(() => import("./pages/AdminApprovals"));
const AdminBatchApplications = lazy(() => import("./pages/AdminBatchApplications"));
const AdminTeam = lazy(() => import("./pages/AdminTeam"));
const TeacherSettings = lazy(() => import("./pages/TeacherSettings"));
const StudentSettings = lazy(() => import("./pages/StudentSettings"));
const TeacherAnnouncements = lazy(() => import("./pages/TeacherAnnouncements"));
const TeacherTests = lazy(() => import("./pages/TeacherTests"));
const TeacherHomework = lazy(() => import("./pages/TeacherHomework"));
const StudentFees = lazy(() => import("./pages/StudentFees"));
const StudentTests = lazy(() => import("./pages/StudentTests"));
const StudentHomework = lazy(() => import("./pages/StudentHomework"));
const StudentAnnouncements = lazy(() => import("./pages/StudentAnnouncements"));
const ParentDashboard = lazy(() => import("./pages/ParentDashboard"));
const ParentFees = lazy(() => import("./pages/ParentFees"));
const AdminAuth = lazy(() => import("./pages/auth/AdminAuth"));
const SuperAdminDashboard = lazy(() => import("./pages/SuperAdminDashboard"));
const TeacherAuth = lazy(() => import("./pages/auth/TeacherAuth"));
const StudentAuth = lazy(() => import("./pages/auth/StudentAuth"));
const ParentAuth = lazy(() => import("./pages/auth/ParentAuth"));
const SuperAdminAuth = lazy(() => import("./pages/auth/SuperAdminAuth"));
const OwnerAuth = lazy(() => import("./pages/auth/OwnerAuth"));
const OwnerDashboard = lazy(() => import("./pages/OwnerDashboard"));
const CityPartnerApply = lazy(() => import("./pages/CityPartnerApply"));
const Install = lazy(() => import("./pages/Install"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,  // 5 min — data considered fresh
      gcTime:    1000 * 60 * 10, // 10 min — keep in memory after unmount
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Tracks every route change and stores the last visited dashboard route in
 * localStorage so returning users can be redirected straight to it from `/`.
 */
function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    const p = location.pathname;
    // Only remember in-app dashboard/chat routes — not landing/auth/reset.
    const isAppRoute =
      p.startsWith("/admin") ||
      p.startsWith("/teacher") ||
      p.startsWith("/student") ||
      p.startsWith("/parent") ||
      p.startsWith("/owner") ||
      p.startsWith("/superadmin") ||
      p.startsWith("/batch/") ||
      p.startsWith("/dm/");
    if (isAppRoute) {
      try { localStorage.setItem("bh_last_route", p); } catch { /* quota */ }
    }
  }, [location.pathname]);
  return null;
}

function RoutedSuspense() {
  const location = useLocation();
  return (
    <Suspense fallback={pickSkeletonForPath(location.pathname)}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/role-select" element={<RoleSelection />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Demo routes — pure fake data, no DB */}
        <Route path="/demo/admin" element={<AdminDemo />} />
        {/* Admin */}
        <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/batches" element={<AdminBatches />} />
              <Route path="/admin/students" element={<AdminStudents />} />
              <Route path="/admin/attendance" element={<AdminAttendance />} />
              <Route path="/admin/fees" element={<AdminFees />} />
              <Route path="/admin/announcements" element={<AdminAnnouncements />} />
              <Route path="/admin/tests" element={<AdminTests />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route path="/admin/approvals" element={<AdminApprovals />} />
              <Route path="/admin/team" element={<AdminTeam />} />
              <Route path="/admin/batch-applications" element={<AdminBatchApplications />} />
              <Route path="/auth/admin" element={<AdminAuth />} />
              <Route path="/auth/superadmin" element={<SuperAdminAuth />} />
              <Route path="/superadmin" element={<SuperAdminDashboard />} />
              <Route path="/auth/teacher" element={<TeacherAuth />} />
              <Route path="/auth/student" element={<StudentAuth />} />
              <Route path="/auth/parent" element={<ParentAuth />} />
              <Route path="/auth/owner" element={<OwnerAuth />} />
              <Route path="/owner" element={<OwnerDashboard />} />
              <Route path="/apply/city-partner" element={<CityPartnerApply />} />
              <Route path="/install" element={<Install />} />
              <Route path="/batch/:id" element={<BatchChat />} />
              <Route path="/admin/chat" element={<AdminChatHub />} />
              {/* Teacher */}
              <Route path="/teacher" element={<TeacherDashboard />} />
              <Route path="/teacher/settings" element={<TeacherSettings />} />
              <Route path="/teacher/attendance" element={<TeacherAttendance />} />
              <Route path="/teacher/announcements" element={<TeacherAnnouncements />} />
              <Route path="/teacher/tests" element={<TeacherTests />} />
              <Route path="/teacher/homework" element={<TeacherHomework />} />
              <Route path="/teacher/chat" element={<TeacherChatHub />} />
              {/* Student */}
              <Route path="/student" element={<StudentDashboard />} />
              <Route path="/student/settings" element={<StudentSettings />} />
              <Route path="/student/attendance" element={<StudentAttendance />} />
              <Route path="/student/tests" element={<StudentTests />} />
              <Route path="/student/homework" element={<StudentHomework />} />
              <Route path="/student/announcements" element={<StudentAnnouncements />} />
              <Route path="/student/apply-batch" element={<StudentBatchApply />} />
              <Route path="/student/fees" element={<StudentFees />} />
              <Route path="/student/chat" element={<StudentChatHub />} />
              {/* Shared DM conversation screen */}
              <Route path="/dm/:conversationId" element={<DMConversation />} />
              {/* Parent */}
        <Route path="/parent" element={<ParentDashboard />} />
        <Route path="/parent/fees" element={<ParentFees />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

const App = () => (
  <ErrorBoundary>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="batchhub-theme">
    <AuthProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <RouteTracker />
          <RoutedSuspense />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
    </AuthProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
