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
 * - Where hooks may narrow its reads (`beforeOperation`, `beforeRead` or
 *   `afterRead`, its own or the site's), no caller reads: a hook runs for
 *   super-admins too, and it needs the row to answer.
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
import { singleHookNamespace } from "../../hooks/register-single-hooks";
import { isSuperAdmin } from "../../services/lib/permissions";

/** The hooks that may narrow which documents a caller reads. */
const READ_NARROWING_HOOKS = [
  "beforeOperation",
  "beforeRead",
  "afterRead",
] as const;

/** The collection or Single a deleted document belonged to. */
export interface DeletedDocumentOwner {
  kind: "collection" | "single";
  slug: string;
}

/**
 * Whether any hook may narrow reads of the owner's documents, so a deleted
 * row's answer is unknown. A Single's hooks are registered, and looked up by
 * its reads, under its own namespace rather than its bare slug, so they are
 * asked for there.
 */
function hooksMayNarrowReads(owner: DeletedDocumentOwner): boolean {
  const registry = getHookRegistry();
  const key =
    owner.kind === "single" ? singleHookNamespace(owner.slug) : owner.slug;
  return READ_NARROWING_HOOKS.some(hook => registry.hasHooks(hook, key));
}

/**
 * Whether this caller may read the events of a deleted document of this
 * collection or Single.
 */
export async function mayReadDeletedDocument(
  owner: DeletedDocumentOwner,
  caller: ReadAccessCaller
): Promise<boolean> {
  const { slug } = owner;
  // A hook runs for every caller, super-admins included: their bypass is of
  // rules, not hooks. It needs the row, which is gone, so no caller can be
  // shown to have passed it, and the history stays closed to all of them.
  if (hooksMayNarrowReads(owner)) return false;
  const rule = getRBACService()?.getRegisteredAccess(slug)?.read;
  if (typeof rule === "function") {
    // Only super-admin authority passes a rule that needs the row: a
    // super-admin's session, or a full-access key carrying its maker's
    // authority, as authentication found it. Any other key is judged by its
    // own scope, which the rule limits like any other.
    if (caller.authMethod === "api-key") {
      return caller.keyHoldsSuperAdmin === true;
    }
    return (
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
