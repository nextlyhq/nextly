/**
 * The document-lock repository with an adapter bound to it.
 *
 * The repository is a set of functions taking a `DrizzleAdapter` first, which is
 * what lets the integration tests drive each dialect directly. Callers reached
 * through DI have exactly one adapter and no reason to pass it five times, so
 * this binds it once and is what everything outside the domain resolves.
 *
 * Advisory, and the service says so rather than leaving it to be inferred: a
 * held lock is reported to the caller and never refuses a write. Nothing here
 * consults a lock on the mutation path, so a stale claim cannot strand a
 * document, and the claim token the repository issues leaves enforcement
 * available later without changing this shape.
 *
 * @module domains/document-lock/document-lock-service
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  acquireDocumentLock,
  readDocumentLock,
  releaseDocumentLock,
  renewDocumentLock,
  sweepExpiredDocumentLocks,
  type DocumentLockClaimant,
} from "./document-lock-repository";
import type {
  AcquireDocumentLockOutcome,
  DocumentLockHolder,
  DocumentRef,
  RenewDocumentLockOutcome,
} from "./types";

export class DocumentLockService {
  constructor(private readonly adapter: DrizzleAdapter) {}

  /**
   * Who holds this document, if anyone still does.
   *
   * `undefined` for both "never claimed" and "claim has lapsed", because an
   * editor arriving at a document cannot act on the difference.
   */
  async read(ref: DocumentRef): Promise<DocumentLockHolder | undefined> {
    return await readDocumentLock(this.adapter, ref);
  }

  /**
   * Claim a document for an editor.
   *
   * `takeover` is the second editor deciding to edit anyway, which the
   * repository implements by replacing the claim rather than by deleting and
   * re-taking it, so the displaced holder's next renew reports `lost` with the
   * new holder attached and their editor can name who took over.
   */
  async acquire(
    ref: DocumentRef,
    claimant: DocumentLockClaimant,
    options?: { readonly takeover?: boolean }
  ): Promise<AcquireDocumentLockOutcome> {
    return await acquireDocumentLock(this.adapter, ref, claimant, options);
  }

  /**
   * Extend a claim this caller believes it still holds.
   *
   * Authenticated by the claim token rather than by the holder's id, so a
   * second tab belonging to the same person cannot extend the first tab's
   * claim, and a tab whose claim was taken over is told rather than silently
   * renewed.
   */
  async renew(
    ref: DocumentRef,
    claimToken: string
  ): Promise<RenewDocumentLockOutcome> {
    return await renewDocumentLock(this.adapter, ref, claimToken);
  }

  /** Give up a claim. Releasing one already lost is not an error. */
  async release(ref: DocumentRef, claimToken: string): Promise<void> {
    await releaseDocumentLock(this.adapter, ref, claimToken);
  }

  /**
   * Delete lapsed rows.
   *
   * Expiry is decided by the timestamp on read, so nothing depends on this
   * having run; it keeps the table from growing without bound over a long
   * uptime. That makes it safe to call on any schedule, or not at all.
   */
  async sweepExpired(): Promise<void> {
    await sweepExpiredDocumentLocks(this.adapter);
  }
}
