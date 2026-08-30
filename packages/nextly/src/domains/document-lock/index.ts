/**
 * Document soft lock — who is editing what, and for how much longer.
 *
 * @module domains/document-lock
 */

export {
  acquireDocumentLock,
  readDocumentLock,
  releaseDocumentLock,
  renewDocumentLock,
  type DocumentLockClaimant,
} from "./document-lock-repository";
export {
  DOCUMENT_LOCK_KEY_SEPARATOR,
  MAX_DOCUMENT_LOCK_KEY_LENGTH,
  documentLockKey,
} from "./lock-key";
export {
  DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS,
  DOCUMENT_LOCK_LOSS_AFTER_MS,
  DOCUMENT_LOCK_RENEW_MARGIN_SECONDS,
  DOCUMENT_LOCK_TTL_SECONDS,
} from "./timings";
export type {
  AcquireDocumentLockOutcome,
  DocumentLockHolder,
  DocumentRef,
  RenewDocumentLockOutcome,
} from "./types";
