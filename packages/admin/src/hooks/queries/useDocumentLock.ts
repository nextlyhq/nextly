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
 * Claims on mount, confirms on a heartbeat, releases on the way out. The
 * heartbeat interval and the loss deadline both come from `nextly` rather than
 * numbers chosen here, because they are derived from the server's lease and a
 * second copy drifts the moment either is tuned.
 *
 * ## One claim, owned by one effect
 *
 * Every mutable thing about a claim — the token, when it was last confirmed,
 * whether a request is in flight, and whether the editor is still mounted —
 * lives in the effect that created it, not in a ref shared across runs. That is
 * what makes the awkward cases fall out rather than needing to be handled one at
 * a time: a reply belonging to a superseded run closes over a `cancelled` that is
 * already true, and a reply belonging to a superseded CLAIM closes over a token
 * that no longer matches. React Strict Mode's double mount, a document switch
 * and an unmount are then the same case rather than three.
 *
 * ## Every reply is fenced on the token that produced it
 *
 * 🔴 Not on the effect run. A takeover replaces the token WITHIN a run, so two
 * heartbeats can overlap across it: a `lost` answer belonging to the token that
 * was displaced would otherwise clear the claim the takeover just won, telling
 * an editor who holds the document that they do not.
 *
 * ## One acquire at a time
 *
 * 🔴 A second acquire cannot start while one is pending. The server treats a
 * live claim from the SAME owner as takeable, so a duplicate acquire mints a
 * fresh token and invalidates the one still in flight; whichever reply lands
 * second wins, and the editor can be left holding a token the server has already
 * replaced — renewing into a takeover that names the editor themselves.
 *
 * ## The beat outlives the claim
 *
 * 🔴 The interval is cleared by cleanup and by nothing else. An editor who takes
 * the document back needs it still running: stopping it on a loss and trusting
 * the next acquire to start another hands them a claim nothing renews, which
 * expires silently one lease later. Losing the claim sets a flag the beat reads,
 * and taking over clears it.
 *
 * ## A failed confirmation is a blip until the deadline, then it is a loss
 *
 * The lease outlives several beats, so one dropped packet resolves itself on the
 * next one, and treating it as a takeover would move an editor to read-only over
 * nothing. 🔴 But silence is not proof of possession either: past
 * `DOCUMENT_LOCK_LOSS_AFTER_MS` without a CONFIRMED reply the lease has expired
 * server-side and a colleague may already hold the row.
 *
 * 🔴 That deadline is judged at the top of every beat rather than where a request
 * rejects. A stalled connection never rejects at all, so a check that lived only
 * in the failure path would let an editor keep writing against a lease that ran
 * out minutes ago. The deadline leaves two intervals of lease in hand, so it
 * lands while the editor is still protected.
 *
 * @module hooks/queries/useDocumentLock
 */

import {
  DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS,
  DOCUMENT_LOCK_LOSS_AFTER_MS,
  type AcquireDocumentLockOutcome,
  type DocumentLockHolder,
  type DocumentScopeKind,
  type RenewDocumentLockOutcome,
} from "nextly/document-lock";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { MutationResponse } from "@admin/lib/api/response-types";

/** Where a claim stands from this editor's point of view. */
export type DocumentLockState =
  /** Not asked for: a new document has no id to claim. */
  | { status: "idle" }
  /** Asked for, no answer yet. */
  | { status: "acquiring" }
  /** This editor holds it. */
  | { status: "held-by-me" }
  /** Someone else holds it, and can be named. */
  | { status: "held-by-other"; holder: DocumentLockHolder }
  /**
   * This editor held it and the server said someone took over. The holder is
   * absent when the claim simply lapsed and nobody took it, which is what
   * decides whether the interface offers to resume or to ask.
   */
  | { status: "taken-over"; holder?: DocumentLockHolder }
  /**
   * This editor held it and could not confirm that for a whole lease.
   *
   * Distinct from `taken-over`, which the server reported. Nobody has said this
   * claim is gone; the point is that nobody can say it is still there, and the
   * lease it rested on has run out.
   */
  | { status: "lost" }
  /** The claim could not be asked for at all. Retried on the next beat. */
  | { status: "unavailable" };

export interface UseDocumentLockOptions {
  scopeKind: DocumentScopeKind;
  slug: string;
  /** Absent while a document is being created, which is nothing to claim. */
  entryId?: string | null;
  /** Off for a read-only surface: a past version is not being edited. */
  enabled?: boolean;
}

/** Whether two holder readings say the same thing, so a poll can stay quiet. */
function sameHolder(a: DocumentLockHolder, b: DocumentLockHolder): boolean {
  return (
    a.ownerId === b.ownerId &&
    a.ownerLabel === b.ownerLabel &&
    a.expiresInSeconds === b.expiresInSeconds
  );
}

