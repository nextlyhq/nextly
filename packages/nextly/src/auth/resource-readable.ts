/**
 * Read authorization for the system resources that have no stored rules.
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
import type { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";

import {
  apiKeyScopeAllows,
  type AuthenticatedScope,
} from "./authenticated-scope";

/**
 * Whether a caller may read a system resource such as `media` or `users`.
 *
 * A scoped API key is judged on its OWN `read-<resource>` grant and never on
 * its owner's roles, so a narrowly scoped key belonging to a super-admin cannot
 * read a resource its scope excludes. A session or system caller (`null` scope)
 * falls through to the role-based RBAC check.
 *
 * Answers `false` when there is no caller to hold a grant, and when the RBAC
 * service is not registered to answer at all. A boot may legitimately omit it,
 * and a grant that cannot be checked is not a grant that was given: the callers
 * above use this to decide whether to WIDEN what they return, so the
 * unauthorized answer is the one that keeps an unanswerable question from
 * widening anything.
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
  const scopeAllows = apiKeyScopeAllows(authenticatedScope, "read", resource);
  if (scopeAllows !== null) return scopeAllows;
  if (userId === undefined) return false;

  // Resolved from the container rather than through `getService`, which lives
  // in the module that registers every service: importing it from here would
  // pull the whole service graph into anything that reads a media row.
  if (!container.has("rbacAccessControlService")) return false;
  const rbac = container.get<RBACAccessControlService>(
    "rbacAccessControlService"
  );
  return rbac.checkAccess({
    userId,
    operation: "read",
    resource,
  });
}
