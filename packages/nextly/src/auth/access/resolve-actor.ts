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
import type { Principal } from "../../plugins/principals/types";
import {
  listEffectiveGrants,
  listRoleSlugsForUser,
} from "../../services/lib/permissions";
import {
  scopeGrants,
  type AuthenticatedScope,
} from "../authenticated-scope";

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
 * A failed lookup answers no roles and no permissions, which refuses, as the
 * lookups the gates make today fail closed.
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
