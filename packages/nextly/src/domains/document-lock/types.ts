/**
 * What a document lock is, and the answers asking for one can produce.
 *
 * @module domains/document-lock/types
 */

import type { DocumentScopeKind } from "./lock-key";

/** The document a claim is about. */
export interface DocumentRef {
  /** Whether this is a collection entry or a Single. Part of the identity. */
  readonly scopeKind: DocumentScopeKind;
  readonly slug: string;
  readonly entryId: string;
}

/** Who holds a claim, and how much of it is left. */
export interface DocumentLockHolder {
  readonly ownerId: string;
  /** The holder's display name as it was when the claim was taken. */
  readonly ownerLabel: string | null;
  /**
   * Seconds until the claim lapses. Negative once it has, which a reader should
   * treat as expired rather than clamp — "gone 40 seconds ago" and "not yet" are
   * different facts and only one of them is zero.
   */
  readonly expiresInSeconds: number;
}

/**
 * The outcome of asking to edit a document.
 *
 * A discriminated result rather than a thrown error, because "somebody else is
 * editing this" is an ordinary answer the interface has to RENDER — with a name
 * and a countdown in it — not an exception. The HTTP layer turns `held` into a
 * 409 carrying the same holder; a thrown error would have to smuggle that
 * through log context, which is not public.
 *
 * 🔴 `claimToken` is returned ONLY on success, and only to the caller that
 * succeeded. It identifies this acquisition, and every later heartbeat and
 * release must present it. Handing it out with a `held` refusal would let the
 * refused caller act on somebody else's claim.
 */
export type AcquireDocumentLockOutcome =
  | {
      readonly status: "acquired";
      readonly holder: DocumentLockHolder;
      readonly claimToken: string;
    }
  | {
      readonly status: "held";
      readonly holder: DocumentLockHolder;
      /**
       * Whether an unlapsed request to edit this document is on record.
       *
       * The same fact `renewed` carries, read from the other side: here it is
       * how a refused editor learns its own ask was written down, and there it
       * is how the holder learns somebody is waiting. Deliberately not "your
       * request was accepted" — nothing accepts one, and nothing about it moves
       * the document.
       *
       * A caller that did not ask still gets an honest answer, which is that
       * somebody is waiting. It is the interface that knows whether the person
       * in front of it is that somebody.
       */
      readonly waiting: boolean;
    };

/**
 * The outcome of confirming a claim you believe you hold.
 *
 * `lost` carries the current holder when there is one, so an editor can say who
 * took over rather than only that something did. It is absent when the claim
 * simply lapsed and nobody has taken it — the distinction decides whether the
 * interface offers "request access" or "resume editing".
 *
 * `renewed` is also the channel the holder learns about a colleague on. The
 * heartbeat is the one call a holder already makes on an interval, so a
 * courtesy notice that rides it needs no second transport, no second poll and
 * no push channel — and it arrives at the cadence a person can act on rather
 * than the cadence a countdown ticks at.
 */
export type RenewDocumentLockOutcome =
  | {
      readonly status: "renewed";
      readonly holder: DocumentLockHolder;
      /**
       * Whether somebody is waiting to edit this document.
       *
       * A courtesy, and nothing more: it does not shorten the lease, does not
       * ask the holder to answer, and is not a step in any handover. The lease
       * expiring remains the only thing that transfers the document.
       *
       * False again once the request lapses, because the editor that made it
       * re-states it on its own beat. So a holder is never told about somebody
       * who has already gone.
       */
      readonly waiting: boolean;
    }
  | { readonly status: "lost"; readonly holder?: DocumentLockHolder };
