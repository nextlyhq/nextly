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

import { deviate } from "./access/deviations";
import {
  actorForKey,
  actorForScope,
  actorForUser,
  actorForVisitor,
} from "./access/resolve-actor";
import { readsSystemResource } from "./access/system-resource-read";
import {
  apiKeyScopeAllows,
  scopeRowsAgree,
  type AuthenticatedScope,
} from "./authenticated-scope";

/**
 * Whether a caller may read a system resource such as `media` or `users`,
 * answered by the one access decision.
 *
 * The caller becomes an actor: a scoped API key from its OWN scope, never its
 * owner's roles, so a narrowly scoped key belonging to a super-admin cannot
 * read a resource its scope excludes; a caller with no id a visitor, who holds
 * no grant; anyone else the signed-in user, whose grant decides and whose
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
    if (scopeRowsAgree(authenticatedScope)) {
      return readsSystemResource(actorForScope(authenticatedScope, user), read);
    }
    // Judged on the stored slugs, as before: a scope without the rows its
    // slugs came from holds no grant the decision can read.
    const today =
      apiKeyScopeAllows(authenticatedScope, "read", resource) === true;
    return deviate("key-slug-string-match", today, () =>
      readsSystemResource(
        actorForKey({
          keyId: "",
          userId: user.id,
          grants: authenticatedScope.grants ?? [],
          roles: authenticatedScope.roles ?? [],
        }),
        read
      )
    );
  }
  if (userId === undefined) return readsSystemResource(actorForVisitor(), read);
  return readsSystemResource(await actorForUser(userId), read);
}
