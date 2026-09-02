import type { ApiCollection } from "@admin/types/entities";
import type { AdminCapabilities } from "@admin/types/permissions";

/** Resolves where a collection has been placed, bound to one render's metadata. */
export type CollectionPlacement = (
  collection: ApiCollection
) => string | undefined;

/**
 * Whether a collection would appear in the rail's Collections section.
 *
 * Hidden collections never do. A PLUGIN-owned collection appears there only
 * when its placement says so or says nothing — a plugin that claims a placement
 * of its own has moved its collection out of this section, and counting it here
 * would offer a section whose destinations have all gone elsewhere.
 *
 * Placement arrives as a function rather than as resolved values because the
 * caller memoises it over this render's plugin metadata, for the reason
 * `types/route-section` gives: two implementations of "where does this
 * collection belong" would let the rail and the panel disagree.
 */
export function belongsInCollectionsSection(
  collection: ApiCollection,
  placementOf: CollectionPlacement
): boolean {
  if (collection.admin?.hidden) return false;
  if (!collection.admin?.isPlugin) return true;
  const placement = placementOf(collection);
  return placement === "collections" || !placement;
}

interface CollectionsSectionInputs {
  /** True while permissions or the collections query are still resolving. */
  isPending: boolean;
  /** True when the collections query FAILED rather than returned nothing. */
  isError: boolean;
  /** The collections this reader may see. */
  permittedCollections: readonly ApiCollection[];
  placementOf: CollectionPlacement;
}

/**
 * Whether the Collections entry appears in the primary rail.
 *
 * Shown while the answer is still unknown — permissions loading, collections
 * loading, or the collections query having FAILED. That last arm is deliberate
 * and is the opposite of the rule in `has-plugins-section` beside it: a failed
 * query here means the rail cannot tell whether this reader has collections,
 * and hiding the section would remove their only route to content they are
 * allowed to see. The plugins panel has a second destination for a settings
 * manager, so it can afford to decide; this one cannot.
 *
 * @module components/layout/sidebar/lib/has-collections-section
 */
export function hasCollectionsSection(
  capabilities: Pick<AdminCapabilities, "canViewCollections">,
  inputs: CollectionsSectionInputs
): boolean {
  if (!capabilities.canViewCollections) return false;
  if (inputs.isPending || inputs.isError) return true;
  return inputs.permittedCollections.some(collection =>
    belongsInCollectionsSection(collection, inputs.placementOf)
  );
}
