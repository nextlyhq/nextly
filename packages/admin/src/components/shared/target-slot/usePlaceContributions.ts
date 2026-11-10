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
 * What only the page can judge is whether a contribution can be drawn here,
 * by the one rule every place part follows (`entriesDrawnHere`): who is
 * looking, which collection the page shows, and the entry on screen.
 *
 * @module components/shared/target-slot/usePlaceContributions
 */
import {
  CORE_ADMIN_PLACES,
  type AdminContributionsMeta,
  type AdminPlaceId,
  type DeliveredAdminEntry,
} from "nextly/config";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import {
  entriesDrawnHere,
  type PlaceView,
} from "@admin/lib/plugins/place-entries";

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

export type { PlaceView } from "@admin/lib/plugins/place-entries";

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
  return entriesDrawnHere(delivered, view);
}
