import { useEffect, useRef } from "react";

/**
 * Prompt the user before leaving the page when they have unsaved attendance.
 *
 * Covers two exit vectors:
 *  - Browser tab close / refresh / external nav → `beforeunload` event
 *  - In-app navigation (router) → consumers should call `confirmIfDirty()`
 *    before pushing a new route. The hook returns the helper.
 *
 * B14 hardening:
 *  - Reads `message` via a ref so the listener never re-binds (the listener
 *    only depends on the dirty bit, not the human-readable message string).
 *  - Listens to `popstate` so the browser's back/forward button also
 *    triggers a confirm — previously you could lose unsaved changes by
 *    swiping back on Android with no warning.
 */
export function useDirtyGuard(
  isDirty: boolean,
  message = "You have unsaved attendance changes. Leave anyway?"
) {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const messageRef = useRef(message);
  messageRef.current = message;

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
