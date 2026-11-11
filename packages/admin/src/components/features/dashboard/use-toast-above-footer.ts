/**
 * Lifts the admin's toasts above a drawer's footer while the drawer is open.
 *
 * The toaster sits in the window's bottom corner, which is where a drawer from the right keeps
 * its footer: a toast said about the footer's own button ("Diagnostics copied") would be drawn
 * over that button. While `open`, the toaster's bottom offset (the shared property it reads,
 * `TOAST_OFFSET_BOTTOM_PROPERTY`) is the footer's height plus a gap, followed as the footer
 * changes size; closing the drawer puts toasts back in their corner.
 *
 * @module components/features/dashboard/use-toast-above-footer
 */

import { useEffect, type RefObject } from "react";

import { TOAST_OFFSET_BOTTOM_PROPERTY } from "@admin/constants/ui";

/** The space between the footer's top and a toast's bottom. */
const GAP_PX = 12;

export function useToastAboveFooter(
  footerRef: RefObject<HTMLElement | null>,
  open: boolean
): void {
  useEffect(() => {
    const footer = footerRef.current;
    if (!open || footer === null) return;
    const root = document.documentElement;
    const lift = () =>
      root.style.setProperty(
        TOAST_OFFSET_BOTTOM_PROPERTY,
        `${footer.offsetHeight + GAP_PX}px`
      );
    lift();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(lift);
    observer?.observe(footer);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(TOAST_OFFSET_BOTTOM_PROPERTY);
    };
  }, [footerRef, open]);
}
