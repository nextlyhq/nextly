/**
 * Where the document being edited opens by the admin's one "open this
 * document" rule, and where it is opened from, for a document view that
 * words its way out by them: a view the document opens in has no form to go
 * back to, so its way out is the place the click started. A collection's
 * entry comes from its list, named as the list names itself; a Single from
 * the Content screen, where Singles are found.
 *
 * @module lib/navigation/useDocumentOpensIn
 */
import { useMemo } from "react";

import { useDocumentIdentity } from "@admin/components/features/entries/EntryForm/EntryFormContext";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useEveryNavCollection } from "@admin/hooks/queries/useCollections";
import { useEverySingle } from "@admin/hooks/queries/useSingles";
import type { RegisteredDocumentView } from "@admin/lib/plugins/document-view-registry";
import type { ApiCollection, ApiSingle } from "@admin/types/entities";

import { documentOpeningView } from "./document-address";
import { collectionScreen, resolveScreenName } from "./screen-names";
import { usePublishedDocumentViews } from "./useDocumentAddress";

/**
 * @experimental Where the surrounding collection entry or Single opens, and
 * where it is opened from.
 */
export interface DocumentOpensIn {
  /**
   * `"form"`, or the path of the document view a click on the document
   * opens, as `admin.opensIn` names one. Read from the collection or Single
   * as it is now, before the fallbacks for one reader or language, which a
   * view that is open has already passed.
   */
  opensIn: string;
  /**
   * Where the document is opened from: a collection's list, named as the
   * list names itself ("Pages"), or for a Single the Content screen, named
   * as a sentence names it ("content"). What it is called and its address.
   */
  list: { label: string; address: string };
}

/**
 * Where a Single is opened from: the Content screen, which lists every
 * Single, worded to follow "Back to" in a sentence.
 */
const SINGLES_COME_FROM = { label: "content", address: ROUTES.CONTENT };

/** A collection's answer: where its entries open, and its list. */
function collectionOpensIn(
  slug: string,
  collection: ApiCollection,
  views: readonly RegisteredDocumentView[]
): DocumentOpensIn {
  const address = buildRoute(ROUTES.COLLECTION_ENTRIES, { slug });
  return {
    opensIn:
      documentOpeningView({ kind: "collection", slug }, collection, views)
        ?.path ?? "form",
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
}

/** A Single's answer: where it opens, and the Content screen. */
function singleOpensIn(
  slug: string,
  single: ApiSingle,
  views: readonly RegisteredDocumentView[]
): DocumentOpensIn {
  return {
    opensIn:
      documentOpeningView({ kind: "single", slug }, single, views)?.path ??
      "form",
    list: SINGLES_COME_FROM,
  };
}

/**
 * @experimental Where the surrounding collection entry or Single opens and
 * where it is opened from, or null outside a document's editor, on a new
 * entry and while the collection or Single is not known yet.
 */
export function useDocumentOpensIn(): DocumentOpensIn | null {
  const identity = useDocumentIdentity();
  const { data: collections } = useEveryNavCollection();
  const { data: singles } = useEverySingle();
  const views = usePublishedDocumentViews();
  const kind = identity?.kind;
  const slug = identity?.slug;
  // A collection's entry is opened once it is saved; a Single always is.
  const saved = kind === "single" || identity?.documentId !== undefined;
  const collection = useMemo(
    () =>
      kind === "collection"
        ? (collections ?? []).find(each => each.name === slug)
        : undefined,
    [collections, kind, slug]
  );
  const single = useMemo(
    () =>
      kind === "single"
        ? (singles ?? []).find(each => each.slug === slug)
        : undefined,
    [singles, kind, slug]
  );
  return useMemo(() => {
    if (slug === undefined || !saved) return null;
    if (collection !== undefined) {
      return collectionOpensIn(slug, collection, views);
    }
    return single === undefined ? null : singleOpensIn(slug, single, views);
  }, [slug, saved, collection, single, views]);
}
