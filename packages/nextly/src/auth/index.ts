/**
 * @module auth
 *
 * Nextly custom authentication system.
 *
 * JWT: Access token signing and verification (jose)
 * Session: Session extraction and role checking
 * Guards: Authentication and authorization middleware
 * Cookies: Cookie management for auth tokens
 * CSRF: Cross-site request forgery protection
 * Credentials: Email + password verification with brute-force protection
 * Password: Hashing and strength validation (bcrypt)
 * Handlers: HTTP request handlers for auth endpoints
 */

export { signAccessToken, secretToKey } from "./jwt/sign.js";
export { verifyAccessToken, type VerifyResult } from "./jwt/verify.js";
export {
  buildClaims,
  type NextlyJwtPayload,
  type BuildClaimsInput,
} from "./jwt/claims.js";

export {
  getSession,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  type GetSessionResult,
} from "./session/get-session.js";
export type {
  SessionUser,
  AuthContext,
  RefreshTokenRecord,
} from "./session/session-types.js";
export { generateRefreshToken, hashRefreshToken } from "./session/refresh.js";

// PR 5 (unified-error-system): AuthenticationError and AuthorizationError
// classes were deleted. Throw `NextlyError.authRequired()` /
// `NextlyError.forbidden()` instead — they carry the same semantics with
// generic public messages and rich logContext for operators.
export { requireAuth } from "./guards/require-auth.js";
export {
  requireRole,
  requireAnyRole,
  requireAllRoles,
} from "./guards/require-role.js";
export {
  checkPermission,
  createErrorResponse,
  createJsonErrorResponse,
  isErrorResponse,
  type ErrorResponse,
} from "./guards/require-permission.js";
export { authenticateApiKey } from "./guards/require-api-key.js";
export { checkCollectionAccess } from "./guards/require-collection-access.js";

export {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  type PasswordStrengthResult,
} from "./password/index.js";

export { routeAuthRequest } from "./handlers/router.js";
export type { AuthRouterDeps } from "./handlers/router.js";
