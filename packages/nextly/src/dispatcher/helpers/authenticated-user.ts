import { buildUserContext } from "../../auth/user-context";
import type { UserContext } from "../../domains/collections/services/collection-types";
import type { Params } from "../types";

import { readAuthenticatedRoles } from "./authenticated-roles";

/**
 * The caller's verified non-canonical token claims, as stamped by the route
 * handler. Server-authored: the handler deletes any client-supplied copy of the
 * reserved key before writing its own, so what is read here was authenticated.
 *
 * A malformed value yields no claims rather than throwing — a rule then decides
 * on the canonical identity alone, which is the fail-closed direction for the
 * absence-tolerant rules this exists to serve.
 */
function readAuthenticatedClaims(p: Params): Record<string, unknown> {
  const raw = p._authenticatedClaims;
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

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
 *
 * Shared, and in two directions. Every REST collection and single operation
 * reaches its access check through this one function, so a field added or
 * dropped here changes what every stored rule and field callback is judged on.
 * And the object itself is built by `buildUserContext`, which the preview-link
 * mint probe also calls — that shared constructor is what makes the probe reach
 * the same verdict the bearer's own read will, rather than a near-miss that
 * admits a caller the rule was written to refuse.
 */
export function readAuthenticatedUser(p: Params): UserContext | undefined {
  if (!p._authenticatedUserId) return undefined;

  return buildUserContext({
    claims: readAuthenticatedClaims(p),
    id: String(p._authenticatedUserId),
    name: p._authenticatedUserName
      ? String(p._authenticatedUserName)
      : undefined,
    email: p._authenticatedUserEmail
      ? String(p._authenticatedUserEmail)
      : undefined,
    roles: readAuthenticatedRoles(p),
  });
}
