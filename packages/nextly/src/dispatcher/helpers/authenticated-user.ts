import { currentRequestCaller } from "../../auth/caller-scope";
import { buildUserContext } from "../../auth/user-context";
import type { UserContext } from "../../domains/collections/services/collection-types";
import { NextlyError } from "../../errors/nextly-error";

import { readAuthenticatedRoles } from "./authenticated-roles";

/**
 * The caller's `UserContext`, built from the request caller the route handler
 * authenticated.
 *
 * Returns `undefined` for an unauthenticated caller, which the services read as
 * "anonymous" — so an absent user is never mistaken for a trusted one.
 *
 * The ONE builder of the dispatcher's user. Access rules are evaluated against
 * this object: `roles` drives role-based rules and field-level `access.read`
 * callbacks, and the token's verified claims let a rule decide on a tenant or a
 * plan exactly as it does through the Direct API. Every REST collection, single
 * and version operation reaches its access check through it, so a field added
 * or dropped here changes what every rule is judged on, everywhere at once.
 * The object itself is built by `buildUserContext`, which the preview-link mint
 * probe also calls, so the probe reaches the verdict the bearer's read will.
 */
export function readAuthenticatedUser(): UserContext | undefined {
  const caller = currentRequestCaller();
  if (!caller) return undefined;
  return buildUserContext({
    claims: caller.claims ? { ...caller.claims } : undefined,
    id: caller.userId,
    name: caller.name,
    email: caller.email,
    roles: readAuthenticatedRoles(),
  });
}

/**
 * {@link readAuthenticatedUser} for a handler that cannot run without one.
 *
 * Every such route is authenticated before it is dispatched, so this refuses
 * only a dispatch that skipped that, rather than acting for an empty id.
 */
export function requireAuthenticatedUser(): UserContext {
  const user = readAuthenticatedUser();
  if (!user) throw NextlyError.authRequired();
  return user;
}
