/**
 * Who may read the events of a document that no longer exists.
 *
 * A live document's events are read through the gate its version history uses,
 * which loads the document and asks its own rules. A deleted one has no row to
 * load, so that gate cannot answer, and the answer must never reach more people
 * than could read the document while it existed:
 *
 * - With no code-defined `access.read`, whoever holds the collection's or
 *   Single's read permission (a person, or an API key by its own scope).
 * - With `access.read: true` or `false`, that answer, as it was for the live
 *   document.
 * - With `access.read` as a function, a document-level rule: it may depend on
 *   the row, which is gone, so it cannot be evaluated. Only a caller it never
 *   limited reads: a super-admin signed in. An API key is refused, since the
 *   rule judged keys too.
 *
 * Trusted server code (`overrideAccess`) is the caller's to skip, before this.
 *
 * @module domains/content-events/deleted-document-access
 * @experimental
 */

import {
  canReadEntity,
  getRBACService,
  type ReadAccessCaller,
} from "../../auth/entity-read-access";
import { isSuperAdmin } from "../../services/lib/permissions";

/**
 * Whether this caller may read the events of the deleted document of the
 * collection or Single named `slug`.
 */
export async function mayReadDeletedDocument(
  slug: string,
  caller: ReadAccessCaller
): Promise<boolean> {
  const rule = getRBACService()?.getRegisteredAccess(slug)?.read;
  if (typeof rule === "function") {
    // The session path only: a super-admin's key is judged by its own scope,
    // which the rule limited like any other.
    return (
      caller.authMethod === "session" &&
      caller.userId !== undefined &&
      caller.userId !== null &&
      (await isSuperAdmin(caller.userId))
    );
  }
  // No rule, or a boolean one: the entity-level read decision, which composes
  // the permission, the boolean and the super-admin bypass exactly as the live
  // read did.
  return canReadEntity(slug, caller);
}
