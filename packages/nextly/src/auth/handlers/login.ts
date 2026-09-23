import { readOrGenerateRequestId } from "../../api/request-id";
import { auditFailureMetadata } from "../../domains/audit/audit-log-writer";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { auditReason } from "../../domains/audit/audit-reasons";
import { NextlyError } from "../../errors/nextly-error";
import type { AuthUser } from "../../types/auth";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
import type { AuthHookRegistry } from "../pipeline/hooks";
import {
  mintPendingToken,
  MUST_CHANGE_PASSWORD_CHALLENGE,
  newChallengeFlowId,
} from "../pipeline/pending-token";
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

/**
 * Pause a login and hand back the token that will resume it.
 *
 * Three paths stop a login short of a session — a strategy's own challenge, a
 * second factor added by a hook, and a forced first-sign-in password change —
 * and each needs a token carrying the same claims. Minting them in one place
 * is what keeps the attempt counter and the strategy on all three.
 */
async function pauseWithPendingToken(
  deps: Pick<LoginHandlerDeps, "secret" | "challengeTokenTTL">,
  claims: { userId: string; challengeId: string; strategy?: string }
): Promise<string> {
  return mintPendingToken(
    // A fresh FLOW per pause: each interrupted login is its own attempt
    // budget, so a login that finished does not spend the next one's cap.
    // The flow's EXPIRY is fixed here and carried unchanged by every
    // re-issue — the token's TTL renews on each wrong answer, and without a
    // non-resetting end, replaying old tokens near each window's edge kept
    // one flow guessing far past the cap.
    {
      ...claims,
      attempts: 0,
      flow: newChallengeFlowId(),
      flowExpiresAt: Math.floor(Date.now() / 1000) + deps.challengeTokenTTL,
    },
    deps.secret,
    deps.challengeTokenTTL
  );
}

/**
 * Either the response that stops this login short of a session, or the user it
 * should continue with. One shape or the other, so the caller cannot read a
 * challenge as a signed-in user.
 */
type LoginContinuation = { interrupted: Response } | { user: AuthUser };

/**
 * Whatever stops an authenticated login short of a session, if anything.
 *
 * Two things can: a second factor added by an `afterAuthenticate` hook, and an
 * account still holding a password an admin chose for it (ASVS 6.4.1). Both
 * answer with a short-lived single-purpose token the access guard refuses for
 * any ordinary request, so neither leaves a usable session behind.
 */
async function interruptedLogin(
  deps: Pick<LoginHandlerDeps, "secret" | "challengeTokenTTL">,
  args: {
    afterAuth: Awaited<ReturnType<AuthHookRegistry["runAfterAuthenticate"]>>;
    strategy?: string;
    requestId: string;
  }
): Promise<LoginContinuation> {
  const { afterAuth, strategy, requestId } = args;

  if (afterAuth && typeof afterAuth === "object" && "challenge" in afterAuth) {
    const ch = afterAuth.challenge;
    const pendingToken = await pauseWithPendingToken(deps, {
      userId: ch.userId,
      challengeId: ch.id,
      strategy,
    });
    return { interrupted: challengeResponse(ch, pendingToken, requestId) };
  }

  if (afterAuth.mustChangePassword) {
    const pendingToken = await pauseWithPendingToken(deps, {
      userId: afterAuth.id,
      challengeId: MUST_CHANGE_PASSWORD_CHALLENGE,
      strategy,
    });
    return {
      interrupted: jsonResponse(
        200,
        { status: "password_change_required", pendingToken },
        { "x-request-id": requestId }
      ),
    };
  }

  return { user: afterAuth };
}

/**
 * The refusal when no strategy signed the request in.
 *
 * A strategy that explicitly failed is a fact this package states, so the
 * recorded event keeps it. A strategy is application code and its own text is
 * free-form, so that travels under a separate key which reaches the operator
 * log and stops there, rather than displacing the one value the audit trail is
 * allowed to retain.
 */
function noStrategyAccepted(
  outcome: { type: "pass" } | { type: "fail"; reason?: string },
  strategy?: string
): NextlyError {
  return NextlyError.invalidCredentials({
    logContext: {
      reason:
        outcome.type === "fail"
          ? auditReason("strategy-fail")
          : auditReason("no-strategy-matched"),
      ...(outcome.type === "fail" && outcome.reason !== undefined
        ? { strategyReason: outcome.reason }
        : {}),
      ...(strategy ? { strategy } : {}),
    },
  });
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
    const { outcome, strategyName } = await runStrategyChain(
      deps.authStrategies,
      { request, body },
      deps.pluginCtx
    );
    // Whichever strategy decided, recorded on both the success and the failure
    // row. A trail that says only "a login failed" cannot answer which method
    // was tried, which is the question an operator has after a breach.
    const strategy = strategyName ?? undefined;

    if (outcome.type === "pass" || outcome.type === "fail") {
      // No strategy claimed the request → unified invalid-credentials 401
      // (same wire shape + stall + audit as the legacy missing-credentials leg).
      throw noStrategyAccepted(outcome, strategy);
    }

    if (outcome.type === "challenge") {
      const pendingToken = await pauseWithPendingToken(deps, {
        userId: outcome.challenge.userId,
        challengeId: outcome.challenge.id,
        strategy,
      });
      await stallResponse(startTime, deps.loginStallTimeMs);
      return challengeResponse(outcome.challenge, pendingToken, requestId);
    }

    // outcome.type === "authenticated"
    const afterAuth = await deps.authHooks.runAfterAuthenticate(
      outcome.user,
      deps.pluginCtx
    );
    const continuation = await interruptedLogin(deps, {
      afterAuth,
      strategy,
      requestId,
    });
    if ("interrupted" in continuation) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      return continuation.interrupted;
    }

    const response = await issueSession(
      continuation.user,
      deps,
      request,
      requestId,
      { strategy }
    );
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
    // leak the unified error wire shape collapses. The row keeps only values
    // this package controls — a failure is recorded with no actor precisely so
    // it cannot say which account was reached, which also means nothing links
    // it to a person and no later deletion can find it, so an identifier must
    // not enter rather than be erased afterwards. The specific cause reaches
    // the operator through the log instead.
    await deps.auditLog.write({
      kind: "login-failed",
      ipAddress: getTrustedClientIp(request, {
        trustProxy: deps.trustProxy,
        trustedProxyIps: deps.trustedProxyIps,
      }),
      userAgent: request.headers.get("user-agent"),
      metadata: auditFailureMetadata(err, requestId),
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
