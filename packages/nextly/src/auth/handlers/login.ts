import { readOrGenerateRequestId } from "../../api/request-id";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { auditReason } from "../../domains/audit/audit-reasons";
import { NextlyError } from "../../errors/nextly-error";
import type { AuthUser } from "../../types/auth";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
import type { AuthHookRegistry } from "../pipeline/hooks";
import { provenPasswordVersion } from "../pipeline/password-strategy";
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
  loginFailureResponse,
  recordLoginFailure,
} from "./handler-utils";
import {
  issueSession,
  challengeResponse,
  gateAccountForSession,
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
    /** Null for an account that authenticates through an external provider. */
    passwordHash: string | null;
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
  claims: {
    userId: string;
    challengeId: string;
    strategy?: string;
    passwordUpdatedAt?: Date | null;
  }
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
      // Epoch milliseconds in the token; the session the answer mints is
      // judged against it (see `PendingClaims.passwordUpdatedAt`).
      passwordUpdatedAt:
        claims.passwordUpdatedAt === undefined ||
        claims.passwordUpdatedAt === null
          ? claims.passwordUpdatedAt
          : claims.passwordUpdatedAt.getTime(),
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
    mustChangePassword: boolean;
    /** The password version the session will be judged against. */
    passwordUpdatedAt: Date | null;
  }
): Promise<LoginContinuation> {
  const { afterAuth, strategy, requestId, mustChangePassword } = args;

  if (afterAuth && typeof afterAuth === "object" && "challenge" in afterAuth) {
    const ch = afterAuth.challenge;
    const pendingToken = await pauseWithPendingToken(deps, {
      userId: ch.userId,
      challengeId: ch.id,
      strategy,
      // Carried to the session the answer mints: a password set while the
      // second factor is outstanding ends the sign-in the old one started.
      passwordUpdatedAt: args.passwordUpdatedAt,
    });
    return { interrupted: challengeResponse(ch, pendingToken, requestId) };
  }

  if (mustChangePassword) {
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
  // Declared outside the try so the failure row can name the method: once a
  // strategy has decided, a refusal from the account gate or a hook still
  // belongs to that method's attempt.
  let strategy: string | undefined;

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
    strategy = strategyName ?? undefined;

    if (outcome.type === "pass" || outcome.type === "fail") {
      // No strategy claimed the request → unified invalid-credentials 401
      // (same wire shape + stall + audit as the legacy missing-credentials leg).
      throw noStrategyAccepted(outcome, strategy);
    }

    if (outcome.type === "challenge") {
      // The SAME gate the session path runs, asked before the flow is
      // minted: a challenge for an account the gate would refuse gave the
      // person a second-factor prompt to solve before the refusal arrived,
      // and sent the code the challenge exists to verify. The password
      // lockout stays a password-strategy concern, as it is at session time.
      const challengedState = await gateAccountForSession(
        deps,
        outcome.challenge.userId,
        strategy
      );
      const pendingToken = await pauseWithPendingToken(deps, {
        userId: outcome.challenge.userId,
        challengeId: outcome.challenge.id,
        strategy,
        passwordUpdatedAt: challengedState.passwordUpdatedAt,
      });
      await stallResponse(startTime, deps.loginStallTimeMs);
      return challengeResponse(outcome.challenge, pendingToken, requestId);
    }

    // outcome.type === "authenticated"
    // Before hooks or continuations: an afterAuthenticate hook may send a
    // code, and a continuation may pause the login — both are work done for
    // an account the session gate would refuse, and refusing only at session
    // time meant the person solved a challenge before learning they could
    // not sign in.
    const accountState = await gateAccountForSession(
      deps,
      outcome.user.id,
      strategy
    );
    // The password version this sign-in earned its session against: the one
    // the password strategy proved, read in the same row as the hash it
    // compared, or for any other strategy the one the gate just read. A
    // password set after it refuses the session at its refresh-row write.
    const proven = provenPasswordVersion(outcome.user);
    const passwordUpdatedAt =
      proven !== undefined ? proven : accountState.passwordUpdatedAt;
    const afterAuth = await deps.authHooks.runAfterAuthenticate(
      outcome.user,
      deps.pluginCtx
    );
    const continuation = await interruptedLogin(deps, {
      afterAuth,
      strategy,
      requestId,
      // The PERSISTED flag, not the hook-threaded one: an afterAuthenticate
      // hook that returns a fresh user object without copying the optional
      // field silently skipped the forced change, and the session gate does
      // not re-read it — an admin-set temporary password stayed usable
      // through a benign profile-transforming hook.
      mustChangePassword: accountState.mustChangePassword === true,
      passwordUpdatedAt,
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
      { strategy, passwordUpdatedAt }
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
    // internal) records one 'login-failed' event, the same way every other
    // sign-in path records it.
    await recordLoginFailure(deps, request, err, requestId, strategy);
    return loginFailureResponse(err, requestId);
  }
}
