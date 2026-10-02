/**
 * POST /auth/set-initial-password
 *
 * Completes the forced first-sign-in password change (ASVS 6.4.1). A user whose
 * account still holds an admin-set password is issued a single-purpose pending
 * token by the login handler instead of a session. Here they exchange that
 * token plus a new password for a real session: the password is replaced, the
 * must-change flag cleared, and a session issued in one step — so the admin-set
 * password never authorizes anything.
 *
 * A weak-password error is surfaced so the person can fix it; every other
 * failure (bad/expired token, account no longer in the must-change state)
 * collapses to a generic invalid-credentials response.
 */
import { readOrGenerateRequestId } from "../../api/request-id";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { auditReason } from "../../domains/audit/audit-reasons";
import { NextlyError } from "../../errors/nextly-error";
import type { AuthUser } from "../../types/auth";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { readPendingCookie } from "../cookies/pending-cookie";
import {
  MUST_CHANGE_PASSWORD_CHALLENGE,
  verifyPendingToken,
} from "../pipeline/pending-token";

import {
  stallResponse,
  csrfRefusal,
  loginFailureResponse,
  readJsonObjectBody,
  recordLoginFailure,
} from "./handler-utils";
import {
  gateAccountForSession,
  finishResumedSignIn,
  type IssueSessionDeps,
} from "./issue-session";

export interface SetInitialPasswordDeps extends IssueSessionDeps {
  allowedOrigins: string[];
  loginStallTimeMs: number;
  auditLog: AuditLogWriter;
  /**
   * Replaces the admin-set password and clears the must-change flag, and
   * returns the `passwordUpdatedAt` it wrote, read back as stored. Throws
   * NextlyError(VALIDATION_ERROR) on a weak password and NextlyError(INVALID_INPUT)
   * when the account is no longer in the must-change state.
   */
  setInitialPassword: (
    userId: string,
    newPassword: string
  ) => Promise<{ userId: string; passwordUpdatedAt: Date | null }>;
  findUserById: (userId: string) => Promise<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    isActive: boolean;
  } | null>;
}

export async function handleSetInitialPassword(
  request: Request,
  deps: SetInitialPasswordDeps
): Promise<Response> {
  const startTime = Date.now();
  const requestId = readOrGenerateRequestId(request);
  // Outside the try so the failure row names the method the paused login was
  // using, as the challenge path's does.
  let strategy: string | undefined;

  try {
    const body = await readJsonObjectBody(request);

    const refusal = csrfRefusal(request, body, deps, requestId);
    if (refusal) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      return refusal;
    }

    // Body or cookie, for the same reason as the challenge path: an external
    // login arrives here by redirect with its token in an HttpOnly cookie.
    const pendingTokenInput =
      typeof body.pendingToken === "string"
        ? body.pendingToken
        : (readPendingCookie(request) ?? "");
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";
    if (!pendingTokenInput || !newPassword) {
      throw NextlyError.validation({
        errors: [
          ...(pendingTokenInput
            ? []
            : [
                {
                  path: "pendingToken",
                  code: "REQUIRED",
                  message: "Required.",
                },
              ]),
          ...(newPassword
            ? []
            : [
                { path: "newPassword", code: "REQUIRED", message: "Required." },
              ]),
        ],
      });
    }

    let pending;
    try {
      pending = await verifyPendingToken(pendingTokenInput, deps.secret);
    } catch {
      throw NextlyError.invalidCredentials({
        logContext: { reason: auditReason("pending-token-invalid") },
      });
    }
    strategy = pending.strategy;
    if (pending.challengeId !== MUST_CHANGE_PASSWORD_CHALLENGE) {
      throw NextlyError.invalidCredentials({
        logContext: { reason: auditReason("pending-token-wrong-challenge") },
      });
    }

    // Before the password changes, not only at the session after it: an
    // account disabled or unverified since its pending token was issued must
    // not complete a change to its credentials. The session gate still runs
    // afterwards, for a change of state in between.
    await gateAccountForSession(deps, pending.userId, pending.strategy);

    let written;
    try {
      written = await deps.setInitialPassword(pending.userId, newPassword);
    } catch (err) {
      // Only a stale/replayed flow (the account is no longer in the must-change
      // state) collapses to the generic invalid-credentials response. A
      // validation error (weak or reused password) is actionable and passes
      // through; a database or unexpected error keeps its real status and
      // operator context rather than being masked as a 401.
      if (NextlyError.is(err) && err.code === "INVALID_INPUT") {
        throw NextlyError.invalidCredentials({
          logContext: {
            userId: pending.userId,
            reason: auditReason("not-in-must-change-state"),
          },
        });
      }
      throw err;
    }

    // Kept alongside the gate inside `issueSession` for the same reason as the
    // challenge path: this refusal has its own audit reason and response
    // timing, which the shared gate does not reproduce.
    const u = await deps.findUserById(pending.userId);
    if (!u || !u.isActive) {
      throw NextlyError.invalidCredentials({
        logContext: {
          userId: pending.userId,
          reason: auditReason("user-missing"),
        },
      });
    }
    const user: AuthUser = {
      id: u.id as AuthUser["id"],
      email: u.email,
      name: u.name,
      image: u.image,
    };

    await deps.auditLog.write({
      kind: "password-changed",
      actorUserId: u.id,
      targetUserId: u.id,
      ipAddress: getTrustedClientIp(request, {
        trustProxy: deps.trustProxy,
        trustedProxyIps: deps.trustedProxyIps,
      }),
      userAgent: request.headers.get("user-agent"),
    });

    return await finishResumedSignIn(
      user,
      deps,
      request,
      requestId,
      // The version this request wrote, not one read afterwards: a reset
      // committed between the change and the session would otherwise be the
      // version the session is judged against, and the session would
      // outlive it.
      {
        strategy: pending.strategy,
        next: pending.next,
        passwordUpdatedAt: written.passwordUpdatedAt?.getTime() ?? null,
      },
      startTime
    );
  } catch (err) {
    await stallResponse(startTime, deps.loginStallTimeMs);
    await recordLoginFailure(deps, request, err, requestId, strategy);
    return loginFailureResponse(err, requestId);
  }
}
