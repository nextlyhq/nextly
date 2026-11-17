/**
 * Asking a read again when the author returns to the tab, for the reads a
 * change made in another tab (a set's admin form) must reach.
 *
 * @module admin/refresh-on-return
 */
import { useEffect, useRef } from "react";

/**
 * Ask again when the author returns to this tab: on window focus, and when
 * the page becomes visible. The admin turns refetch-on-focus off for every
 * read, so this one read asks for it itself.
 */
export function useRefreshOnReturn(
  enabled: boolean,
  refetch: () => void
): void {
  // The newest `refetch`, without re-attaching the listeners on each render:
  // the read hands out a new function every time.
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  });
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => latest.current();
    const onVisible = () => {
      if (document.visibilityState !== "hidden") latest.current();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}
