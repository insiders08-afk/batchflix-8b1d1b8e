import { useEffect, useRef } from "react";

/**
 * Prompt the user before leaving the page when they have unsaved attendance.
 *
 * Covers two exit vectors:
 *  - Browser tab close / refresh / external nav → `beforeunload` event
 *  - In-app navigation (router) → consumers should call `confirmIfDirty()`
 *    before pushing a new route. The hook returns the helper.
 */
export function useDirtyGuard(isDirty: boolean, message = "You have unsaved attendance changes. Leave anyway?") {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [message]);

  /**
   * Use before in-app navigation:
   *   if (!confirmIfDirty()) return;
   *   navigate("/somewhere");
   */
  const confirmIfDirty = (): boolean => {
    if (!dirtyRef.current) return true;
    return window.confirm(message);
  };

  return { confirmIfDirty };
}
