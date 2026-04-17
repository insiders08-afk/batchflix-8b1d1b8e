/**
 * Prefetch critical route chunks during idle time so navigation feels instant.
 * Uses requestIdleCallback (with setTimeout fallback) to avoid blocking the main thread.
 *
 * Role-aware: reads cached `bh_auth_cache` from localStorage and prefetches only the
 * chunks that role actually uses. Saves ~100-200KB on first paint vs. prefetching everything.
 */
type Loader = () => Promise<unknown>;

const ROUTES_BY_ROLE: Record<string, Loader[]> = {
  admin: [
    () => import("@/pages/AdminDashboard"),
    () => import("@/pages/AdminChatHub"),
    () => import("@/pages/BatchWorkspace"),
    () => import("@/pages/DMConversation"),
  ],
  teacher: [
    () => import("@/pages/TeacherDashboard"),
    () => import("@/pages/TeacherChatHub"),
    () => import("@/pages/BatchWorkspace"),
    () => import("@/pages/DMConversation"),
  ],
  student: [
    () => import("@/pages/StudentDashboard"),
    () => import("@/pages/StudentChatHub"),
    () => import("@/pages/BatchWorkspace"),
    () => import("@/pages/DMConversation"),
  ],
  parent: [
    () => import("@/pages/ParentDashboard"),
  ],
};

// Logged-out users land here — keep auth + role-select warm
const LOGGED_OUT_ROUTES: Loader[] = [
  () => import("@/pages/RoleSelection"),
  () => import("@/pages/auth/AdminAuth"),
  () => import("@/pages/auth/TeacherAuth"),
  () => import("@/pages/auth/StudentAuth"),
];

let prefetched = false;

function getCachedRole(): string | null {
  try {
    const raw = localStorage.getItem("bh_auth_cache");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.userRole === "string" ? parsed.userRole : null;
  } catch {
    return null;
  }
}

export function prefetchCriticalRoutes() {
  if (prefetched) return;
  prefetched = true;

  const idle = (typeof requestIdleCallback !== "undefined")
    ? requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 200);

  const role = getCachedRole();
  const targets = role && ROUTES_BY_ROLE[role] ? ROUTES_BY_ROLE[role] : LOGGED_OUT_ROUTES;

  idle(() => {
    targets.forEach((load) => load().catch(() => {}));
  });
}
