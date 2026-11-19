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

/** The region with this id, and whether it was put in the page just now. */
function region(id: string): { target: HTMLElement; created: boolean } | null {
  if (typeof document === "undefined" || document.body === null) return null;
  const existing = document.getElementById(id);
  if (existing) return { target: existing, created: false };
  const created = document.createElement("div");
  created.id = id;
  created.setAttribute("role", "status");
  created.setAttribute("aria-live", "polite");
  created.setAttribute("style", HIDDEN_STYLE);
  document.body.appendChild(created);
  return { target: created, created: true };
}

/**
 * How long a region put in the page just now stays empty before its first message: assistive
 * technology registers a live region when it appears, and a region created and filled in the
 * same task can stay silent for that first message.
 */
const FIRST_MESSAGE_DELAY_MS = 100;

/**
 * A function that says a message politely through the region with this id. The region is put in
 * the page when the announcer is made, so it is registered, empty, well before anything is said
 * into it; one that has to be made again when a message comes (the page cleared it) gets that
 * message a moment later, for the same reason. The same message said twice in a row is told
 * apart by a trailing no-break space, since a region whose text does not change is not read
 * again.
 */
export function announcerAt(id: string): (message: string) => void {
  region(id);
  return message => {
    const found = region(id);
    if (found === null) return;
    const { target, created } = found;
    const write = () => {
      target.textContent =
        target.textContent === message ? `${message} ` : message;
    };
    if (created) setTimeout(write, FIRST_MESSAGE_DELAY_MS);
    else write();
  };
}
