import { readOrGenerateRequestId } from "../../api/request-id";
import { auditFailureMetadata } from "../../domains/audit/audit-log-writer";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { auditReason } from "../../domains/audit/audit-reasons";
import { NextlyError } from "../../errors/nextly-error";
import type { AuthUser } from "../../types/auth";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import {
  clearPendingCookie,
  readPendingCookie,
  setPendingCookie,
} from "../cookies/pending-cookie";
import type { ChallengeRegistry } from "../pipeline/challenge";
import {
  mintPendingToken,
  verifyPendingToken,
  MUST_CHANGE_PASSWORD_CHALLENGE,
} from "../pipeline/pending-token";

import {
  jsonResponse,
  stallResponse,
  buildAuthErrorResponse,
  csrfRefusal,
} from "./handler-utils";
import { issueSession, type IssueSessionDeps } from "./issue-session";

export interface ChallengeResolveDeps extends IssueSessionDeps {
  challengeRegistry: ChallengeRegistry;
  /** Pending-auth token TTL (seconds) for re-issued tokens between attempts. */
  challengeTokenTTL: number;
  /** Max attempts before a challenge fails for good. */
  maxChallengeAttempts: number;
  /**
   * Counts one attempt against a challenge, server-side.
   *
   * The cap cannot be carried in the pending token: minting a replacement does
   * not invalidate the one that was presented, so a caller could resubmit the
   * original `attempts: 0` token after every wrong answer and guess until the
   * TTL expired. Counting against the CHALLENGE makes the cap hold whichever
   * token arrives.
   *
   * Injected so the rule is testable without a store, and defaulted to the
   * shared limiter's counter — a fixed window over a key is exactly what this
   * needs, and a second implementation of one is a second thing to get right.
   */
  countChallengeAttempt?: (
    challengeId: string,
    limit: number,
    windowMs: number
  ) => Promise<{ allowed: boolean }>;
  allowedOrigins: string[];
  loginStallTimeMs: number;
  auditLog: AuditLogWriter;
  findUserById: (userId: string) => Promise<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    isActive: boolean;
    mustChangePassword: boolean | null;
  } | null>;
}

/**
 * Hand a wrong answer back with a fresh token carrying the next attempt count.
 *
 * Where the token goes depends on how it arrived. A cookie-mode client never
 * sees it — returning it in the body would put it somewhere script can reach —
 * so the re-issued token replaces the cookie instead. Without that the next
 * attempt would replay the old counter and the cap would never bite.
 */
function retryResponse(args: {
  token: string;
  challengeId: string;
  usedCookie: boolean;
  requestId: string;
  challengeTokenTTL: number;
  isProduction: boolean;
}): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-request-id": args.requestId,
  });
  if (args.usedCookie) {
    headers.append(
      "Set-Cookie",
      setPendingCookie(args.token, args.challengeTokenTTL, args.isProduction)
    );
  }
  return new Response(
    JSON.stringify({
      status: "challenge",
      challengeType: args.challengeId,
      ...(args.usedCookie ? {} : { pendingToken: args.token }),
      error: "Invalid code.",
    }),
    { status: 401, headers }
  );
}

/**
 * Hand back the token that lets a must-change account replace its password.
 *
 * A challenge cleared by an account still holding an admin-set password does
 * not end in a session: it ends here, so the challenge path cannot be used to
 * skip the gate the login path enforces.
 */
async function passwordChangeRequired(
  deps: Pick<ChallengeResolveDeps, "secret" | "challengeTokenTTL">,
  args: {
    userId: string;
    strategy?: string;
    requestId: string;
    next?: string;
  }
): Promise<Response> {
  const pendingToken = await mintPendingToken(
    {
      userId: args.userId,
      challengeId: MUST_CHANGE_PASSWORD_CHALLENGE,
      attempts: 0,
      strategy: args.strategy,
      // Carried across. An external login signs its destination into the
      // pending token, and dropping it here sent the account to the dashboard
      // after setting a password instead of the page it asked for. Already
      // sanitized when it was first signed, so it is not re-derived from the
      // request.
      ...(args.next ? { next: args.next } : {}),
    },
    deps.secret,
    deps.challengeTokenTTL
  );
  return jsonResponse(
    200,
    { status: "password_change_required", pendingToken },
    { "x-request-id": args.requestId }
  );
}

