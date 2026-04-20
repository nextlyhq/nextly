import { setAccessTokenCookie } from "../cookies/access-token-cookie.js";
import { setRefreshTokenCookie } from "../cookies/refresh-token-cookie.js";
import { verifyCredentials } from "../credentials/verify-credentials.js";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";
import { buildClaims } from "../jwt/claims.js";
import { signAccessToken } from "../jwt/sign.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  generateRefreshTokenId,
} from "../session/refresh.js";

import {
  jsonResponse,
  stallResponse,
  buildCookieHeaders,
  getClientIp,
} from "./handler-utils.js";

export interface LoginHandlerDeps {
  secret: string;
  isProduction: boolean;
  accessTokenTTL: number;
  refreshTokenTTL: number;
  maxLoginAttempts: number;
  lockoutDurationSeconds: number;
  loginStallTimeMs: number;
  requireEmailVerification: boolean;
  allowedOrigins: string[];
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
}

export async function handleLogin(
  request: Request,
  deps: LoginHandlerDeps
): Promise<Response> {
  const startTime = Date.now();

  try {
    const body = await request.json();

    const csrfCookie = readCsrfCookie(request);
    const csrfToken = readCsrfFromRequest(body, request);
    const csrfResult = validateCsrf(
      request,
      csrfCookie,
      csrfToken,
      deps.allowedOrigins
    );
    if (!csrfResult.valid) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      return jsonResponse(403, {
        error: { code: "CSRF_FAILED", message: csrfResult.error },
      });
    }

    // Verify credentials (includes lockout check, brute-force tracking)
    const result = await verifyCredentials(
      { email: body.email, password: body.password },
      {
        findUserByEmail: deps.findUserByEmail,
        incrementFailedAttempts: deps.incrementFailedAttempts,
        lockAccount: deps.lockAccount,
        resetFailedAttempts: deps.resetFailedAttempts,
        maxLoginAttempts: deps.maxLoginAttempts,
        lockoutDurationSeconds: deps.lockoutDurationSeconds,
        requireEmailVerification: deps.requireEmailVerification,
      }
    );

    if (!result.success) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      const statusCode = result.code === "ACCOUNT_LOCKED" ? 429 : 401;
      return jsonResponse(statusCode, {
        error: { code: result.code, message: result.message },
      });
    }

    const [roleIds, customFields] = await Promise.all([
      deps.fetchRoleIds(result.user.id),
      deps.fetchCustomFields(result.user.id),
    ]);

    const claims = buildClaims({
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
      image: result.user.image,
      roleIds,
      customFields,
    });
    const accessToken = await signAccessToken(
      claims,
      deps.secret,
      deps.accessTokenTTL
    );

    const rawRefreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(rawRefreshToken);
    await deps.storeRefreshToken({
      id: generateRefreshTokenId(),
      userId: result.user.id,
      tokenHash: refreshTokenHash,
      userAgent: request.headers.get("user-agent"),
      ipAddress: getClientIp(request),
      expiresAt: new Date(Date.now() + deps.refreshTokenTTL * 1000),
    });

    const cookies = [
      setAccessTokenCookie(accessToken, deps.accessTokenTTL, deps.isProduction),
      setRefreshTokenCookie(
        rawRefreshToken,
        deps.refreshTokenTTL,
        deps.isProduction
      ),
    ];

    await stallResponse(startTime, deps.loginStallTimeMs);

    return new Response(
      JSON.stringify({
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            image: result.user.image,
            roleIds,
          },
        },
      }),
      { status: 200, headers: buildCookieHeaders(cookies) }
    );
  } catch {
    await stallResponse(startTime, deps.loginStallTimeMs);
    return jsonResponse(500, {
      error: {
        code: "INTERNAL_ERROR",
        message: "An error occurred during login",
      },
    });
  }
}
