// PR 5 (unified-error-system): the local AuthorizationError class was
// deleted and the public messages that used to leak role identity (e.g.
// "Role 'admin' required") collapse into the canonical FORBIDDEN response
// per spec §13.7. The role names move to logContext for operators only.
import { NextlyError } from "../../errors/nextly-error.js";
import { hasRole, hasAnyRole, hasAllRoles } from "../session/get-session.js";
import type { SessionUser } from "../session/session-types.js";

/**
 * Require a specific role. Throws `NextlyError.forbidden()` if missing.
 *
 * Public message comes from the factory ("You don't have permission to
 * perform this action."). The required role identity is recorded in
 * logContext only — the wire response never includes it.
 */
export function requireRole(user: SessionUser, roleSlug: string): void {
  if (!hasRole(user, roleSlug)) {
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
 * none match. The role list moves to logContext per §13.7 — never the wire.
 */
export function requireAnyRole(user: SessionUser, roleSlugs: string[]): void {
  if (!hasAnyRole(user, roleSlugs)) {
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
 * any are missing. The role list moves to logContext per §13.7.
 */
export function requireAllRoles(user: SessionUser, roleSlugs: string[]): void {
  if (!hasAllRoles(user, roleSlugs)) {
    throw NextlyError.forbidden({
      logContext: {
        action: "require-all-roles",
        requiredRoles: roleSlugs,
        userId: user.id,
      },
    });
  }
}
