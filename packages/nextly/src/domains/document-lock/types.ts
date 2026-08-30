/**
 * What a document lock is, and the answers asking for one can produce.
 *
 * @module domains/document-lock/types
 */

/** The document a claim is about. */
export interface DocumentRef {
  readonly collection: string;
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
 */
export type AcquireDocumentLockOutcome =
  | { readonly status: "acquired"; readonly holder: DocumentLockHolder }
  | { readonly status: "held"; readonly holder: DocumentLockHolder };

/**
 * The outcome of confirming a claim you believe you hold.
 *
 * `lost` carries the current holder when there is one, so an editor can say who
 * took over rather than only that something did. It is absent when the claim
 * simply lapsed and nobody has taken it — the distinction decides whether the
 * interface offers "request access" or "resume editing".
 */
export type RenewDocumentLockOutcome =
  | { readonly status: "renewed"; readonly holder: DocumentLockHolder }
  | { readonly status: "lost"; readonly holder?: DocumentLockHolder };
