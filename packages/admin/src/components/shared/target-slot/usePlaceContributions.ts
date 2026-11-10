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
 * What only the page can judge is a contribution's `visibleWhen` against the
 * entry on screen, with the one evaluator the server uses (`rowMatches`).
 *
 * @module components/shared/target-slot/usePlaceContributions
 */
import {
  CORE_ADMIN_PLACES,
  rowMatches,
  type AdminContributionsMeta,
  type AdminPlaceId,
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

/**
 * The place's entries of `kind`, in the order delivered: the page's built-in
 * parts as `{ builtIn }`, and the contributions this reader was sent whose
 * `visibleWhen` matches `entry`. With nothing delivered, the place's built-in
 * parts in the catalogue's order, which is how the page draws today.
 *
 * A rule is judged only where the page shows one entry; with none, a
 * contribution carrying a rule is not drawn, since there is nothing to
 * settle it.
 */
export function usePlaceContributions(
  place: AdminPlaceId,
  kind: PlaceKind,
  entry?: Record<string, unknown>,
  /**
   * The page does not know its context yet: only the page's own parts are
   * drawn, all of them, as with nothing delivered. A delivered list would
   * leave out a part a contribution replaces, and that contribution cannot be
   * drawn yet either, so the slot would stand empty.
   */
  held = false
): readonly DeliveredAdminEntry[] {
  const { contributions } = useBranding();
  const delivered = contributions?.[place]?.[kind];
  if (held || delivered === undefined) return catalogueBuiltIns(place, kind);
  return delivered.filter(
    item =>
      "builtIn" in item ||
      item.visibleWhen === undefined ||
      (entry !== undefined && rowMatches(item.visibleWhen, entry))
  );
}
