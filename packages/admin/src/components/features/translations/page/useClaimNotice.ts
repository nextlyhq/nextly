"use client";

/**
 * What the page says while someone else has the document open to edit. Only
 * says it: writing one language claims nothing, and a translator and an editor
 * may work at once, each save refused where it would pass over the other's.
 *
 * @module components/features/translations/page/useClaimNotice
 */

import {
  readerAffordances,
  type DocumentLockNotice,
} from "@admin/components/features/entries/EntryForm/document-lock-affordances";
import { useDocumentLockHolder } from "@admin/hooks/queries/useDocumentLockHolder";
import { useCurrentUserId } from "@admin/hooks/useCurrentUserId";
import type { TranslatedDocument } from "@admin/lib/navigation/translation-address";

/** The notice, or null where nobody else holds the document, as far as known. */
export function useClaimNotice(
  document: TranslatedDocument,
  documentId: string
): DocumentLockNotice | null {
  const holder = useDocumentLockHolder({
    scopeKind: document.kind,
    slug: document.slug,
    entryId: documentId,
  });
  const me = useCurrentUserId();
  // Their own claim, in another tab, is not someone else's; and until it is
  // known who they are, nobody is named.
  if (!holder || me === null || holder.ownerId === me) return null;
  return readerAffordances(holder).notice;
}
