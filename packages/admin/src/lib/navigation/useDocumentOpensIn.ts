/**
 * Where the document being edited opens by the admin's one "open this
 * document" rule, and the list it is opened from, for a document view that
 * words its way out by them: a view the document opens in has no form to go
 * back to, so its way out is the list, named as the list names itself.
 *
 * @module lib/navigation/useDocumentOpensIn
 */
import { useMemo } from "react";

import { useDocumentIdentity } from "@admin/components/features/entries/EntryForm/EntryFormContext";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useEveryNavCollection } from "@admin/hooks/queries/useCollections";

import { collectionOpeningView } from "./document-address";
import { collectionScreen, resolveScreenName } from "./screen-names";
import { usePublishedDocumentViews } from "./useDocumentAddress";

/**
 * @experimental Where the surrounding collection entry opens, and its list.
 */
export interface DocumentOpensIn {
  /**
   * `"form"`, or the path of the document view a click on one of the
   * collection's entries opens, as `admin.opensIn` names one. Read from the
   * collection as it is now, before the fallbacks for one reader or language,
   * which a view that is open has already passed.
   */
  opensIn: string;
  /** The collection's list: what it is called and its address. */
  list: { label: string; address: string };
}

/**
 * @experimental Where the surrounding collection entry opens and its list, or
 * null outside a collection entry's editor, on a new entry, on a Single
 * (which opens as its form) and while the collection is not known yet.
 */
export function useDocumentOpensIn(): DocumentOpensIn | null {
  const identity = useDocumentIdentity();
  const { data } = useEveryNavCollection();
  const views = usePublishedDocumentViews();
  const slug = identity?.kind === "collection" ? identity.slug : undefined;
  const saved = identity?.documentId !== undefined;
  const collection = useMemo(
    () =>
      slug === undefined
        ? undefined
        : (data ?? []).find(each => each.name === slug),
    [data, slug]
  );
  return useMemo(() => {
    if (slug === undefined || !saved || collection === undefined) return null;
    const address = buildRoute(ROUTES.COLLECTION_ENTRIES, { slug });
    return {
      opensIn: collectionOpeningView(slug, collection, views)?.path ?? "form",
      list: {
        // As the list's own heading and the sidebar call it.
        label:
          resolveScreenName(collectionScreen, {
            pathname: address,
            collection,
          }) ?? slug,
        address,
      },
    };
  }, [slug, saved, collection, views]);
}
