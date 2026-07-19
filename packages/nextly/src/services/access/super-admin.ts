/**
 * Super-admin detection for stored-access-rule bypass.
 *
 * Shared by the collection and single access paths so the "super-admins bypass
 * stored rules on every transport" contract is evaluated identically wherever a
 * caller's authorized scope is known.
 *
 * @module services/access/super-admin
 */

/** Role slug that grants the full stored-rule bypass. */
export const SUPER_ADMIN_SLUG = "super-admin";

/** Minimal caller shape needed to decide super-admin status. */
interface RoleBearer {
  /** Singular authorized role (the Direct API forwards only this). */
  role?: string;
  /** Full authorized role set (session slugs or key-scoped slugs). */
  roles?: string[];
}

/**
 * Whether the caller's AUTHORIZED role set makes them a super-admin.
 *
 * Keyed on the authorized role slugs (`role` / `roles`) rather than the account
 * id: a scoped API key owned by a super-admin must NOT inherit the owner's
 * bypass — the authorized scope is what matters. The singular `role` is folded
 * in so a caller reaching us through a surface that only carries `{ id, role }`
 * (the Direct API collection namespace) still gets the bypass the changeset
 * promises on every transport. Callers that populate neither don't get the
 * bypass (fail-safe), falling through to the normal RBAC + stored-rule checks.
 */
export function isSuperAdminContext(user?: RoleBearer): boolean {
  if (!user) return false;
  if (user.role === SUPER_ADMIN_SLUG) return true;
  return Array.isArray(user.roles) && user.roles.includes(SUPER_ADMIN_SLUG);
}
