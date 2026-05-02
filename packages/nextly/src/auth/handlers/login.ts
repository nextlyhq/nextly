import { readOrGenerateRequestId } from "../../api/request-id";
// Phase 4 (Task 10): canonical respondX helpers replace ad-hoc
// `{ data: ... }` envelopes on the auth surface. See spec §7.6.
import { respondAction } from "../../api/response-shapes";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors/nextly-error";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { setAccessTokenCookie } from "../cookies/access-token-cookie";
import { setRefreshTokenCookie } from "../cookies/refresh-token-cookie";
import { verifyCredentials } from "../credentials/verify-credentials";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";
import {
  generateRefreshToken,
  hashRefreshToken,
  generateRefreshTokenId,
} from "../session/refresh";


import {
  jsonResponse,
  stallResponse,
  buildCookieHeaders,
} from "./handler-utils";

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
  /** Audit C4 / T-005: gate XFF parsing on this. Default false. */
  trustProxy: boolean;
  /** Audit C4 / T-005: CIDR list of proxy IPs (from TRUSTED_PROXY_IPS). */
  trustedProxyIps: string[];
  /** Audit M10 / T-022: writer for security-sensitive auth events. */
  auditLog: AuditLogWriter;
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
      ipAddress: getTrustedClientIp(request, {
        trustProxy: deps.trustProxy,
        trustedProxyIps: deps.trustedProxyIps,
      }),
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

    // Phase 4 / spec §7.6: emit `{ message, user, accessToken, refreshToken,
    // expiresAt }` directly. Tokens are still issued as HttpOnly cookies for
    // browser-based clients; surfacing them in the body too lets non-browser
    // SDK consumers (mobile, CLI) drive Authorization headers without losing
    // server-authored toast text.
    return respondAction(
      "Logged in.",
      {
        user: {
          id: verifiedUser.id,
          email: verifiedUser.email,
          name: verifiedUser.name,
          image: verifiedUser.image,
          roleIds,
        },
        accessToken,
        refreshToken: rawRefreshToken,
        // `expiresAt` reflects the access-token JWT exp claim (the
        // authoritative expiration server-side), not the cookie max-age.
        // signAccessToken uses deps.accessTokenTTL for that.
        expiresAt: new Date(
          Date.now() + deps.accessTokenTTL * 1000
        ).toISOString(),
      },
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
    // Audit M10 / T-022: every login failure (bad password, locked,
    // unverified, inactive, internal) records a single 'login-failed'
    // event. We deliberately do not split by reason here — that would
    // re-introduce the account-state leak PR 5 collapsed at the wire.
    // The internal `logContext` on the NextlyError still carries the
    // specific cause for operators reading the audit row's metadata.
    await deps.auditLog.write({
      kind: "login-failed",
      ipAddress: getTrustedClientIp(request, {
        trustProxy: deps.trustProxy,
        trustedProxyIps: deps.trustedProxyIps,
      }),
      userAgent: request.headers.get("user-agent"),
      metadata: NextlyError.is(err)
        ? { code: err.code, ...(err.logContext ?? {}) }
        : { code: "INTERNAL_ERROR" },
    });
    if (NextlyError.is(err)) {
      return buildLoginErrorResponse(err, requestId);
    }
    return buildLoginErrorResponse(
      NextlyError.internal({ cause: err as Error }),
      requestId
    );
  }
}
