/**
 * @module auth
 *
 * Nextly custom authentication system.
 *
 * JWT: Access token signing and verification (jose)
 * Session: Session extraction
 * Guards: Authentication and authorization middleware
 * Cookies: Cookie management for auth tokens
 * CSRF: Cross-site request forgery protection
 * Credentials: Email + password verification with brute-force protection
 * Password: Hashing and strength validation (bcrypt)
 * Handlers: HTTP request handlers for auth endpoints
 */

export { signAccessToken, secretToKey } from "./jwt/sign";
export { verifyAccessToken, type VerifyResult } from "./jwt/verify";
export {
  buildClaims,
  type NextlyJwtPayload,
  type BuildClaimsInput,
} from "./jwt/claims";

export { getSession, type GetSessionResult } from "./session/get-session";
export type { SessionUser, RefreshTokenRecord } from "./session/session-types";
export { generateRefreshToken, hashRefreshToken } from "./session/refresh";

export { requireAuth } from "./guards/require-auth";
export {
  createErrorResponse,
  createJsonErrorResponse,
  isErrorResponse,
  type ErrorResponse,
} from "./guards/require-permission";

// Re-export the canonical "is the user a super-admin" check so user-facing
// route handlers (e.g. the template's seed POST route) can gate destructive
// actions without rolling their own permission lookup. The check goes
// through the same in-memory cache the rest of the framework uses.
export { isSuperAdmin } from "../services/lib/permissions";

export {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  type PasswordStrengthResult,
} from "./password/index";

export { routeAuthRequest } from "./handlers/router";
export type { AuthRouterDeps } from "./handlers/router";
// The types `AuthRouterDeps` names, so a caller assembling one can name them
// too. Experimental with it.
export type { CredentialUserRow } from "./credentials/verify-credentials";
export type { AccountState } from "./session/account-state";
// The two-factor marks core supplies as `spentChallenges`, for a caller that
// assembles the deps itself and wants single use on every instance.
export {
  databaseSpentChallenges,
  type SpentChallenges,
} from "./pipeline/spent-challenges";
export type { SessionRoles } from "./session/session-roles";
export type {
  SessionRowTransaction,
  WithSessionRowTransaction,
} from "./handlers/session-row";

// Preview tokens — minting and checking scoped, short-lived draft links. The
// route that consumes them lives in `nextly/runtime`, since only that half
// touches Next.
export {
  DEFAULT_PREVIEW_TTL_SECONDS,
  previewTokenCovers,
  signPreviewToken,
  verifyPreviewToken,
  type PreviewTokenScope,
  type PreviewVerifyResult,
  type SignPreviewTokenOptions,
} from "./preview/preview-token";
