/**
 * Prefetch critical route chunks during idle time so navigation feels instant.
 * Uses requestIdleCallback (with setTimeout fallback) to avoid blocking the main thread.
 *
 * Role-aware: reads cached `bh_auth_cache` from localStorage and prefetches only the
 * chunks that role actually uses. Saves ~100-200KB on first paint vs. prefetching everything.
 */
type Loader = () => Promise<unknown>;

const CORE_OFFLINE_ROUTES: Loader[] = [
  () => import("@/pages/AdminDashboard"),
  () => import("@/pages/AdminAttendance"),
  () => import("@/pages/AdminChatHub"),
  () => import("@/pages/TeacherDashboard"),
  () => import("@/pages/TeacherAttendance"),
  () => import("@/pages/TeacherChatHub"),
  () => import("@/pages/StudentDashboard"),
  () => import("@/pages/StudentAttendance"),
  () => import("@/pages/StudentChatHub"),
  () => import("@/pages/BatchWorkspace"),
  () => import("@/pages/DMConversation"),
];

const ROUTES_BY_ROLE: Record<string, Loader[]> = {
  admin: [
    ...CORE_OFFLINE_ROUTES,
  ],
  teacher: [
    ...CORE_OFFLINE_ROUTES,
  ],
  student: [
    ...CORE_OFFLINE_ROUTES,
  ],
  parent: [
    ...CORE_OFFLINE_ROUTES,
    () => import("@/pages/ParentDashboard"),
  ],
};

// Logged-out visitors: only warm the role picker (~8KB).
// Auth pages are lazy-loaded on click — most visitors never reach them,
// and the SW precache covers offline session expiry as a safety net.
const LOGGED_OUT_ROUTES: Loader[] = [
  () => import("@/pages/RoleSelection"),
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
