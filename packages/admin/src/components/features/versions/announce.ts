/**
 * Saying something to assistive technology from the history screens: a restore, and its undo,
 * which a sighted person sees in a toast. Said through one visually hidden, polite status region
 * of the history's own, so what a screen reader hears does not depend on the toast.
 *
 * The region sits on the document body, outside the admin's scoped styles, so it is hidden by
 * its own inline style rather than by the `sr-only` class, which does not reach it there.
 *
 * @module components/features/versions/announce
 */

/** The id of the one region history announces through. */
export const HISTORY_ANNOUNCER_ID = "nextly-history-announcer";

/** Visually hidden and still read: the usual screen-reader-only rule, inline. */
const HIDDEN_STYLE =
  "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";

function region(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(HISTORY_ANNOUNCER_ID);
  if (existing) return existing;
  const created = document.createElement("div");
  created.id = HISTORY_ANNOUNCER_ID;
  created.setAttribute("role", "status");
  created.setAttribute("aria-live", "polite");
  created.setAttribute("style", HIDDEN_STYLE);
  document.body.appendChild(created);
  return created;
}

/**
 * Says `message` politely to assistive technology. The same message said twice in a row is told
 * apart by a trailing no-break space, since a region whose text does not change is not read again.
 */
export function announce(message: string): void {
  const target = region();
  if (target === null) return;
  target.textContent =
    target.textContent === message ? `${message}\u00a0` : message;
}