/**
 * Answer a wrong challenge response: one more attempt, or a final refusal.
 *
 * The attempt counter lives in the token rather than in a row, so advancing it
 * means minting a new one — and the strategy has to be carried across, or a
 * second attempt would record the session as coming from the password path
 * whatever actually signed the person in.
 */
/**
 * Spend one attempt from this account's budget for this challenge.
 *
 * A PRECONDITION, so it runs before the answer is examined. Counting only
 * wrong answers left the budget unspent by a correct one, and the pending
 * token is a JWT that minting a replacement does not revoke — so replaying the
 * original `attempts: 0` token kept guessing, and whichever guess happened to
 * be right was accepted however many had come before it. Charging every
 * attempt is what makes `maxChallengeAttempts` a cap rather than a display.
 *
 * The count is held server-side because the token's own number is attacker
 * supplied. That number is still carried forward, for a client showing
 * progress, but it is not what enforces anything.
 */
async function spendChallengeAttempt(
  deps: Pick<
    ChallengeResolveDeps,
    "challengeTokenTTL" | "maxChallengeAttempts" | "countChallengeAttempt"
  >,
  pending: { userId: string; challengeId: string }
): Promise<void> {
  const count =
    deps.countChallengeAttempt ??
    (async (key: string, limit: number, windowMs: number) => {
      const { authRateLimiter } = await import("../middleware/rate-limiter");
      return authRateLimiter().check(key, limit, windowMs);
    });

  // Keyed by USER and challenge. `challengeId` names the challenge DEFINITION
  // — "totp" — so keying on it alone pooled every account's wrong answers into
  // one budget: a handful of failures by anyone locked out every user of that
  // challenge until the window expired.
  const verdict = await count(
    `${pending.userId}:${pending.challengeId}`,
    deps.maxChallengeAttempts,
    deps.challengeTokenTTL * 1000
  );
  if (!verdict.allowed) {
    throw NextlyError.invalidCredentials({
      logContext: { reason: auditReason("challenge-attempts-exhausted") },
    });
  }
}

async function wrongAnswer(
  deps: Pick<
    ChallengeResolveDeps,
    "secret" | "challengeTokenTTL" | "maxChallengeAttempts" | "isProduction"
  >,
  args: {
    pending: {
      userId: string;
      challengeId: string;
      attempts: number;
      strategy?: string;
    };
    usedCookie: boolean;
    requestId: string;
  }
): Promise<Response> {
  // The budget was already spent by `spendChallengeAttempt` before the answer
  // was examined; this only decides whether to offer another round.
  const nextAttempts = args.pending.attempts + 1;
  if (nextAttempts >= deps.maxChallengeAttempts) {
    throw NextlyError.invalidCredentials({
      logContext: { reason: auditReason("challenge-failed-final") },
    });
  }
  const reissued = await mintPendingToken(
    {
      userId: args.pending.userId,
      challengeId: args.pending.challengeId,
      attempts: nextAttempts,
      strategy: args.pending.strategy,
    },
    deps.secret,
    deps.challengeTokenTTL
  );
  return retryResponse({
    token: reissued,
    challengeId: args.pending.challengeId,
    usedCookie: args.usedCookie,
    requestId: args.requestId,
    challengeTokenTTL: deps.challengeTokenTTL,
    isProduction: deps.isProduction,
  });
}

