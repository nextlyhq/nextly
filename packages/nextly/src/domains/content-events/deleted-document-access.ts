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
 * - The same where hooks may narrow its reads (`beforeOperation`,
 *   `beforeRead` or `afterRead`, its own or the site's): a tenant filter in a
 *   hook is a document-level rule by another name, and it too needs the row.
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
import { getHookRegistry } from "../../hooks/hook-registry";
import { isSuperAdmin } from "../../services/lib/permissions";

/** The hooks that may narrow which documents a caller reads. */
const READ_NARROWING_HOOKS = [
  "beforeOperation",
  "beforeRead",
  "afterRead",
] as const;

/** Whether any hook may narrow reads of `slug`, so a deleted row's answer is unknown. */
function hooksMayNarrowReads(slug: string): boolean {
  const registry = getHookRegistry();
  return READ_NARROWING_HOOKS.some(hook => registry.hasHooks(hook, slug));
}

/**
 * Whether this caller may read the events of the deleted document of the
 * collection or Single named `slug`.
 */
export async function mayReadDeletedDocument(
  slug: string,
  caller: ReadAccessCaller
): Promise<boolean> {
  const rule = getRBACService()?.getRegisteredAccess(slug)?.read;
  if (typeof rule === "function" || hooksMayNarrowReads(slug)) {
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
