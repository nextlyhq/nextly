"use client";

/**
 * Who holds a document, for a user who may read it and not claim it.
 *
 * A reader is never handed a claim (the server refuses one without update),
 * so {@link useDocumentLock} tells them nothing. A reader who may publish still
 * writes the document's status, and a colleague mid-edit is what holds that
 * write back: this reads the holder on the claim's own beat, and never claims.
 *
 * @module hooks/queries/useDocumentLockHolder
 */

import {
  DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS,
  type DocumentLockHolder,
  type DocumentScopeKind,
} from "nextly/document-lock";
import { useEffect, useState } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";

export interface UseDocumentLockHolderOptions {
  scopeKind: DocumentScopeKind;
  slug: string;
  /** Absent while a document is being created, which nobody holds. */
  entryId?: string | null;
  /** Off where the holder is not asked about, as for a user who claims. */
  enabled?: boolean;
}

/**
 * The document's holder: `null` when nobody holds it, or while off;
 * `undefined` until the first read answers. A read that fails keeps the last
 * answer, so a colleague is not forgotten over one lost request, and a first
 * read that fails leaves the holder unknown rather than reporting nobody.
 */
export function useDocumentLockHolder({
  scopeKind,
  slug,
  entryId,
  enabled = true,
}: UseDocumentLockHolderOptions): DocumentLockHolder | null | undefined {
  const active = enabled && Boolean(entryId);
  const [holder, setHolder] = useState<DocumentLockHolder | null | undefined>(
    undefined
  );

  useEffect(() => {
    if (!active || !entryId) return;
    let stopped = false;
    // A new document is unknown until its own first read answers.
    setHolder(undefined);
    const query = new URLSearchParams({ scopeKind, slug, entryId }).toString();
    const read = async (): Promise<void> => {
      try {
        const answer = await protectedApi.get<{
          holder: DocumentLockHolder | null;
        }>(`/document-lock?${query}`);
        if (!stopped) setHolder(answer.holder);
      } catch {
        // The last answer stands until a read says otherwise.
      }
    };
    void read();
    const beat = setInterval(() => {
      void read();
    }, DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(beat);
    };
  }, [active, scopeKind, slug, entryId]);

  return active ? holder : null;
}
