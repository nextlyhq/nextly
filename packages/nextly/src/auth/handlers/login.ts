import { readOrGenerateRequestId } from "../../api/request-id";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors/nextly-error";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
import { mintPendingToken } from "../pipeline/pending-token";
import { runStrategyChain } from "../pipeline/strategy-chain";
import type { AuthStrategy } from "../pipeline/types";

import {
  jsonResponse,
  stallResponse,
  buildAuthErrorResponse,
} from "./handler-utils";
import {
  issueSession,
  challengeResponse,
  type IssueSessionDeps,
} from "./issue-session";

/**
 * Login handler deps. Satisfies {@link IssueSessionDeps} (so it can mint the
 * session) plus the auth pipeline (D71): the ordered strategy list (built-in
 * `password` strategy last), the hook registry, the plugin context, and the
 * challenge pending-token TTL.
 *
 * The legacy credential/lockout fields (findUserByEmail, increment/lock/reset,
 * maxLoginAttempts, ...) remain because the built-in password strategy's
 * `verify` closure (wired in DI) uses them; the handler no longer calls
 * verifyCredentials directly.
 */
export interface LoginHandlerDeps extends IssueSessionDeps {
  maxLoginAttempts: number;
  lockoutDurationSeconds: number;
  loginStallTimeMs: number;
  requireEmailVerification: boolean;
  allowedOrigins: string[];
  /** Challenge pending-auth token TTL (seconds). */
  challengeTokenTTL: number;
  /** Ordered auth strategies; the built-in `password` strategy is last. */
  authStrategies: AuthStrategy[];
  /** Writer for security-sensitive auth events. */
  auditLog: AuditLogWriter;

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
}

export async function handleLogin(
  request: Request,
  deps: LoginHandlerDeps
): Promise<Response> {
  const startTime = Date.now();
  const requestId = readOrGenerateRequestId(request);

  try {
    const body = (await request.json()) as Record<string, unknown>;

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
      // CSRF stays as a discrete code; it's a configuration / origin issue,
      // not an account-state leak. Keep the existing wire shape.
      return jsonResponse(
        403,
        {
          error: { code: "CSRF_FAILED", message: csrfResult.error },
        },
        { "x-request-id": requestId }
      );
    }

    // beforeLogin hooks (D71) — may throw to abort; no-op when none registered.
    await deps.authHooks.runBeforeLogin(
      { request, body, strategyName: "" },
      deps.pluginCtx
    );

    // Strategy chain (D71). The built-in `password` strategy (last) wraps
    // verifyCredentials and throws NextlyError.invalidCredentials on every
    // failure leg (locked / unverified / inactive / bad password) — caught
    // below, identical to the legacy path. With no extra strategies + no hooks,
    // this is byte-for-byte the previous behavior.
    const outcome = await runStrategyChain(
      deps.authStrategies,
      { request, body },
      deps.pluginCtx
    );

    if (outcome.type === "pass" || outcome.type === "fail") {
      // No strategy claimed the request → unified invalid-credentials 401
      // (same wire shape + stall + audit as the legacy missing-credentials leg).
      throw NextlyError.invalidCredentials({
        logContext: {
          reason:
            outcome.type === "fail"
              ? (outcome.reason ?? "strategy-fail")
              : "no-strategy-matched",
        },
      });
    }

    if (outcome.type === "challenge") {
      const pendingToken = await mintPendingToken(
        {
          userId: outcome.challenge.userId,
          challengeId: outcome.challenge.id,
          attempts: 0,
        },
        deps.secret,
        deps.challengeTokenTTL
      );
      await stallResponse(startTime, deps.loginStallTimeMs);
      return challengeResponse(outcome.challenge, pendingToken, requestId);
    }

    // outcome.type === "authenticated"
    const afterAuth = await deps.authHooks.runAfterAuthenticate(
      outcome.user,
      deps.pluginCtx
    );
    if (
      afterAuth &&
      typeof afterAuth === "object" &&
      "challenge" in afterAuth
    ) {
      const ch = afterAuth.challenge;
      const pendingToken = await mintPendingToken(
        { userId: ch.userId, challengeId: ch.id, attempts: 0 },
        deps.secret,
        deps.challengeTokenTTL
      );
      await stallResponse(startTime, deps.loginStallTimeMs);
      return challengeResponse(ch, pendingToken, requestId);
    }

    const response = await issueSession(afterAuth, deps, request, requestId);
    await deps.authHooks.runAfterLogin(afterAuth, deps.pluginCtx);
    await stallResponse(startTime, deps.loginStallTimeMs);
    return response;
  } catch (err) {
    // All login failures stall to the same minimum so timing cannot be
    // used to distinguish error legs. NextlyError serialises via
    // toResponseJSON; everything else collapses to a single INTERNAL_ERROR
    // response so we never leak internals to the wire.
    await stallResponse(startTime, deps.loginStallTimeMs);
    // Every login failure (bad password, locked, unverified, inactive,
    // internal) records a single 'login-failed' event. We deliberately do
    // not split by reason here; that would re-introduce the account-state
    // leak the unified error wire shape collapses. The internal
    // `logContext` on the NextlyError still carries the specific cause for
    // operators reading the audit row's metadata.
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
      return buildAuthErrorResponse(err, requestId);
    }
    return buildAuthErrorResponse(
      NextlyError.internal({ cause: err as Error }),
      requestId
    );
  }
}
