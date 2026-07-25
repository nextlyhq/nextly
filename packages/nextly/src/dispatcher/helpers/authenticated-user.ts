import type { UserContext } from "../../domains/collections/services/collection-types";
import type { Params } from "../types";

import { readAuthenticatedRoles } from "./authenticated-roles";

/**
 * Build the caller's `UserContext` from the reserved `_authenticated*` route
 * params the route handler stamps after authenticating a request.
 *
 * Returns `undefined` for an unauthenticated caller, which the services read as
 * "anonymous" — so an absent user is never mistaken for a trusted one.
 *
 * Access rules are evaluated against this object: `roles` drives role-based
 * rules and field-level `access.read` callbacks, and `id` drives owner-only
 * scoping. `role` repeats the first role because rules and field callbacks
 * written against a single-role model read `user.role`; without it a
 * legitimately authorized caller would have fields stripped.
 */
export function readAuthenticatedUser(p: Params): UserContext | undefined {
  if (!p._authenticatedUserId) return undefined;

  const roles = readAuthenticatedRoles(p);
  return {
    id: String(p._authenticatedUserId),
    name: p._authenticatedUserName
      ? String(p._authenticatedUserName)
      : undefined,
    email: p._authenticatedUserEmail
      ? String(p._authenticatedUserEmail)
      : undefined,
    roles,
    role: roles?.[0],
  };
}
