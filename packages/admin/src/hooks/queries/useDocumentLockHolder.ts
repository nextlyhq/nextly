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
 * `undefined` until the first read answers, and while a read is still out at
 * the next beat. A read that fails keeps a colleague the last read named, so
 * they are not forgotten over one lost request, and makes "nobody" unknown,
 * since it cannot confirm it.
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
    /** `undefined` while a read is overdue. */
    holder: DocumentLockHolder | null | undefined;
  } | null>(null);

  useEffect(() => {
    if (!active || !entryId || documentKey === null) return;
    let stopped = false;
    // One read at a time: two in flight could reach the server in either
    // order, and the one that read the lock first could answer last. A beat
    // that finds the last read still out does not send another; it makes the
    // holder unknown until that read answers, so a lagging read never leaves
    // an old "nobody" standing.
    let reading = false;
    const query = new URLSearchParams({ scopeKind, slug, entryId }).toString();
    const read = async (): Promise<void> => {
      reading = true;
      try {
        const reply = await protectedApi.get<{
          holder: DocumentLockHolder | null;
        }>(`/document-lock?${query}`);
        if (!stopped) setAnswer({ documentKey, holder: reply.holder });
      } catch {
        // A colleague the last read named still holds it as far as this
        // knows, so that answer stands. "Nobody" does not: a colleague may
        // have claimed it since, so it is unknown until a read confirms it.
        if (!stopped) {
          setAnswer(last =>
            last?.documentKey === documentKey && last.holder === null
              ? { documentKey, holder: undefined }
              : last
          );
        }
      } finally {
        reading = false;
      }
    };
    void read();
    const beat = setInterval(() => {
      if (reading) {
        setAnswer({ documentKey, holder: undefined });
        return;
      }
      void read();
    }, DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(beat);
      // Turned back on, or on another document, the holder is unknown until
      // a read of that run answers.
      setAnswer(null);
    };
  }, [active, documentKey, scopeKind, slug, entryId]);

  if (!active) return null;
  // Another document is unknown until its own first read answers, from the
  // very render that names it.
  return answer?.documentKey === documentKey ? answer.holder : undefined;
}
