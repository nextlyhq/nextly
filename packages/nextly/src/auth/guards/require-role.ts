import { hasRole, hasAnyRole, hasAllRoles } from "../session/get-session.js";
import type { SessionUser } from "../session/session-types.js";

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Require a specific role. Throws AuthorizationError if missing.
 */
export function requireRole(user: SessionUser, roleSlug: string): void {
  if (!hasRole(user, roleSlug)) {
    throw new AuthorizationError(`Role '${roleSlug}' required`);
  }
}

/**
 * Require any of the specified roles. Throws AuthorizationError if none match.
 */
export function requireAnyRole(user: SessionUser, roleSlugs: string[]): void {
  if (!hasAnyRole(user, roleSlugs)) {
    throw new AuthorizationError(
      `One of roles [${roleSlugs.join(", ")}] required`
    );
  }
}

/**
 * Require all of the specified roles. Throws AuthorizationError if any missing.
 */
export function requireAllRoles(user: SessionUser, roleSlugs: string[]): void {
  if (!hasAllRoles(user, roleSlugs)) {
    throw new AuthorizationError(
      `All roles [${roleSlugs.join(", ")}] required`
    );
  }
}
