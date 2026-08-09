/**
 * One shape for "the caller", built one way.
 *
 * Access rules are evaluated against a `UserContext`, and `UserContext` is an
 * open record: a stored `custom` rule may decide on a claim this framework
 * knows nothing about — a tenant, a plan, an entitlement. That makes the object
 * a caller is rebuilt into part of the authorization decision, so two places
 * that build it differently authorize differently.
 *
 * Every path that turns an authenticated caller into a `UserContext` builds it
 * here, so an enforced read performed on a caller's behalf reaches the same
 * verdict as that caller's own request would.
 *
 * @module auth/user-context
 */

import type { UserContext } from "../domains/collections/services/collection-types";

/** The verified pieces of an authenticated caller, however they were carried. */
export interface AuthenticatedIdentity {
  /**
   * Verified non-canonical token claims. Spread first so the canonical fields
   * below always win: a token cannot restate `id` or `roles` as a claim and
   * have it override the identity that was authenticated.
   */
  claims?: Record<string, unknown> | undefined;
  id: string;
  name?: string | undefined;
  email?: string | undefined;
  roles?: string[] | undefined;
}

/**
 * Build the `UserContext` an access rule is evaluated against.
 *
 * `role` repeats the first role because rules and field-level callbacks written
 * against a single-role model read `user.role`; without it a legitimately
 * authorized caller has fields stripped.
 */
export function buildUserContext(identity: AuthenticatedIdentity): UserContext {
  const { claims, id, name, email, roles } = identity;
  return {
    ...(claims ?? {}),
    id,
    name,
    email,
    roles,
    role: roles?.[0],
  };
}
