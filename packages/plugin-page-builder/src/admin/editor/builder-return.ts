/**
 * Where the entry form picks up when the author leaves the Page Builder: the
 * field the builder was open on, scrolled into view with its way back in
 * focused, so leaving lands the author where they went in.
 *
 * The builder remembers the field by its ADDRESS as it leaves, and the form's
 * fields each ask, as they mount, whether they are it. Inside a repeater the
 * address names the row by its saved id, so the field that answers is the one
 * in the same row wherever that row now stands: a reorder made since does not
 * hand the focus to whichever row took its place.
 *
 * Held in memory for one hand-over: a reload, or a field that never mounts
 * (its row collapsed or removed), leaves nothing behind but one stale entry
 * the next leave replaces.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/builder-return
 */
import type { DocumentIdentity } from "@nextlyhq/plugin-sdk/admin";

/** The field to return to: which document, and the field's address in it. */
interface ReturnTarget {
  readonly document: string;
  readonly field: string;
}

let pending: ReturnTarget | null = null;

/**
 * One key per document. JSON rather than a joined string, since a slug and an
 * id are free text here and a delimiter inside either would make two
 * documents one key.
 */
function documentKey(identity: DocumentIdentity): string {
  return JSON.stringify([
    identity.kind,
    identity.slug,
    identity.documentId ?? null,
  ]);
}

/**
 * Remember, as the builder is left, the field it was open on: `field` is its
 * address (`sections.<rowId>.body`), never its form path. Outside a document
 * there is no form to return to, and nothing is remembered.
 */
export function rememberBuilderReturn(
  identity: DocumentIdentity | null,
  field: string
): void {
  pending =
    identity === null ? null : { document: documentKey(identity), field };
}

/**
 * Whether the field at `field` (its address) on this document is the one the
 * builder was just left from. True once: the first field that answers takes
 * the return, so a second render or another copy of the form does not move
 * the focus again.
 */
export function claimBuilderReturn(
  identity: DocumentIdentity | null,
  field: string
): boolean {
  if (pending === null || identity === null) return false;
  if (pending.document !== documentKey(identity) || pending.field !== field) {
    return false;
  }
  pending = null;
  return true;
}

/** How long after landing the returned-to field is kept in view. */
const SETTLE_MS = 1500;

/** What the author does that ends the keeping: their own scroll or input. */
const AUTHOR_MOVES = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Centre `element` in view, and keep it centred while the form around it
 * settles. Content above it that draws after the first scroll (a preview, a
 * field that resizes once its value arrives) moves it, which left the author
 * looking past the row they came back to, its header out of view. So each
 * frame, for {@link SETTLE_MS}, a field that has moved is centred again. The
 * author's first scroll, key, touch or press ends it, so it never fights
 * them.
 *
 * @returns a stop, for the effect that started it to clean up with
 */
export function centreWhileSettling(
  element: HTMLElement,
  settleMs: number = SETTLE_MS
): () => void {
  if (typeof element.scrollIntoView !== "function") return () => undefined;
  const centre = () => {
    element.scrollIntoView({ block: "center" });
    return element.getBoundingClientRect().top;
  };
  let last = centre();
  let frame = 0;
  const started = performance.now();
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of AUTHOR_MOVES) {
      window.removeEventListener(type, stop, true);
    }
  };
  const keep = () => {
    if (performance.now() - started > settleMs) {
      stop();
      return;
    }
    if (element.getBoundingClientRect().top !== last) last = centre();
    frame = requestAnimationFrame(keep);
  };
  for (const type of AUTHOR_MOVES) {
    window.addEventListener(type, stop, { capture: true, passive: true });
  }
  frame = requestAnimationFrame(keep);
  return stop;
}
