/**
 * Read authorization for the system resources that have no collection config.
 *
 * `media` and `users` are system tables rather than dynamic collections, so
 * their readers (`mediaService.findById`, `userService.listUsersByIds`, and the
 * relationship service's own media and system-entity fetches) bypass `getEntry`
 * and perform no authorization of their own. This is the ONE gate those readers
 * share, so the rule lives in a single place rather than being re-derived per
 * caller.
 *
 * @module auth/resource-readable
 */

import { container } from "../di/container";

import { holdsPermission } from "./access/actor";
import { decidePermission } from "./access/decide";
import { deviate } from "./access/deviations";
import {
  actorForKey,
  actorForScope,
  actorForUserFailingClosed,
  actorForVisitor,
  actorForVisitorFailingClosed,
} from "./access/resolve-actor";
import { readsSystemResource } from "./access/system-resource-read";
import {
  apiKeyScopeAllows,
  scopeRowsAgree,
  slugGrants,
  type AuthenticatedScope,
} from "./authenticated-scope";

/**
 * Whether a caller may read a system resource such as `media` or `users`,
 * answered by the one access decision.
 *
 * The caller becomes an actor: a scoped API key from its OWN scope, never its
 * owner's roles, so a narrowly scoped key belonging to a super-admin cannot
 * read a resource its scope excludes; a caller with no id a visitor, who holds
 * the Public role's grants; anyone else the signed-in user, whose grant decides and whose
 * super-admin authority passes. A system resource declares no code rule, so
 * the permission is the whole decision.
 *
 * Without the RBAC service a signed-in user is refused, as before: a boot may
 * legitimately omit it, and the callers above use this to decide whether to
 * WIDEN what they return, so the unauthorized answer is the one that keeps an
 * unanswerable question from widening anything.
 *
 * @param resource - Resource name as it appears in a permission slug (`media`).
 * @param userId - Caller's user id, or undefined for an anonymous read.
 * @param authenticatedScope - Present when the caller is a scoped API key.
 */
export async function canReadSystemResource(
  resource: string,
  userId: string | undefined,
  authenticatedScope?: AuthenticatedScope
): Promise<boolean> {
  // Resolved from the container rather than through `getService`, which lives
  // in the module that registers every service: importing it from here would
  // pull the whole service graph into anything that reads a media row.
  const read = {
    resource,
    serviceRegistered: container.has("rbacAccessControlService"),
  };
  if (authenticatedScope?.actorType === "apiKey") {
    const user = { id: userId ?? "" };
    const rows = scopeRowsAgree(authenticatedScope);
    const actor = rows
      ? actorForScope(authenticatedScope, user)
      : // A scope without rows is compared with the grants its slugs name,
        // which is what the decision would judge if it could read them.
        actorForKey({
          keyId: "",
          userId: user.id,
          grants: slugGrants(authenticatedScope.permissions),
          roles: authenticatedScope.roles ?? [],
        });
    // A key holds the read by its stored slug, `read-<resource>`. The
    // decision reads a grant's action and resource, which agree with the slug
    // unless the scope carries no rows or the grant was stored under a slug of
    // its own; then the stored slug answers, as before.
    const today =
      apiKeyScopeAllows(authenticatedScope, "read", resource) === true;
    if (!rows || today !== holdsPermission(actor, "read", resource)) {
      return deviate("key-slug-string-match", today, () =>
        readsSystemResource(actor, read)
      );
    }
    return readsSystemResource(actor, read);
  }
  // A visitor holds the Public role's grants; one that could not be read
  // refuses, as a user's failed lookup does below.
  if (userId === undefined) {
    return readsSystemResource(await actorForVisitorFailingClosed(), read);
  }
  if (!read.serviceRegistered) {
    // Without the service a signed-in user is refused whatever they hold, as
    // before, so nothing is looked up to say so. The decision it is compared
    // with is the one the service's presence would give.
    return deviate(
      "no-service",
      false,
      async () =>
        decidePermission(
          await actorForUserFailingClosed(userId),
          "read",
          resource
        ).allowed
    );
  }
  // Each lookup that fails refuses only what it would have given, so a
  // relationship withholds the row and the read goes on rather than failing.
  return readsSystemResource(await actorForUserFailingClosed(userId), read);
}

/**
 * Whether a visitor may read a system resource at a door that serves it: a
 * REST route or a checked Direct API read naming nobody. The one decision with
 * the Public role's grants, as {@link canReadSystemResource} answers a caller
 * with no id, except that grants which could not be read fail the request
 * rather than refuse it, as a door's own lookups do: a refusal there would
 * tell a visitor to sign in for a fault of the server's.
 *
 * @param resource - Resource name as it appears in a permission slug (`media`).
 */
export async function visitorReadsSystemResource(
  resource: string
): Promise<boolean> {
  return readsSystemResource(await actorForVisitor(), {
    resource,
    serviceRegistered: container.has("rbacAccessControlService"),
  });
}
