/**
 * Whether "View all pins" is open, and the one way to open it from anywhere in
 * the admin: the Continue card's footer, and every pin toast's "View all pins"
 * (the entry page, a Single, a dashboard row).
 *
 * One dialog for the whole admin, drawn by `AllPinsHost`, so a person who
 * meets the pin limit on an entry page unpins one in place and pins again
 * without leaving it. Kept apart from the dialog, and importing nothing, so
 * what every screen loads to be able to open it is this and the host alone.
 *
 * @module components/features/dashboard/all-pins
 */

import { useSyncExternalStore } from "react";

let open = false;
/** What had focus when the dialog opened, given it back on close. */
let returnTo: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open "View all pins", remembering what had focus to give it back on close. */
export function openAllPins(): void {
  returnTo =
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  open = true;
  emit();
}

/** Close "View all pins". */
export function closeAllPins(): void {
  open = false;
  emit();
}

/**
 * The element that had focus when the dialog opened, while it is still on the
 * page; `null` once it is gone (a toast that has closed), so the dialog's own
 * default takes over.
 */
export function allPinsReturnFocus(): HTMLElement | null {
  return returnTo?.isConnected === true ? returnTo : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether "View all pins" is open. */
export function useAllPinsOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false
  );
}
