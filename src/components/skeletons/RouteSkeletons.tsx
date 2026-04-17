import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lightweight, route-shape-matching skeletons used as `<Suspense>` fallbacks.
 * They keep layout stable while the lazy chunk loads, avoiding the spinner flash.
 */

export function ChatHubSkeleton() {
  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <div className="h-14 border-b border-border/50 px-4 flex items-center gap-3">
        <Skeleton className="w-9 h-9 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="px-4 py-3">
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <div className="flex-1 px-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="w-11 h-11 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

export function ChatRoomSkeleton() {
  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <div className="h-14 border-b border-border/50 px-4 flex items-center gap-3">
        <Skeleton className="w-9 h-9 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2 w-16" />
        </div>
      </div>
      <div className="flex-1 px-4 py-3 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={i % 2 ? "flex justify-end" : "flex"}>
            <Skeleton className={`h-10 ${i % 2 ? "w-1/2" : "w-2/3"} rounded-2xl`} />
          </div>
        ))}
      </div>
      <div className="border-t border-border/50 p-3">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function GenericRouteSkeleton() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-7 h-7 border-3 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/** Pick the right skeleton based on the URL path */
export function pickSkeletonForPath(pathname: string): JSX.Element {
  if (pathname.startsWith("/dm/") || pathname.startsWith("/batch/")) {
    return <ChatRoomSkeleton />;
  }
  if (pathname.endsWith("/chat")) {
    return <ChatHubSkeleton />;
  }
  if (
    pathname === "/admin" ||
    pathname === "/teacher" ||
    pathname === "/student" ||
    pathname === "/parent" ||
    pathname === "/owner" ||
    pathname === "/superadmin"
  ) {
    return <DashboardSkeleton />;
  }
  return <GenericRouteSkeleton />;
}
