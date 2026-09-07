"use client";

/**
 * Hold an advisory claim on a document while someone is editing it.
 *
 * Advisory throughout: nothing here refuses a write, and the server refuses
 * none either. What this buys is that two editors are TOLD about each other
 * rather than discovering it when one of them overwrites the other.
 *
 * ## What it does
 *
 * Claims on mount, renews on a heartbeat, releases on unmount. The heartbeat
 * interval comes from `nextly` rather than a number chosen here, because it is
 * derived from the server's lease and two copies of it drift apart the moment
 * either is tuned.
 *
 * ## Losing a claim
 *
 * A renew answers `lost` when someone took over, and it carries the new holder,
 * so the editor can be told WHO rather than only that something happened.
 * Renewal stops there: continuing to ask would either fail forever or, worse,
 * re-take a claim the visitor was just told they had lost.
 *
 * ## React Strict Mode
 *
 * Development mounts effects twice, so a naive version claims, releases, and
 * claims again, and the first cleanup can arrive after the second claim. Each
 * run therefore carries a generation, and a reply belonging to a superseded
 * one is dropped rather than written to state or released. Release is also
 * token-scoped on the server, so a stale release is a no-op there too — belt
 * and braces, since only one of the two survives a refactor of the other.
 *
 * @module hooks/queries/useDocumentLock
 */

import {
  DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS,
  type AcquireDocumentLockOutcome,
  type DocumentLockHolder,
  type DocumentScopeKind,
  type RenewDocumentLockOutcome,
} from "nextly/document-lock";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";

/** Where a claim stands from this editor's point of view. */
export type DocumentLockState =
  /** Not asked for: a new document has no id to claim. */
  | { status: "idle" }
  /** This editor holds it. */
  | { status: "held-by-me" }
  /** Someone else holds it, and can be named. */
  | { status: "held-by-other"; holder: DocumentLockHolder }
  /** This editor held it and someone took over. */
  | { status: "taken-over"; holder?: DocumentLockHolder };

export interface UseDocumentLockOptions {
  scopeKind: DocumentScopeKind;
  slug: string;
  /** Absent while a document is being created, which is nothing to claim. */
  entryId?: string | null;
  /** Off for a read-only surface: a past version is not being edited. */
  enabled?: boolean;
}

interface MutationEnvelope<T> {
  message: string;
  item: T;
}

export function useDocumentLock({
  scopeKind,
  slug,
  entryId,
  enabled = true,
}: UseDocumentLockOptions) {
  const [state, setState] = useState<DocumentLockState>({ status: "idle" });
  const claimToken = useRef<string | null>(null);
  // Bumped per effect run. A reply carrying a stale generation belongs to a
  // mount that has already been cleaned up.
  const generation = useRef(0);

  const active = enabled && Boolean(entryId);
  // Memoised on the three primitives that identify the document. Rebuilt every
  // render it would be a new object each time, so the effect below would claim,
  // release and claim again on every render rather than once per document.
  const ref = useMemo(
    () => ({ scopeKind, slug, entryId: entryId ?? "" }),
    [scopeKind, slug, entryId]
  );

  const claim = useCallback(
    async (takeover: boolean, run: number) => {
      const { item } = await protectedApi.post<
        MutationEnvelope<AcquireDocumentLockOutcome>
      >("/document-lock", { ...ref, takeover });

      if (run !== generation.current) return;

      if (item.status === "acquired") {
        claimToken.current = item.claimToken;
        setState({ status: "held-by-me" });
      } else {
        claimToken.current = null;
        setState({ status: "held-by-other", holder: item.holder });
      }
    },
    [ref]
  );

  /** Edit anyway, displacing the current holder. Their editor is told. */
  const takeOver = useCallback(() => {
    void claim(true, generation.current);
  }, [claim]);

  useEffect(() => {
    if (!active) {
      setState({ status: "idle" });
      return;
    }

    generation.current += 1;
    const run = generation.current;
    void claim(false, run);

    const heartbeat = setInterval(() => {
      if (!claimToken.current || run !== generation.current) return;
      void protectedApi
        .patch<MutationEnvelope<RenewDocumentLockOutcome>>("/document-lock", {
          ...ref,
          claimToken: claimToken.current,
        })
        .then(({ item }) => {
          if (run !== generation.current || item.status === "renewed") return;
          // Taken over. Stop renewing and say who has it: asking again would
          // either fail forever or re-take a claim just reported as lost.
          claimToken.current = null;
          setState({ status: "taken-over", holder: item.holder });
        })
        .catch(() => {
          // A failed renew is not a lost claim. The lease outlives several
          // beats, so a blip resolves itself on the next one, and treating it
          // as a takeover would move an editor to read-only for a dropped
          // packet.
        });
    }, DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(heartbeat);
      const token = claimToken.current;
      claimToken.current = null;
      if (!token) return;
      // Best effort. The claim lapses on its own, so a release that never
      // arrives costs the next editor a wait rather than access.
      void protectedApi
        .delete("/document-lock", { ...ref, claimToken: token })
        .catch(() => undefined);
    };
  }, [active, claim, ref]);

  return { state, takeOver };
}
