/**
 * Which of a place's delivered entries a page draws: the one rule every place
 * part follows, whether a hook reads the list (blocks, tabs) or a page orders
 * its own parts by it (the document panel's sections).
 *
 * The server sends each place's lists once per reader, already ordered and
 * pruned of what the reader may not see. A contribution scoped to some
 * collections, or ruled by `visibleWhen`, still arrives on every page of its
 * place, and only the page can settle it: it knows who is looking, which
 * collection it shows, and the entry on screen. A contribution that cannot be
 * drawn there and replaces a built-in part gives that part back where it
 * stood, as the server does for one it does not send, so a replacement drawn
 * only for drafts leaves a published entry its own part.
 *
 * @module lib/plugins/place-entries
 */
import {
  rowMatches,
  type DeliveredAdminContribution,
  type DeliveredAdminEntry,
} from "nextly/config";

/** What the page knows that decides whether a contribution is drawn on it. */
export interface PlaceView {
  /** The place's context, or `null` while the page does not know its ids. */
  context: unknown;
  /** The entry the page shows, where it shows one. */
  entry?: Record<string, unknown>;
}

/** The collection a page shows, as its place's context names it, if any. */
function pageCollection(context: unknown): string | undefined {
  return typeof context === "object" &&
    context !== null &&
    "collection" in context &&
    typeof context.collection === "string"
    ? context.collection
    : undefined;
}

/**
 * Whether a contribution can be drawn on this page: once the page knows its
 * ids, on a collection it is offered on, and where its rule matches the
 * entry. A rule is judged only where the page shows one entry; with none, a
 * contribution carrying a rule is not drawn, since nothing settles it. A
 * contribution scoped to collections, on a page that names none, is not.
 */
function drawableHere(
  item: DeliveredAdminContribution,
  { context, entry }: PlaceView
): boolean {
  if (context === null || context === undefined) return false;
  if (item.collections !== undefined) {
    const collection = pageCollection(context);
    if (collection === undefined || !item.collections.includes(collection)) {
      return false;
    }
  }
  return (
    item.visibleWhen === undefined ||
    (entry !== undefined && rowMatches(item.visibleWhen, entry))
  );
}

/**
 * The delivered entries this page draws, in the order delivered: the page's
 * built-in parts as `{ builtIn }`, and the contributions that can be drawn
 * here; one that cannot, and replaces a built-in part, gives that part back
 * in its place, and any other that cannot is left out.
 */
export function entriesDrawnHere(
  delivered: readonly DeliveredAdminEntry[],
  view: PlaceView
): DeliveredAdminEntry[] {
  return delivered.flatMap((item): DeliveredAdminEntry[] => {
    if ("builtIn" in item || drawableHere(item, view)) return [item];
    return item.replaces === undefined ? [] : [{ builtIn: item.replaces }];
  });
}