export function useDocumentLock({
  scopeKind,
  slug,
  entryId,
  enabled = true,
}: UseDocumentLockOptions) {
  const [state, setState] = useState<DocumentLockState>({ status: "idle" });

  // Published by the running effect, which is the only thing that may touch a
  // claim. A stable callback delegating through it keeps the consumer's
  // reference identity while the claim state stays inside one closure.
  const takeOverRef = useRef<() => void>(() => {});
  const takeOver = useCallback(() => takeOverRef.current(), []);

  const active = enabled && Boolean(entryId);
  // Memoised on the three primitives that identify the document. Rebuilt every
  // render it would be a new object each time, so the effect below would claim,
  // release and claim again on every render rather than once per document.
  const ref = useMemo(
    () => ({ scopeKind, slug, entryId: entryId ?? "" }),
    [scopeKind, slug, entryId]
  );

  useEffect(() => {
    if (!active) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    let token: string | null = null;
    let confirmedAt = Date.now();
    let holder: DocumentLockHolder | null = null;
    let acquiring = false;
    // A person pressing "take over" while a poll is mid-flight must not lose the
    // click. Serialising without this turns their decision into silence, and the
    // poll that displaced it only ever asks politely.
    let queuedTakeover = false;
    // Set when this editor stops being a contender: displaced by the server, or
    // past its own deadline. The beat then waits for the person rather than
    // re-taking a claim they were just told they had lost.
    let surrendered = false;

    // 🔴 Reset before asking. The document may have changed under a mounted
    // editor, and leaving the previous one's answer on screen would name an
    // unrelated holder — or say this editor holds a document it has not claimed.
    setState({ status: "acquiring" });

    // Best effort. The claim lapses on its own, so a release that never arrives
    // costs the next editor a wait rather than access.
    const release = (claimToken: string) =>
      void protectedApi
        .delete("/document-lock", { ...ref, claimToken })
        .catch(() => undefined);

    const acquire = async (takeover: boolean) => {
      if (acquiring) {
        if (takeover) queuedTakeover = true;
        return;
      }
      acquiring = true;
      let item: AcquireDocumentLockOutcome;
      try {
        ({ item } = await protectedApi.post<
          MutationResponse<AcquireDocumentLockOutcome>
        >("/document-lock", { ...ref, takeover }));
      } catch {
        // 🔴 Reported, not swallowed. A rejected acquire leaves no token, and
        // every later beat would exit at its token guard, so an editor would
        // spend the whole session silently unprotected. The beat retries.
        acquiring = false;
        if (!cancelled) setState({ status: "unavailable" });
        drainQueuedTakeover();
        return;
      }
      acquiring = false;

      drainQueuedTakeover();

      if (cancelled) {
        // 🔴 The claim outlived the editor that asked for it: this reply landed
        // after cleanup, which found no token to release. Releasing it here is
        // the difference between a colleague waiting one request and waiting a
        // whole lease.
        if (item.status === "acquired") release(item.claimToken);
        return;
      }

      if (item.status === "acquired") {
        token = item.claimToken;
        confirmedAt = Date.now();
        holder = null;
        surrendered = false;
        setState({ status: "held-by-me" });
        return;
      }

      token = null;
      // Quiet when nothing changed: this runs every beat while a colleague
      // holds the document, and a fresh object each time re-renders the editor
      // for no news.
      if (holder === null || !sameHolder(holder, item.holder)) {
        holder = item.holder;
        setState({ status: "held-by-other", holder: item.holder });
      }
    };

    /** Run a take-over that arrived while another request held the slot. */
    const drainQueuedTakeover = () => {
      if (!queuedTakeover || cancelled) return;
      queuedTakeover = false;
      void acquire(true);
    };

    /** Give the claim up locally, without asking the server for anything. */
    const surrender = (next: DocumentLockState) => {
      token = null;
      surrendered = true;
      setState(next);
    };

    takeOverRef.current = () => void acquire(true);
    void acquire(false);

    const heartbeat = setInterval(() => {
      if (cancelled) return;

      // 🔴 Judged before anything is sent, so a request that never settles
      // cannot hold the claim open past the lease it rests on.
      if (
        token !== null &&
        Date.now() - confirmedAt >= DOCUMENT_LOCK_LOSS_AFTER_MS
      ) {
        surrender({ status: "lost" });
        return;
      }

      // Displaced, or past the deadline. The person decides what happens next.
      if (surrendered) return;

      if (token === null) {
        // Nothing to confirm. Either a colleague holds it — and asking again is
        // how this editor learns they have left, since a plain acquire never
        // steals a live claim — or the last attempt failed and this is the
        // retry. `acquire` refuses to overlap with one already in flight.
        void acquire(false);
        return;
      }

      const sent = token;
      void protectedApi
        .patch<MutationResponse<RenewDocumentLockOutcome>>("/document-lock", {
          ...ref,
          claimToken: sent,
        })
        .then(({ item }) => {
          if (cancelled || sent !== token) return;
          if (item.status === "renewed") {
            confirmedAt = Date.now();
            return;
          }
          surrender({ status: "taken-over", holder: item.holder });
        })
        .catch(() => {
          // A blip. The deadline above decides when it stops being one.
        });
    }, DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      takeOverRef.current = () => {};
      clearInterval(heartbeat);
      if (token !== null) release(token);
    };
  }, [active, ref]);

  return { state, takeOver };
}
