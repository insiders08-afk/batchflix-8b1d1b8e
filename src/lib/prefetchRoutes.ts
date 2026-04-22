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
    () => import("@/pages/AdminBatches"),
    () => import("@/pages/AdminStudents"),
    () => import("@/pages/AdminFees"),
  ],
  teacher: [
    () => import("@/pages/TeacherHomework"),
    () => import("@/pages/TeacherTests"),
  ],
  student: [
    () => import("@/pages/StudentHomework"),
    () => import("@/pages/StudentTests"),
    () => import("@/pages/StudentFees"),
  ],
  parent: [
    () => import("@/pages/ParentDashboard"),
    () => import("@/pages/ParentFees"),
  ],
};

// Logged-out visitors landing on `/`: warm RoleSelection so the first tap on
// "Get Started" shows the picker instantly. Auth pages get warmed *after* the
// user actually reaches /role-select (see prefetchAuthPages below) so we don't
// burn bytes for visitors who never click through.
const LOGGED_OUT_ROUTES: Loader[] = [
  () => import("@/pages/RoleSelection"),
];

let prefetched = false;
let authPrefetched = false;

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

function runIdle(cb: () => void) {
  const idle = (typeof requestIdleCallback !== "undefined")
    ? requestIdleCallback
    : (fn: () => void) => setTimeout(fn, 200);
  idle(cb);
}

export function prefetchCriticalRoutes() {
  if (prefetched) return;
  prefetched = true;

  const role = getCachedRole();
  const targets = role && ROUTES_BY_ROLE[role] ? ROUTES_BY_ROLE[role] : LOGGED_OUT_ROUTES;

  runIdle(() => {
    targets.forEach((load) => load().catch(() => {}));
  });
}

/**
 * Called from /role-select: warm the three most-used auth pages so tapping
 * a role card opens its login screen with zero chunk-fetch latency.
 */
export function prefetchAuthPages() {
  if (authPrefetched) return;
  authPrefetched = true;
  runIdle(() => {
    import("@/pages/auth/AdminAuth").catch(() => {});
    import("@/pages/auth/TeacherAuth").catch(() => {});
    import("@/pages/auth/StudentAuth").catch(() => {});
    import("@/pages/auth/ParentAuth").catch(() => {});
  });
}
