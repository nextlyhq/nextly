/**
 * DI registration for advisory document locking.
 *
 * @module di/registrations/register-document-lock
 */

import { DocumentLockService } from "../../domains/document-lock";
import { container } from "../container";

import type { RegistrationContext } from "./types";

/** Register the document-lock service as a singleton. */
export function registerDocumentLockServices(ctx: RegistrationContext): void {
  const { adapter } = ctx;

  container.registerSingleton<DocumentLockService>(
    "documentLockService",
    // Locks are read and written on the pool. They are deliberately outside any
    // caller's transaction: a claim taken inside a write that later rolls back
    // would vanish with it, and the point of the claim is that it outlives the
    // request that took it.
    () => new DocumentLockService(adapter)
  );
}
