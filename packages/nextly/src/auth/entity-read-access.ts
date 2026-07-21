/**
 * Whether a caller may read an entity, decided without a `Request`.
 *
 * `requireCollectionAccess` is the canonical answer, but it reads the incoming
 * request to authenticate, so a dispatcher handler — which only receives the
 * resolved identity — cannot call it. Anything needing the decision after
 * dispatch previously had to approximate it, and the approximations were more
 * permissive than the original.
 *
 * This module holds the decision itself, so both entry points share one rule
 * rather than two that drift.
 *
 * @module auth/entity-read-access
 */

import { container } from "../di/container";
import type { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";
import type {
  AccessControlContext,
  CollectionAccessControl,
  SingleAccessControl,
} from "../shared/types/access";

/**
 * The resolved identity a read decision needs.
 *
 * `permissions` are the API key's OWN scoped grants in `{action}-{resource}`
 * form. Note the format: `listEffectivePermissions` returns the other one
 * (`{resource}:{action}`), and mixing them silently answers "denied" for every
 * check. Session callers carry an empty list — their grants are resolved from
 * the database instead.
 */
export interface ReadAccessCaller {
  userId: string;
  authMethod: "session" | "api-key";
  permissions: string[];
  /** Role slugs, already normalized (session roles arrive as ids). */
  roles: string[];
}

/** The RBAC service, or undefined before the container is initialized. */
function getRBACService(): RBACAccessControlService | undefined {
  try {
    if (container.has("rbacAccessControlService")) {
      return container.get<RBACAccessControlService>(
        "rbacAccessControlService"
      );
    }
  } catch {
    // DI container not initialized yet — the caller decides how to fall back.
  }
  return undefined;
}

/**
 * Evaluate a code-defined access rule.
 *
 * An absent rule allows: the permission check that precedes this one is what
 * grants access, and a rule that says nothing about an operation does not
 * revoke it. A rule that throws denies, so a broken rule fails closed.
 */
export async function codeAccessAllows(
  codeAccess: CollectionAccessControl | SingleAccessControl,
  operation: "create" | "read" | "update" | "delete",
  resource: string,
  caller: ReadAccessCaller
): Promise<boolean> {
  const operationAccess =
    codeAccess[
      operation as keyof (CollectionAccessControl | SingleAccessControl)
    ];

  if (operationAccess === undefined) return true;
  if (typeof operationAccess === "boolean") return operationAccess;

  // The context carries the CALLER's roles and permissions. For an API key
  // those are the key's own scoped values, not its owner's — which is the
  // whole point of evaluating the rule against the key.
  const ctx: AccessControlContext = {
    user: { id: caller.userId },
    roles: caller.roles,
    permissions: caller.permissions,
    operation,
    collection: resource,
  };

  try {
    return (await operationAccess(ctx)) === true;
  } catch {
    return false;
  }
}

/**
 * Whether this caller may read the entity behind `slug`.
 *
 * Mirrors `requireCollectionAccess` branch for branch, including the parts that
 * are easy to get wrong when reimplementing it:
 *
 * - An API key is judged on its OWN scope. Its owner's grants are irrelevant,
 *   in both directions: a key without `read-{slug}` is denied however
 *   privileged its owner, and a key with it is allowed however unprivileged.
 * - **A super admin does not bypass an API key's scope.** The bypass belongs to
 *   the session path; applying it to keys would make a read-only key issued by
 *   an administrator equivalent to their full account.
 * - Code-defined `access.read` is consulted on both paths.
 *
 * `slug` is entity-generic — `getRegisteredAccess` reads the collection and
 * single maps alike, so a Single resolves its own rules with no branch here.
 */
export async function canReadEntity(
  slug: string,
  caller: ReadAccessCaller
): Promise<boolean> {
  if (!caller.userId || !slug) return false;

  const rbac = getRBACService();

  if (caller.authMethod === "api-key") {
    if (!caller.permissions.includes(`read-${slug}`)) return false;

    const codeAccess = rbac?.getRegisteredAccess(slug);
    if (!codeAccess) return true;
    return codeAccessAllows(codeAccess, "read", slug, caller);
  }

  // Session: `checkAccess` already composes super-admin, code-defined access
  // and the stored grants, so reproducing any of it here would be a second
  // implementation to keep in step.
  if (rbac) {
    return rbac.checkAccess({
      userId: caller.userId,
      operation: "read",
      resource: slug,
    });
  }

  // Before the container is up there is nothing to decide against. Denying is
  // the safe direction; the route-level gate has already run for any real
  // request that reaches a dispatcher handler.
  return false;
}
