/**
 * Where focus goes when a dialog opened from state closes: back to the control that opened it,
 * where the person left off. A dialog opened from state has no trigger of its own, so without
 * this the dialog hands focus to the page's body, and a keyboard or screen-reader user starts
 * again from the top.
 *
 * What had focus is read in a layout effect as the dialog opens, before the dialog moves focus
 * into itself. Where that control is gone by the time the dialog closes (a step taken redraws
 * the header for the next stage), `fallback` names where focus goes instead.
 *
 * @module hooks/useDialogReturnFocus
 */

import { useLayoutEffect, useRef } from "react";

/**
 * The dialog content's `onCloseAutoFocus` handler for a dialog that is `open`: it puts focus back
 * on what opened it, or on `fallback()` where that is gone; otherwise it leaves the dialog's own
 * behaviour alone.
 */
export function useDialogReturnFocus(
  open: boolean,
  fallback?: () => HTMLElement | null
): (event: Event) => void {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      opener.current = document.activeElement;
    }
  }, [open]);
  return event => {
    const before = opener.current;
    opener.current = null;
    // The page's body is no control: where focus rested there, there is no place to go back to.
    const back =
      before !== null && before.isConnected && before !== document.body
        ? before
        : (fallback?.() ?? null);
    if (back === null) return;
    event.preventDefault();
    back.focus();
  };
}

/**
 * Where a step dialog's focus goes when what opened it is gone: the editor's main action, or,
 * where a step left the person none (one who may only read and approve has approved), the review
 * section, which takes focus as a whole. Never the page's body, where a keyboard or screen-reader
 * user would start again from the top.
 */
export function editorMainAction(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-primary="true"]') ??
    document.querySelector<HTMLElement>("[data-review-focus]")
  );
}