/**
 * POST /auth/challenge/resolve — complete a multi-step auth challenge (D71).
 *
 * Validates the single-purpose pending-auth token, enforces the attempt cap,
 * dispatches to the challenge definition's `resolve`, and — on success — loads
 * the candidate user and issues the real session via the shared
 * {@link issueSession} path (so the session is identical to a direct login).
 * On a wrong response it re-issues a pending token with an incremented attempt
 * counter until the cap is hit. CSRF + stall + audit mirror the login handler.
 */
export async function handleChallengeResolve(
  request: Request,
  deps: ChallengeResolveDeps
): Promise<Response> {
  const startTime = Date.now();
  const requestId = readOrGenerateRequestId(request);

  try {
    const body = (await request.json()) as Record<string, unknown>;

    const refusal = csrfRefusal(request, body, deps, requestId);
    if (refusal) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      return refusal;
    }

    // Body or cookie. An external login redirected the browser here, so its
    // pending token lives in an HttpOnly cookie rather than in a variable the
    // page could have kept — see auth/cookies/pending-cookie.
    const cookieToken = readPendingCookie(request);
    const usedCookie =
      typeof body.pendingToken !== "string" && cookieToken !== null;
    const pendingTokenInput =
      typeof body.pendingToken === "string"
        ? body.pendingToken
        : (cookieToken ?? "");
    const challengeResponse = (body.response ?? {}) as Record<string, unknown>;

    let pending;
    try {
      pending = await verifyPendingToken(pendingTokenInput, deps.secret);
    } catch {
      throw NextlyError.invalidCredentials({
        logContext: { reason: auditReason("pending-token-invalid") },
      });
    }

    if (pending.attempts >= deps.maxChallengeAttempts) {
      throw NextlyError.invalidCredentials({
        logContext: { reason: auditReason("challenge-attempts-exhausted") },
      });
    }

    // BEFORE the answer is examined. Spending the budget only on a wrong
    // answer left a correct one free, and a replayed token could therefore
    // keep guessing until one landed.
    await spendChallengeAttempt(deps, pending);

    const result = await deps.challengeRegistry.resolve(
      pending.challengeId,
      { userId: pending.userId, response: challengeResponse },
      deps.pluginCtx
    );

    if (!result.ok) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      return wrongAnswer(deps, {
        pending,
        usedCookie,
        requestId,
      });
    }

    // Challenge resolved → load the candidate user and issue the real session.
    // This early check stays: `issueSession` runs the full account-state gate
    // as well, but refusing here keeps this path's response timing and its
    // own audit reason, which the generic gate does not carry.
    const u = await deps.findUserById(pending.userId);
    if (!u || !u.isActive) {
      throw NextlyError.invalidCredentials({
        logContext: { reason: auditReason("challenge-user-missing") },
      });
    }

    // Forced first-sign-in password change (ASVS 6.4.1) applies here too: a
    // must-change account that clears a post-auth challenge (e.g. 2FA) must
    // still replace its admin-set password before any session is issued, or the
    // challenge path would bypass the gate the login path enforces.
    if (u.mustChangePassword) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      return passwordChangeRequired(deps, {
        userId: u.id,
        strategy: pending.strategy,
        requestId,
        next: pending.next,
      });
    }

    const user: AuthUser = {
      id: u.id as AuthUser["id"],
      email: u.email,
      name: u.name,
      image: u.image,
    };
    // The strategy the pending token carries, not this handler's own: the
    // method that signed the person in is the one that authenticated them,
    // not the one that answered the challenge.
    const response = await issueSession(user, deps, request, requestId, {
      strategy: pending.strategy,
      // Where the login was headed before the challenge interrupted it. It was
      // sanitized before being signed into the token, so it is a safe path.
      next: pending.next,
    });
    // The challenge is settled either way, so the pending cookie has no reason
    // to survive it; leaving it would let a stale token be replayed.
    response.headers.append("Set-Cookie", clearPendingCookie());
    await stallResponse(startTime, deps.loginStallTimeMs);
    return response;
  } catch (err) {
    await stallResponse(startTime, deps.loginStallTimeMs);
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
