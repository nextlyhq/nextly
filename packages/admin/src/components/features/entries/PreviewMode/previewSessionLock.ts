"use client";

/**
 * Which pane owns this browser's ONE preview session.
 *
 * The site stores the preview credential in a single cookie - one name, one
 * value, `Path=/` - so a browser profile holds at most one preview scope at a
 * time no matter how many panes are open. Every mint overwrites it. Two panes
 * on different entries therefore take the session from each other, and the
 * loser is not told: its next in-frame navigation carries the WINNER's scope,
 * the draft gate refuses it, and the site answers with the published page. A
 * pane showing published content while captioned "last saved draft" is the
 * failure this exists to prevent.
 *
 * The renewal timer is what made silence intolerable. A pane left open re-mints
 * on its own every few minutes, so two idle panes in two tabs would take the
 * session from each other indefinitely with nobody touching anything.
 * Announcing each claim turns that into a state the loser can see and recover
 * from.
 *
 * Panes on the SAME scope do not conflict - they share one valid cookie - so
 * the key carries the locale as well as the entry. A preview of the same entry
 * in another language is a different scope and does supersede.
 *
 * This does not FIX the singleton; it makes it honest. The durable answer is a
 * cookie that can hold more than one scope, which is a change to the site's
 * preview route rather than to the admin.
 *
 * @module components/features/entries/PreviewMode/previewSessionLock
 */

/** Shared by every admin tab on this origin. */
const CHANNEL = "nextly.preview.session";

/**
 * What a pane is previewing, as the value two panes compare.
 *
 * A string rather than the parts, because it is only ever compared for equality
 * and a structured payload invites a reader to match on one field.
 */
export function previewScopeKey(
  collection: string,
  entryId: string,
  locale: string | undefined
): string {
  return `${collection} ${entryId} ${locale ?? ""}`;
}

export interface PreviewSessionLock {
  /** Announce that this pane just minted and now owns the cookie. */
  claim: () => void;
  /** Stop listening. Safe to call more than once. */
  release: () => void;
}

/**
 * Watch for another pane taking the session, and announce when this one takes it.
 *
 * `onSuperseded` fires only for a claim on a DIFFERENT scope.
 * `BroadcastChannel` does not deliver a message back to the context that posted
 * it, so a pane cannot supersede itself and no echo guard is needed.
 *
 * Returns an inert lock where `BroadcastChannel` is missing rather than
 * throwing. Losing the warning degrades the pane to today's behaviour; refusing
 * to mint would remove a preview that otherwise works.
 */
export function watchPreviewSession(
  scopeKey: string,
  onSuperseded: () => void
): PreviewSessionLock {
  if (typeof BroadcastChannel === "undefined") {
    return { claim: () => {}, release: () => {} };
  }

  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    const claimed = (event.data as { scopeKey?: unknown } | null)?.scopeKey;
    if (typeof claimed !== "string") return;
    if (claimed === scopeKey) return;
    onSuperseded();
  };

  return {
    claim: () => channel.postMessage({ scopeKey }),
    release: () => {
      // Drop the handler before closing: a message already queued would
      // otherwise reach a pane that has unmounted, and the state write that
      // follows is one React warns about.
      channel.onmessage = null;
      channel.close();
    },
  };
}
