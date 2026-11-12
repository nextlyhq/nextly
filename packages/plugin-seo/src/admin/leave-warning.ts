import { useEffect } from "react";

/** Leaving the page with unsaved changes asks first. */
export function useLeaveWarning(unsaved: boolean): void {
  useEffect(() => {
    if (!unsaved) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
}
