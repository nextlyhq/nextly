/**
 * The shared "open this document" rule (`documentAddress`) with what it needs
 * read from the signed-in admin: each collection as the admin lists it, whether
 * the reader may update it, and the site's default language.
 *
 * @module lib/navigation/useDocumentAddress
 */
import { useCallback, useMemo } from "react";

import { useEveryNavCollection } from "@admin/hooks/queries/useCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useLocalization } from "@admin/hooks/useLocalization";

import {
  documentAddress,
  type OpenableCollection,
  type OpenedDocument,
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

export function useDocumentAddress(): DocumentAddressOf {
  const { data } = useEveryNavCollection();
  const { canAccessCollection } = useCurrentUserPermissions();
  const { enabled, defaultLocale } = useLocalization();
  const bySlug = useMemo(
    () =>
      new Map<string, OpenableCollection>(
        (data ?? []).map(collection => [collection.name, collection])
      ),
    [data]
  );
  return useCallback(
    (document, options = {}) =>
      documentAddress(
        document,
        options.collection ?? bySlug.get(document.slug),
        {
          canUpdate:
            document.kind === "collection" &&
            canAccessCollection(document.slug, "update"),
          ...(options.locale === undefined ? {} : { locale: options.locale }),
          ...(enabled && defaultLocale !== "" ? { defaultLocale } : {}),
        }
      ),
    [bySlug, canAccessCollection, enabled, defaultLocale]
  );
}
