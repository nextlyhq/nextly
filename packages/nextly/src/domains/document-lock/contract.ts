/**
 * What a client needs to hold a lock, and nothing else.
 *
 * A narrow module on purpose. The admin maps `nextly` to this package's SOURCE,
 * so importing the root entry to reach two constants pulls the whole server
 * graph into its typecheck — the DI container, the auth middleware and every
 * `@nextly/*` alias the admin does not define. Measured: 112 errors, none of
 * them about the importing code.
 *
 * The timings are RE-EXPORTED rather than restated. They are the contract
 * between a lease and whoever renews it, and a second copy of either number
 * drifts from the first the moment one is tuned.
 *
 * @module domains/document-lock/contract
 */

export {
  DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS,
  DOCUMENT_LOCK_LOSS_AFTER_MS,
  DOCUMENT_LOCK_TTL_SECONDS,
} from "./timings";
export type { DocumentScopeKind } from "./lock-key";
export type {
  AcquireDocumentLockOutcome,
  DocumentLockHolder,
  DocumentRef,
  RenewDocumentLockOutcome,
} from "./types";
