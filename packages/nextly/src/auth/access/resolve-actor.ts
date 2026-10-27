/**
 * The actor for each way a caller reaches Nextly: the one place a caller
 * becomes the value a decision is made for.
 *
 * Each source keeps what the gates read today, so an answer reached through
 * an actor is the answer reached without one:
 *
 * - a signed-in user's roles (inherited ones included) and permissions come
 *   from the same lookups the gates and the rules' context make today. Within
 *   a request those lookups are kept, so an actor costs no query after the
 *   request's first; outside a request they run per call, as they always have;
 * - a key's come from its scope exactly as authentication resolved them, and
 *   a key never holds super-admin authority, whoever made it;
 * - a plugin's person and a visitor carry no lookup at all.
 *
 * A caller handed in by server code (a Direct API `user`, a service's `as`)
 * is resolved like any other, so a narrower caller is its own actor.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { Principal } from "../../plugins/principals/types";
import {
  hasPermission,
  isSuperAdmin,
  isSuperAdminOrRefuse,
  listEffectiveGrants,
  listRoleSlugsForUser,
} from "../../services/lib/permissions";
import { consoleLogger } from "../../shared/types";
import { scopeGrants, type AuthenticatedScope } from "../authenticated-scope";

import {
  keyActor,
  principalActor,
  userActor,
  visitorActor,
  type KeyActor,
  type PermissionGrant,
  type PrincipalActor,
  type UserActor,
  type VisitorActor,
} from "./actor";

/**
 * A signed-in user's actor. With `executor`, the lookups read the caller's
 * transaction rather than the pool, as the gates' own lookups do inside one.
 * A lookup that fails refuses rather than answering empty: it throws, as the
 * role and grant lookups do, and the gate denies.
 */
export async function actorForUser(
  userId: string,
  options: { executor?: unknown } = {}
): Promise<UserActor> {
  const [roles, permissions] = await Promise.all([
    listRoleSlugsForUser(userId, options.executor),
    listEffectiveGrants(userId, options.executor),
  ]);
  return userActor({ userId, roles, permissions });
}

/**
 * A signed-in user's actor for a reader that refuses rather than fails: each
 * lookup that fails counts as holding nothing of its kind, and is logged. A
 * failed role lookup keeps the grants that were read, and a failed grant
 * lookup keeps the roles, and with them a super-admin's authority, as the
 * separate super-admin and permission checks such a reader replaced each
 * answered on their own.
 */
export async function actorForUserFailingClosed(
  userId: string
): Promise<UserActor> {
  const [roles, permissions] = await Promise.allSettled([
    listRoleSlugsForUser(userId),
    listEffectiveGrants(userId),
  ]);
  const settled = { roles, grants: permissions };
  for (const [lookup, result] of Object.entries(settled)) {
    if (result.status === "rejected") {
      consoleLogger.error(`[rbac] Could not read the ${lookup} of ${userId}`, {
        error: result.reason,
      });
    }
  }
  return userActor({
    userId,
    roles: roles.status === "fulfilled" ? roles.value : [],
    permissions: permissions.status === "fulfilled" ? permissions.value : [],
  });
}

/** A signed-in user's permissions, read once for work that asks about many. */
export interface HeldPermissions {
  readonly userId: string;
  readonly superAdmin: boolean;
  readonly grants: readonly PermissionGrant[];
}

const heldPermissions = new AsyncLocalStorage<HeldPermissions>();

/**
 * Runs `work` with `userId`'s permissions read once, so each permission check
 * inside it answers from what was read instead of asking the database about
 * one resource at a time. For work that asks the same caller about every
 * entity at once; any other work asks as it always has. `work` is handed what
 * was read, so anything it states about the user comes from the same read as
 * the checks.
 *
 * The answers are the targeted check's: a role set holding the permission,
 * super-admin authority included, read through the same effective-grant
 * lookup a rule's context uses. A read that fails refuses the work rather
 * than letting each check ask on its own, which would multiply the reads
 * exactly while the database is failing, and rather than taking a super-admin
 * whose roles could not be read for a non-admin.
 *
 * @throws NextlyError when the user's roles or permissions cannot be read.
 */
export async function withHeldPermissions<T>(
  userId: string,
  work: (held: HeldPermissions) => Promise<T>
): Promise<T> {
  const [superAdmin, grants] = await Promise.all([
    isSuperAdminOrRefuse(userId),
    listEffectiveGrants(userId),
  ]);
  const held: HeldPermissions = { userId, superAdmin, grants };
  return heldPermissions.run(held, () => work(held));
}

/**
 * Whether a signed-in user holds the permission to `action` on `resource`,
 * super-admin authority included: what the decision reads of a user where the
 * target declares no rule for the action. Asked of the targeted permission
 * check and its caches, rather than by resolving the user's every role and
 * grant, which only a rule's context needs, unless that user's permissions
 * are held for the work in hand ({@link withHeldPermissions}). A failed lookup
 * answers no.
 */
export function userHoldsPermission(
  userId: string,
  action: string,
  resource: string,
  options: { executor?: unknown } = {}
): Promise<boolean> {
  const held = heldPermissions.getStore();
  // A transaction's own view is never answered from a pooled read.
  if (held?.userId === userId && options.executor === undefined) {
    return Promise.resolve(
      held.superAdmin ||
        held.grants.some(
          grant => grant.action === action && grant.resource === resource
        )
    );
  }
  return hasPermission(userId, action, resource, options.executor);
}

/**
 * Whether a signed-in user holds super-admin authority, directly or through
 * an inherited role: the one thing the decision reads of a user facing a rule
 * that is a plain yes or no. Asked of the targeted, cached check. A failed
 * lookup answers no.
 */
export function userIsSuperAdmin(
  userId: string,
  options: { executor?: unknown } = {}
): Promise<boolean> {
  return isSuperAdmin(userId, options.executor);
}

/**
 * An API key's actor, from what authentication resolved for it: the key's
 * own permissions and roles, and the user who made it.
 */
export function actorForKey(fields: {
  keyId: string;
  userId: string;
  grants: readonly PermissionGrant[];
  roles: readonly string[];
}): KeyActor {
  return keyActor({
    keyId: fields.keyId,
    userId: fields.userId,
    roles: fields.roles,
    permissions: fields.grants,
  });
}

/**
 * The actor for a key's scope, as a gate holds it, for the user the call
 * names. The key's own roles when the scope carries them, else the user's,
 * as the key's rule context has always been built. A scope whose permissions
 * and grant rows disagree is refused here, as it is wherever it is read.
 *
 * A gate holds the key's scope but not its id, so the actor names none; a
 * way in that knows the id builds the actor with {@link actorForKey}.
 */
export function actorForScope(
  scope: AuthenticatedScope,
  user: { id: string; roles?: readonly string[] }
): KeyActor {
  scopeGrants(scope);
  return actorForKey({
    keyId: "",
    userId: user.id,
    grants: scope.grants ?? [],
    roles: scope.roles ?? user.roles ?? [],
  });
}

/** A plugin person's actor; one core did not make is refused. */
export function actorForPrincipal(principal: Principal): PrincipalActor {
  return principalActor(principal);
}

/** A caller with no session, no key and no plugin person. */
export function actorForVisitor(): VisitorActor {
  return visitorActor();
}
