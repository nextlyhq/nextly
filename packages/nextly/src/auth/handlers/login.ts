import { readOrGenerateRequestId } from "../../api/request-id.js";
import { NextlyError } from "../../errors/nextly-error.js";
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

/**
 * Serialize a NextlyError to the canonical login error response.
 *
 * PR 5 (unified-error-system): every login failure (CSRF, invalid creds,
 * locked, unverified, inactive, internal) is now returned as a NextlyError
 * with the same wire format that withErrorHandler produces — application/
 * problem+json with code, message, and requestId. Account-state codes have
 * collapsed into AUTH_INVALID_CREDENTIALS per spec §13.1.
 */
function buildLoginErrorResponse(
  err: NextlyError,
  requestId: string
): Response {
  return new Response(
    JSON.stringify({ error: err.toResponseJSON(requestId) }),
    {
      status: err.statusCode,
      headers: {
        "content-type": "application/problem+json",
        "x-request-id": requestId,
      },
    }
  );
}

export async function handleLogin(
  request: Request,
  deps: LoginHandlerDeps
): Promise<Response> {
  const startTime = Date.now();
  const requestId = readOrGenerateRequestId(request);

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
      // CSRF stays as a discrete code — it's a configuration / origin issue,
      // not an account-state leak. Keep the existing wire shape.
      return jsonResponse(
        403,
        {
          error: { code: "CSRF_FAILED", message: csrfResult.error },
        },
        { "x-request-id": requestId }
      );
    }

    // verifyCredentials now throws NextlyError on every failure path.
    // Account-state checks (locked / unverified / inactive) collapse to
    // AUTH_INVALID_CREDENTIALS per spec §13.1 — the 429 ternary that used
    // to bubble lockout state to the wire is gone (always 401 now).
    const verifiedUser = await verifyCredentials(
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

    const [roleIds, customFields] = await Promise.all([
      deps.fetchRoleIds(verifiedUser.id),
      deps.fetchCustomFields(verifiedUser.id),
    ]);

    const claims = buildClaims({
      userId: verifiedUser.id,
      email: verifiedUser.email,
      name: verifiedUser.name,
      image: verifiedUser.image,
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
      userId: verifiedUser.id,
      tokenHash: refreshTokenHash,
      userAgent: request.headers.get("user-agent"),
      ipAddress: getClientIp(request),
      expiresAt: new Date(Date.now() + deps.refreshTokenTTL * 1000),
    });

    const cookies = [
      setAccessTokenCookie(
        accessToken,
        deps.refreshTokenTTL,
        deps.isProduction
      ),
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
            id: verifiedUser.id,
            email: verifiedUser.email,
            name: verifiedUser.name,
            image: verifiedUser.image,
            roleIds,
          },
        },
      }),
      {
        status: 200,
        headers: buildCookieHeaders(cookies, { "x-request-id": requestId }),
      }
    );
  } catch (err) {
    // All login failures stall to the same minimum so timing cannot be used
    // to distinguish error legs. PR 5 unifies error shape: NextlyError →
    // toResponseJSON; everything else collapses to a single INTERNAL_ERROR
    // response so we never leak internals to the wire.
    await stallResponse(startTime, deps.loginStallTimeMs);
    if (NextlyError.is(err)) {
      return buildLoginErrorResponse(err, requestId);
    }
    return buildLoginErrorResponse(
      NextlyError.internal({ cause: err as Error }),
      requestId
    );
  }
}
