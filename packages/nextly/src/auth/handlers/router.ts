import { rateLimiter } from "../middleware/rate-limiter";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";

import { handleChangePassword } from "./change-password";
import { handleCsrf } from "./csrf";
import { handleForgotPassword } from "./forgot-password";
import { handleLogin } from "./login";
import { handleLogout } from "./logout";
import { handleRefresh } from "./refresh";
import { handleRegister } from "./register";
import { handleResetPassword } from "./reset-password";
import { handleSession } from "./session";
import { handleSetupStatus, handleSetup } from "./setup";
import { handleVerifyEmail, handleResendVerification } from "./verify-email";

/**
 * Audit H4 / T-016: POST paths under `/auth/*` that share one per-IP
 * rate-limit bucket. Login is the obvious credential-stuffing target,
 * but register/forgot-password/reset-password are also sensitive (user
 * enumeration, mailbomb, token-grinding) and an attacker who maxes one
 * shouldn't be able to refresh their budget by switching to another.
 */
const RATE_LIMITED_AUTH_PATHS = new Set([
  "login",
  "register",
  "forgot-password",
  "reset-password",
]);

/**
 * Combined dependency interface for all auth handlers.
 * Defined as a standalone interface (not multi-extends) to avoid TS2320 conflicts
 * where the same method name has different return types across handler deps.
 * The route handler builds this from the DI container services and config.
 */
export interface AuthRouterDeps {
  secret: string;
  isProduction: boolean;
  accessTokenTTL: number;
  refreshTokenTTL: number;
  maxLoginAttempts: number;
  lockoutDurationSeconds: number;
  loginStallTimeMs: number;
  requireEmailVerification: boolean;
  /**
   * Spec §13.2 opt-in flag. When false (the spec default), email-conflict
   * registrations silent-success with a generic message. When true, the
   * handler returns 409 DUPLICATE so the user knows the email is in use
   * (trades enumeration risk for UX).
   */
  revealRegistrationConflict: boolean;
  allowedOrigins: string[];
  /**
   * Audit C4 / T-005: when true, client-IP resolution honors
   * `X-Forwarded-For` (filtered through `trustedProxyIps`). When false
   * (default), proxy headers are ignored.
   */
  trustProxy: boolean;
  /** Audit C4 / T-005: CIDR list of proxy IPs (from TRUSTED_PROXY_IPS). */
  trustedProxyIps: string[];
  /**
   * Audit H4 / T-016: per-IP rate limit on auth write endpoints.
   * `requestsPerHour: 0` disables the envelope. Single shared bucket
   * across login/register/forgot-password/reset-password per IP.
   */
  authRateLimit: {
    requestsPerHour: number;
    windowMs: number;
  };

