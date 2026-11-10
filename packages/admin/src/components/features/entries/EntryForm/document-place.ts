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
import { useMemo } from "react";

import type { PlaceProps } from "@admin/components/shared/target-slot";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import type {
  DocumentPanelSectionProps,
  SidebarSectionProps,
} from "@admin/lib/plugins/component-registry";

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
  const userId = user?.id;
  const slug = target.kind === "single" ? target.single : target.collection;
  const entryId = target.kind === "single" ? null : target.entryId;
  // One place per page state, so what is worked out from it (the panel's
  // order) is not worked out again on every render.
  return useMemo((): DocumentPlace => {
    // Held while the viewer is not known yet, so no contribution is handed
    // an id that is not theirs.
    const withEntry = entry === undefined ? {} : { entry };
    if (target.kind === "single") {
      return {
        place: "single.edit",
        context: userId === undefined ? null : { userId, single: slug },
        ...withEntry,
      };
    }
    return {
      place: "collection.edit",
      context:
        userId === undefined ? null : { userId, collection: slug, entryId },
      ...withEntry,
    };
  }, [target.kind, userId, slug, entryId, entry]);
}

/**
 * What a side panel section a plugin declared at the page's place is handed:
 * the place's context and entry, and on a collection entry's page the
 * document's own handles too (`documentProps`), which a section there needs
 * before it is drawn. None while the page does not know its ids.
 */
export function sidebarSectionProps(
  place: DocumentPlace,
  documentProps?: DocumentPanelSectionProps
): SidebarSectionProps | undefined {
  const withEntry = place.entry === undefined ? {} : { entry: place.entry };
  if (place.place === "single.edit") {
    return place.context === null
      ? undefined
      : { context: place.context, ...withEntry };
  }
  return place.context === null || documentProps === undefined
    ? undefined
    : { ...documentProps, context: place.context, ...withEntry };
}
