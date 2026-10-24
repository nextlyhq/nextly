import { NextlyError } from "../../errors/nextly-error";
import {
  INSTEAD_OF_A_ROLE_CHECK,
  warnDeprecatedExport,
} from "../deprecated-exports";
import { holdsAllRoles, holdsAnyRole, holdsRole } from "../session/get-session";
import type { SessionUser } from "../session/session-types";

/**
 * Require a specific role. Throws `NextlyError.forbidden()` if missing.
 *
 * Public message comes from the factory ("You don't have permission to
 * perform this action."). The required role identity is recorded in
 * logContext only; the wire response never includes it (spec §13.7).
 *
 * @deprecated Compares the user's role ids with role names, so it never
 * matches a role by name. Check a permission with
 * `nextly.access.check({ userId, resource, operation })`. Removed in the next
 * release.
 */
export function requireRole(user: SessionUser, roleSlug: string): void {
  warnDeprecatedExport("requireRole", INSTEAD_OF_A_ROLE_CHECK);
  if (!holdsRole(user, roleSlug)) {
    throw NextlyError.forbidden({
      logContext: {
        action: "require-role",
        requiredRole: roleSlug,
        userId: user.id,
      },
    });
  }
}

/**
 * Require any of the specified roles. Throws `NextlyError.forbidden()` if
 * none match. The role list lives in logContext per spec §13.7;
 * the wire response never includes it.
 *
 * @deprecated As {@link requireRole}. Removed in the next release.
 */
export function requireAnyRole(user: SessionUser, roleSlugs: string[]): void {
  warnDeprecatedExport("requireAnyRole", INSTEAD_OF_A_ROLE_CHECK);
  if (!holdsAnyRole(user, roleSlugs)) {
    throw NextlyError.forbidden({
      logContext: {
        action: "require-any-role",
        requiredRoles: roleSlugs,
        userId: user.id,
      },
    });
  }
}

/**
 * Require all of the specified roles. Throws `NextlyError.forbidden()` if
 * any are missing. The role list lives in logContext per spec §13.7.
 *
 * @deprecated As {@link requireRole}. Removed in the next release.
 */
export function requireAllRoles(user: SessionUser, roleSlugs: string[]): void {
  warnDeprecatedExport("requireAllRoles", INSTEAD_OF_A_ROLE_CHECK);
  if (!holdsAllRoles(user, roleSlugs)) {
    throw NextlyError.forbidden({
      logContext: {
        action: "require-all-roles",
        requiredRoles: roleSlugs,
        userId: user.id,
      },
    });
  }
}
