import { useEffect, useRef } from "react";

/**
 * Prompt the user before leaving the page when they have unsaved attendance.
 *
 * Covers three exit vectors:
 *  - Browser tab close / refresh / external nav → `beforeunload` event
 *  - Browser back/forward / Android swipe-back → `popstate`
 *  - In-app navigation (router Links, logout button) → consumers should call
 *    `confirmIfDirty()` OR `isAnyAttendanceDirty()` (module-level helper) so
 *    sidebar/back-button nav can also block silently lost changes.
 *
 * B14 hardening:
 *  - Reads `message` via a ref so the listener never re-binds.
 *  - Listens to `popstate` so the browser's back/forward button also
 *    triggers a confirm — previously you could lose unsaved changes by
 *    swiping back on Android with no warning.
 *  - Maintains a tiny module-level Set of dirty instances so unrelated UI
 *    (sidebar logout, header refresh, parent route) can ask
 *    `isAnyAttendanceDirty()` without prop-drilling.
 */

// Module-level registry — every dirty hook instance registers itself so any
// other component (logout button, sidebar nav) can check "is anyone holding
// unsaved changes right now?" without prop-drilling.
const dirtyInstances = new Set<symbol>();

export function isAnyAttendanceDirty(): boolean {
  return dirtyInstances.size > 0;
}

/**
 * Returns true if no unsaved changes OR the user confirmed leaving anyway.
 * Use from sidebar/logout/header components that don't own the dirty state.
 */
export function confirmGlobalDirty(
  message = "You have unsaved attendance changes. Leave anyway?"
): boolean {
  if (!isAnyAttendanceDirty()) return true;
  return window.confirm(message);
}

export function useDirtyGuard(
  isDirty: boolean,
  message = "You have unsaved attendance changes. Leave anyway?"
) {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const messageRef = useRef(message);
  messageRef.current = message;
  const tokenRef = useRef<symbol>(Symbol("dirty-guard-instance"));

  // Register/deregister this instance with the module-level set so
  // `isAnyAttendanceDirty()` works for unrelated components.
  useEffect(() => {
    const tok = tokenRef.current;
    if (isDirty) dirtyInstances.add(tok);
    else dirtyInstances.delete(tok);
    return () => { dirtyInstances.delete(tok); };
  }, [isDirty]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // Modern browsers ignore the string; we still set it for older Safari.
      e.returnValue = messageRef.current;
      return messageRef.current;
    };

    // popstate guard — fires on browser back/forward/swipe.
    // Without this, navigation away from a dirty page silently discards changes.
    const popHandler = (e: PopStateEvent) => {
      if (!dirtyRef.current) return;
      const ok = window.confirm(messageRef.current);
      if (!ok) {
        // Re-push the URL we were just on so the user stays put.
        history.pushState(null, "", window.location.href);
        e.preventDefault?.();
      }
    };

    window.addEventListener("beforeunload", handler);
    window.addEventListener("popstate", popHandler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("popstate", popHandler);
    };
    // empty deps — listener always reads the latest dirty bit + message via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Use before in-app navigation:
   *   if (!confirmIfDirty()) return;
   *   navigate("/somewhere");
   */
  const confirmIfDirty = (): boolean => {
    if (!dirtyRef.current) return true;
    return window.confirm(messageRef.current);
  };

  return { confirmIfDirty };
}
