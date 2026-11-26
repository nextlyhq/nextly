/**
 * The references that point at something neither the import brings nor the
 * target site has: links to missing items. They are kept as they are, so
 * nothing is lost, and listed for the plan and the report.
 *
 * @module domains/data/references/missing-links
 */

import {
  mappedReference,
  MEDIA_COLLECTION,
  type ContentReference,
  type ReferenceMap,
} from "./reference-map";

/** What the target site holds, asked of each reference the map does not move. */
export interface TargetHolds {
  /** Whether the target has the item with `id` in `collection`. */
  link(collection: string, id: string): boolean;
  /**
   * Whether an address is one the import's source served its media files
   * at, and so one that can point at a missing file. An address naming a
   * media item by its route is judged by that item; any other, such as an
   * image on another site, is not judged unless this says it is the
   * source's. Absent: no such address is judged.
   */
  isSourceAddress?(url: string): boolean;
  /** Whether the target serves a media file at `url`. */
  address?(url: string): boolean;
}

function isMissing(
  reference: ContentReference,
  map: ReferenceMap,
  holds: TargetHolds
): boolean {
  if (mappedReference(map, reference) !== undefined) return false;
  if (reference.kind === "link") {
    // An inferred id is only likely a media item's, so its absence says
    // nothing; a link whose collection is unknown cannot be found anywhere.
    if (reference.inferred) return false;
    return (
      reference.collection === null ||
      !holds.link(reference.collection, reference.id)
    );
  }
  if (reference.mediaId !== undefined) {
    return !holds.link(MEDIA_COLLECTION, reference.mediaId);
  }
  if (holds.isSourceAddress?.(reference.url) !== true) return false;
  return holds.address?.(reference.url) !== true;
}

/**
 * The references in `references` that `map` does not move and the target
 * does not hold, in the order given.
 */
export function missingLinks(
  references: readonly ContentReference[],
  map: ReferenceMap,
  holds: TargetHolds
): ContentReference[] {
  return references.filter(reference => isMissing(reference, map, holds));
}
