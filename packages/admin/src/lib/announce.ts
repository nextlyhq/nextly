/**
 * Saying something to assistive technology that a sighted person sees in a toast: through a
 * visually hidden, polite status region of the speaker's own, so what a screen reader hears does
 * not depend on the toast.
 *
 * Each region sits on the document body, outside the admin's scoped styles, so it is hidden by
 * its own inline style rather than by the `sr-only` class, which does not reach it there.
 *
 * @module lib/announce
 */

/** Visually hidden and still read: the usual screen-reader-only rule, inline. */
const HIDDEN_STYLE =
  "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";

function region(id: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(id);
  if (existing) return existing;
  const created = document.createElement("div");
  created.id = id;
  created.setAttribute("role", "status");
  created.setAttribute("aria-live", "polite");
  created.setAttribute("style", HIDDEN_STYLE);
  document.body.appendChild(created);
  return created;
}

/**
 * Puts the region with this id in the page, empty, ahead of anything said into it. Assistive
 * technology registers a live region when it appears, so one made and filled in the same task can
 * stay silent for that first message; a screen that will announce mounts its region first.
 */
export function mountAnnouncerRegion(id: string): void {
  region(id);
}

/**
 * A function that says a message politely through the region with this id, made on first use.
 * The same message said twice in a row is told apart by a trailing no-break space, since a
 * region whose text does not change is not read again.
 */
export function announcerAt(id: string): (message: string) => void {
  return message => {
    const target = region(id);
    if (target === null) return;
    target.textContent =
      target.textContent === message ? `${message} ` : message;
  };
}
