"use client";

/**
 * The edit page's place, as both editors hand it to the parts that draw it:
 * a collection entry's page is `collection.edit`, a Single's `single.edit`.
 *
 * One hook for both editors, so the two pages cannot come to disagree about
 * what a plugin's block, tab or side panel section is told. The context names
 * ids only; the document as loaded goes beside it as `entry`, which is also
 * what a contribution's `visibleWhen` is judged on.
 *
 * @module components/entries/EntryForm/document-place
 */
import type { PlaceProps } from "@admin/components/shared/target-slot";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";

/** The place an edit page draws: a collection entry's, or a Single's. */
export type DocumentPlace =
  | PlaceProps<"collection.edit">
  | PlaceProps<"single.edit">;

/** Which document an edit page shows. */
export type DocumentPlaceTarget =
  | {
      kind: "collection";
      /** The collection's slug. */
      collection: string;
      /** The entry's id, or `null` while it is being created. */
      entryId: string | null;
    }
  | {
      kind: "single";
      /** The Single's slug. */
      single: string;
    };

export function useDocumentPlace(
  target: DocumentPlaceTarget,
  entry?: Record<string, unknown>
): DocumentPlace {
  const { user } = useDashboardUser();
  // Held while the viewer is not known yet, so no contribution is handed an
  // id that is not theirs.
  const withEntry = entry === undefined ? {} : { entry };
  if (target.kind === "single") {
    return {
      place: "single.edit",
      context: user ? { userId: user.id, single: target.single } : null,
      ...withEntry,
    };
  }
  return {
    place: "collection.edit",
    context: user
      ? {
          userId: user.id,
          collection: target.collection,
          entryId: target.entryId,
        }
      : null,
    ...withEntry,
  };
}
