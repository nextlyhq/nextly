/**
 * The shared "open this document" rule (`documentAddress`), and the other ways
 * into a document derived from it (`rowWaysIn`, `viewsToOpenIn`), with what
 * they need read from the signed-in admin: each collection as the admin lists
 * it, whether the reader may update it, the site's default language and the
 * published document views.
 *
 * @module lib/navigation/useDocumentAddress
 */
import { useCallback, useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useEveryNavCollection } from "@admin/hooks/queries/useCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useLocalization } from "@admin/hooks/useLocalization";
import type { RegisteredDocumentView } from "@admin/lib/plugins/document-view-registry";

import {
  createDialogOf,
  documentAddress,
  rowWaysIn,
  viewsToOpenIn,
  type OpenableCollection,
  type OpenedDocument,
  type OpenRequest,
  type WayIn,
} from "./document-address";

/** What a link may add to the document it opens. */
export interface OpenOptions {
  /** The language to open it in. */
  locale?: string;
  /**
   * The collection as the caller already holds it (a list holds its own
   * schema); read from the admin's list of collections otherwise.
   */
  collection?: OpenableCollection;
}

/** The address a link to a document opens, for the signed-in reader. */
export type DocumentAddressOf = (
  document: OpenedDocument,
  options?: OpenOptions
) => string;

/** The other ways into a document, for the signed-in reader. */
export type WaysInOf = (
  document: OpenedDocument,
  options?: OpenOptions
) => WayIn[];

/** One of the rule's readings of a document, from what the admin holds. */
type RuleReading<T> = (
  document: OpenedDocument,
  collection: OpenableCollection | undefined,
  request: OpenRequest,
  views: readonly RegisteredDocumentView[]
) => T;

/** `reading` with what it needs read from the signed-in admin. */
function useRuleReading<T>(
  reading: RuleReading<T>
): (document: OpenedDocument, options?: OpenOptions) => T {
  const { data } = useEveryNavCollection();
  const { canAccessCollection } = useCurrentUserPermissions();
  // The default language whenever the site names one, multilingual or not: on
  // a one-language site a saved row still names it, and it is the default.
  const { defaultLocale } = useLocalization();
  // The views the admin's metadata publishes, enabled plugins' only: read
  // here so a link is drawn again when they arrive.
  const { plugins } = useBranding();
  const views = useMemo(
    () => (plugins ?? []).flatMap(plugin => plugin.documentViews ?? []),
    [plugins]
  );
  const bySlug = useMemo(
    () =>
      new Map<string, OpenableCollection>(
        (data ?? []).map(collection => [collection.name, collection])
      ),
    [data]
  );
  return useCallback(
    (document, options = {}) =>
      reading(
        document,
        options.collection ?? bySlug.get(document.slug),
        {
          // A view edits the default language, whatever language the screen
          // the link is on was asked in: `update` answers for that one.
          canUpdate:
            document.kind === "collection" &&
            canAccessCollection(document.slug, "updateInDefaultLanguage"),
          ...(options.locale === undefined ? {} : { locale: options.locale }),
          ...(defaultLocale ? { defaultLocale } : {}),
        },
        views
      ),
    [reading, bySlug, canAccessCollection, defaultLocale, views]
  );
}

export function useDocumentAddress(): DocumentAddressOf {
  return useRuleReading(documentAddress);
}

/**
 * The other ways into a document a list row offers beside its own link:
 * "Edit details" where its entries open in a view, else the views it may be
 * opened in.
 */
export function useRowWaysIn(): WaysInOf {
  return useRuleReading(rowWaysIn);
}

/** The views a document open as its form may be opened in, worded by each view. */
export function useViewsToOpenIn(): WaysInOf {
  return useRuleReading(viewsToOpenIn);
}

/** The create dialog "+ New" opens on a collection, for the signed-in reader. */
export function useCreateDialogOf(): (
  document: OpenedDocument,
  options?: OpenOptions
) => string | undefined {
  return useRuleReading(createDialogOf);
}
