"use client";

/**
 * One place's list of one kind, as the page draws it.
 *
 * The server sends each place's lists already ordered and filtered for this
 * reader: a contribution they may not see is not sent at all, and a list of
 * built-in parts alone is not sent, since it says nothing the page does not.
 * So the order and the permission are the server's, and are never worked out
 * again here; a second decision in the browser would be a second door to
 * the same question.
 *
 * What only the page can judge is whether a contribution can be drawn here:
 * the page knows who is looking, which collection it shows, and the entry on
 * screen, which a `visibleWhen` is judged against with the one evaluator the
 * server uses (`rowMatches`). A contribution sent for this place may be
 * scoped to other collections than this page's: the server sends it once,
 * with the collections it is offered on.
 *
 * A contribution that cannot be drawn here and replaces a built-in part gives
 * that part back where it stood, as the server does for one it does not send:
 * a replacement drawn only for drafts leaves a published entry its own part.
 *
 * @module components/shared/target-slot/usePlaceContributions
 */
import {
  CORE_ADMIN_PLACES,
  rowMatches,
  type AdminContributionsMeta,
  type AdminPlaceId,
  type DeliveredAdminContribution,
  type DeliveredAdminEntry,
} from "nextly/config";

import { useBranding } from "@admin/context/providers/BrandingProvider";

/** One kind of contribution, as a place's lists are keyed. */
export type PlaceKind = keyof AdminContributionsMeta[string];

/** A core place's built-in parts of one kind, in the order its page draws them. */
function catalogueBuiltIns(
  place: AdminPlaceId,
  kind: PlaceKind
): readonly DeliveredAdminEntry[] {
  if (!Object.hasOwn(CORE_ADMIN_PLACES, place)) return [];
  const builtIns: Partial<Record<PlaceKind, readonly string[]>> =
    CORE_ADMIN_PLACES[place].builtIns;
  return (builtIns[kind] ?? []).map(name => ({ builtIn: name }));
}

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
 * The place's entries of `kind` this page draws, in the order delivered: the
 * page's built-in parts as `{ builtIn }`, and the contributions this reader
 * was sent that can be drawn here; one that cannot, and replaces a built-in
 * part, gives that part back in its place. With nothing delivered, the
 * place's built-in parts in the catalogue's order, which is how the page
 * draws today.
 */
export function usePlaceContributions(
  place: AdminPlaceId,
  kind: PlaceKind,
  view: PlaceView
): readonly DeliveredAdminEntry[] {
  const { contributions } = useBranding();
  const delivered = contributions?.[place]?.[kind];
  if (delivered === undefined) return catalogueBuiltIns(place, kind);
  return delivered.flatMap((item): DeliveredAdminEntry[] => {
    if ("builtIn" in item || drawableHere(item, view)) return [item];
    return item.replaces === undefined ? [] : [{ builtIn: item.replaces }];
  });
}
