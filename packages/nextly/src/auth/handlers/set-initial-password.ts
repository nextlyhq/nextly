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
import { NextlyError } from "../../errors/nextly-error";
import type { AuthUser } from "../../types/auth";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
import {
  MUST_CHANGE_PASSWORD_CHALLENGE,
  verifyPendingToken,
} from "../pipeline/pending-token";

import {
  jsonResponse,
  stallResponse,
  buildAuthErrorResponse,
} from "./handler-utils";
import { issueSession, type IssueSessionDeps } from "./issue-session";

export interface SetInitialPasswordDeps extends IssueSessionDeps {
  allowedOrigins: string[];
  loginStallTimeMs: number;
  auditLog: AuditLogWriter;
  /**
   * Replaces the admin-set password and clears the must-change flag. Throws
   * NextlyError(VALIDATION_ERROR) on a weak password and NextlyError(INVALID_INPUT)
   * when the account is no longer in the must-change state.
   */
  setInitialPassword: (
    userId: string,
    newPassword: string
  ) => Promise<{ userId: string }>;
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

  try {
    const raw: unknown = await request.json().catch(() => null);
    const body: Record<string, unknown> =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

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
        logContext: { reason: "pending-token-invalid" },
      });
    }
    if (pending.challengeId !== MUST_CHANGE_PASSWORD_CHALLENGE) {
      throw NextlyError.invalidCredentials({
        logContext: { reason: "pending-token-wrong-challenge" },
      });
    }

    try {
      await deps.setInitialPassword(pending.userId, newPassword);
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
            reason: "not-in-must-change-state",
          },
        });
      }
      throw err;
    }

    const u = await deps.findUserById(pending.userId);
    if (!u || !u.isActive) {
      throw NextlyError.invalidCredentials({
        logContext: { userId: pending.userId, reason: "user-missing" },
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
