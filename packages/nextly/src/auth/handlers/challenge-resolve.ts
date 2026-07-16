import { readOrGenerateRequestId } from "../../api/request-id";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors/nextly-error";
import type { AuthUser } from "../../types/auth";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
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
} from "./handler-utils";
import { issueSession, type IssueSessionDeps } from "./issue-session";

export interface ChallengeResolveDeps extends IssueSessionDeps {
  challengeRegistry: ChallengeRegistry;
  /** Pending-auth token TTL (seconds) for re-issued tokens between attempts. */
  challengeTokenTTL: number;
  /** Max attempts before a challenge fails for good. */
  maxChallengeAttempts: number;
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
      return jsonResponse(
        403,
        { error: { code: "CSRF_FAILED", message: csrfResult.error } },
        { "x-request-id": requestId }
      );
    }

    const pendingTokenInput =
      typeof body.pendingToken === "string" ? body.pendingToken : "";
    const challengeResponse = (body.response ?? {}) as Record<string, unknown>;

    let pending;
    try {
      pending = await verifyPendingToken(pendingTokenInput, deps.secret);
    } catch {
      throw NextlyError.invalidCredentials({
        logContext: { reason: "pending-token-invalid" },
      });
    }

    if (pending.attempts >= deps.maxChallengeAttempts) {
      throw NextlyError.invalidCredentials({
        logContext: { reason: "challenge-attempts-exhausted" },
      });
    }

    const result = await deps.challengeRegistry.resolve(
      pending.challengeId,
      { userId: pending.userId, response: challengeResponse },
      deps.pluginCtx
    );

    if (!result.ok) {
      const nextAttempts = pending.attempts + 1;
      await stallResponse(startTime, deps.loginStallTimeMs);
      if (nextAttempts >= deps.maxChallengeAttempts) {
        // Out of attempts — fail for good (generic 401).
        throw NextlyError.invalidCredentials({
          logContext: { reason: "challenge-failed-final" },
        });
      }
      // Re-issue a fresh pending token carrying the incremented counter.
      const reissued = await mintPendingToken(
        {
          userId: pending.userId,
          challengeId: pending.challengeId,
          attempts: nextAttempts,
        },
        deps.secret,
        deps.challengeTokenTTL
      );
      return new Response(
        JSON.stringify({
          status: "challenge",
          challengeType: pending.challengeId,
          pendingToken: reissued,
          error: "Invalid code.",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": requestId,
          },
        }
      );
    }

    // Challenge resolved → load the candidate user and issue the real session.
    const u = await deps.findUserById(pending.userId);
    if (!u || !u.isActive) {
      throw NextlyError.invalidCredentials({
        logContext: { reason: "challenge-user-missing" },
      });
    }

    // Forced first-sign-in password change (ASVS 6.4.1) applies here too: a
    // must-change account that clears a post-auth challenge (e.g. 2FA) must
    // still replace its admin-set password before any session is issued, or the
    // challenge path would bypass the gate the login path enforces.
    if (u.mustChangePassword) {
      const pwPendingToken = await mintPendingToken(
        {
          userId: u.id,
          challengeId: MUST_CHANGE_PASSWORD_CHALLENGE,
          attempts: 0,
        },
        deps.secret,
        deps.challengeTokenTTL
      );
      await stallResponse(startTime, deps.loginStallTimeMs);
      return jsonResponse(
        200,
        { status: "password_change_required", pendingToken: pwPendingToken },
        { "x-request-id": requestId }
      );
    }

    const user: AuthUser = {
      id: u.id as AuthUser["id"],
      email: u.email,
      name: u.name,
      image: u.image,
    };
    const response = await issueSession(user, deps, request, requestId);
    await deps.authHooks.runAfterLogin(user, deps.pluginCtx);
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
