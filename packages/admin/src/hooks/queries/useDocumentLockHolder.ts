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
  // Names the document, so an answer about one is never read as another's.
  const documentKey = active ? `${scopeKind}:${slug}:${entryId}` : null;
  const [answer, setAnswer] = useState<{
    documentKey: string;
    holder: DocumentLockHolder | null;
  } | null>(null);

  useEffect(() => {
    if (!active || !entryId || documentKey === null) return;
    let stopped = false;
    // Each read is numbered as it is sent, and an answer lands only when no
    // newer read's answer has: a slow read that returns after a newer one says
    // what was true before it, and would hand back a write a colleague's
    // later claim holds.
    let sent = 0;
    let landed = 0;
    const query = new URLSearchParams({ scopeKind, slug, entryId }).toString();
    const read = async (): Promise<void> => {
      sent += 1;
      const number = sent;
      try {
        const reply = await protectedApi.get<{
          holder: DocumentLockHolder | null;
        }>(`/document-lock?${query}`);
        if (stopped || number < landed) return;
        landed = number;
        setAnswer({ documentKey, holder: reply.holder });
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
  }, [active, documentKey, scopeKind, slug, entryId]);

  if (!active) return null;
  // Another document is unknown until its own first read answers, from the
  // very render that names it.
  return answer?.documentKey === documentKey ? answer.holder : undefined;
}
