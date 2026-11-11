/**
 * Lifts the admin's toasts above a drawer's footer while the footer is drawn.
 *
 * The toaster sits in the window's bottom corner, which is where a drawer from the right keeps
 * its footer: a toast said about the footer's own button ("Diagnostics copied") would be drawn
 * over that button. While `footer` is on the page, the toaster's bottom offset (the shared
 * property it reads, `TOAST_OFFSET_BOTTOM_PROPERTY`) is the footer's height plus a gap, followed
 * as the footer changes size; once the footer is gone, toasts go back to their corner.
 *
 * Takes the element itself, as a callback ref sets it, rather than a ref object: a drawer mounts
 * its content after the render that opens it, so a ref read then would still be empty.
 *
 * @module components/features/dashboard/use-toast-above-footer
 */

import { useEffect } from "react";

import { TOAST_OFFSET_BOTTOM_PROPERTY } from "@admin/constants/ui";

/** The space between the footer's top and a toast's bottom. */
const GAP_PX = 12;

export function useToastAboveFooter(footer: HTMLElement | null): void {
  useEffect(() => {
    if (footer === null) return;
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
  }, [footer]);
}