  // User lookups (widest return type to satisfy all handlers)
  findUserByEmail: (email: string) => Promise<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    passwordHash: string;
    emailVerified: Date | null;
    isActive: boolean;
    failedLoginAttempts: number;
    lockedUntil: Date | null;
  } | null>;
  findUserById: (userId: string) => Promise<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    isActive: boolean;
  } | null>;

  incrementFailedAttempts: (userId: string) => Promise<void>;
  lockAccount: (userId: string, lockedUntil: Date) => Promise<void>;
  resetFailedAttempts: (userId: string) => Promise<void>;

  fetchRoleIds: (userId: string) => Promise<string[]>;
  fetchCustomFields: (userId: string) => Promise<Record<string, unknown>>;

  storeRefreshToken: (record: {
    id: string;
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }) => Promise<void>;
  findRefreshTokenByHash: (tokenHash: string) => Promise<{
    id: string;
    userId: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  } | null>;
  deleteRefreshToken: (id: string) => Promise<void>;
  deleteRefreshTokenByHash: (tokenHash: string) => Promise<void>;
  deleteAllRefreshTokensForUser: (userId: string) => Promise<void>;

  getUserCount: () => Promise<number>;
  createSuperAdmin: (data: {
    email: string;
    name: string;
    password: string;
  }) => Promise<{ id: string; email: string; name: string }>;
  seedPermissions: () => Promise<void>;

  // PR 5 (unified-error-system): these three throw NextlyError on failure
  // and return the success-case data directly. Result-shape envelopes are
  // gone — handlers catch NextlyError and serialise via toResponseJSON.
  registerUser: (data: {
    email: string;
    password: string;
    name: string;
  }) => Promise<{ id: string; email: string; name: string | null }>;

  generatePasswordResetToken: (
    email: string,
    redirectPath?: string
  ) => Promise<{ token?: string }>;
  resetPasswordWithToken: (
    token: string,
    newPassword: string
  ) => Promise<{ email: string }>;
  changePassword: (
    userId: string,
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;

  verifyEmail: (
    token: string
  ) => Promise<{ success: boolean; error?: string; email?: string }>;
  resendVerificationEmail: (
    email: string
  ) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Route an auth request to the appropriate handler.
 * Returns null if the path doesn't match any auth route (caller handles 404).
 *
 * @param request - The incoming HTTP request
 * @param authPath - The path after the auth prefix (e.g., "login", "setup-status")
 * @param deps - Injected service dependencies
 */
export async function routeAuthRequest(
  request: Request,
  authPath: string,
  deps: AuthRouterDeps
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  if (method === "GET") {
    switch (authPath) {
      case "setup-status":
        return handleSetupStatus(request, deps);
      case "session":
        return handleSession(request, deps);
      case "csrf":
        return handleCsrf(request, deps);
      default:
        return null;
    }
  }

  if (method === "POST") {
    if (RATE_LIMITED_AUTH_PATHS.has(authPath)) {
      const limited = checkAuthIpRateLimit(request, deps);
      if (limited) return limited;
    }
    switch (authPath) {
      case "login":
        return handleLogin(request, deps);
      case "logout":
        return handleLogout(request, deps);
      case "refresh":
        return handleRefresh(request, deps);
      case "setup":
        return handleSetup(request, deps);
      case "register":
        return handleRegister(request, deps);
      case "forgot-password":
        return handleForgotPassword(request, deps);
      case "reset-password":
        return handleResetPassword(request, deps);
      case "verify-email":
        return handleVerifyEmail(request, deps);
      case "verify-email/resend":
        return handleResendVerification(request, deps);
      default:
        return null;
    }
  }

  if (method === "PATCH") {
    switch (authPath) {
      case "change-password":
        return handleChangePassword(request, deps);
      default:
        return null;
    }
  }

  return null;
}

/**
 * Audit H4 / T-016: per-IP rate limit on auth write endpoints.
 *
 * Returns a 429 `Response` when the IP has exhausted its budget for the
 * current window, or `null` when the request should proceed. Uses the
 * shared in-memory sliding-window `rateLimiter` singleton — the same
 * one the API-key middleware uses. T-104 will swap the backing store
 * for Redis so multi-instance deployments share state; until then,
 * single-instance is the documented beta scope.
 *
 * Falls back to a single shared `unknown` bucket when the trusted IP
 * is null (matches the pattern in `middleware/rate-limit.ts`). That
 * means a non-proxied deployment without `trustProxy` enabled will
 * lump every auth request into one bucket — heavy-handed but
 * intentional: the alternative (skip the limiter) leaves the
 * deployment open to credential-stuffing.
 */
function checkAuthIpRateLimit(
  request: Request,
  deps: AuthRouterDeps
): Response | null {
  const limit = deps.authRateLimit.requestsPerHour;
  if (limit <= 0) return null; // explicitly disabled

  const ip =
    getTrustedClientIp(request, {
      trustProxy: deps.trustProxy,
      trustedProxyIps: deps.trustedProxyIps,
    }) ?? "unknown";

  const result = rateLimiter.check(
    `auth-ip:${ip}`,
    limit,
    deps.authRateLimit.windowMs
  );
  if (result.allowed) return null;

  const retryAfter = Math.max(
    1,
    Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
  );
  return new Response(
    JSON.stringify({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many auth requests from this IP. Please try again later.",
        retryAfter,
      },
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfter),
        "x-ratelimit-limit": String(limit),
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(result.resetAt.getTime()),
      },
    }
  );
}
