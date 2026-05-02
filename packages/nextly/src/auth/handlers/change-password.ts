/**
 * PATCH /auth/change-password
 * Changes password for the currently authenticated user.
 * Revokes all refresh tokens (force re-login on all devices).
 */
// CSRF double-submit cookie + origin check. This endpoint is the highest-
// value target for account takeover, so CSRF is non-negotiable here.
// See docs/auth/csrf.md.
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { clearAccessTokenCookie } from "../cookies/access-token-cookie";
import { clearRefreshTokenCookie } from "../cookies/refresh-token-cookie";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
import { getSession } from "../session/get-session";

import { jsonResponse, buildCookieHeaders } from "./handler-utils";

export interface ChangePasswordHandlerDeps {
  secret: string;
  allowedOrigins: string[];
  changePassword: (
    userId: string,
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  deleteAllRefreshTokensForUser: (userId: string) => Promise<void>;
  /** Audit M10 / T-022: writer for security-sensitive auth events. */
  auditLog: AuditLogWriter;
  /** Audit C4 / T-005. */
  trustProxy: boolean;
  /** Audit C4 / T-005. */
  trustedProxyIps: string[];
}

export async function handleChangePassword(
  request: Request,
  deps: ChangePasswordHandlerDeps
): Promise<Response> {
  const sessionResult = await getSession(request, deps.secret);
  if (!sessionResult.authenticated) {
    return jsonResponse(401, {
      error: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
  }

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
    return jsonResponse(403, {
      error: { code: "CSRF_FAILED", message: csrfResult.error },
    });
  }

  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return jsonResponse(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Current password and new password are required",
      },
    });
  }

  const result = await deps.changePassword(
    sessionResult.user.id,
    currentPassword,
    newPassword
  );

  if (!result.success) {
    return jsonResponse(400, {
      error: { code: "PASSWORD_CHANGE_FAILED", message: result.error },
    });
  }

  // Revoke all sessions (force re-login on all devices)
  await deps.deleteAllRefreshTokensForUser(sessionResult.user.id);

  // Audit M10 / T-022: actor and target are the same user — change-password
  // is always self-service in this handler. (Admin-driven password reset
  // for another user runs through reset-password and gets its own audit
  // hook in a follow-up.)
  await deps.auditLog.write({
    kind: "password-changed",
    actorUserId: sessionResult.user.id,
    targetUserId: sessionResult.user.id,
    ipAddress: getTrustedClientIp(request, {
      trustProxy: deps.trustProxy,
      trustedProxyIps: deps.trustedProxyIps,
    }),
    userAgent: request.headers.get("user-agent"),
  });

  const clearCookies = [clearAccessTokenCookie(), clearRefreshTokenCookie()];

  return new Response(JSON.stringify({ data: { success: true } }), {
    status: 200,
    headers: buildCookieHeaders(clearCookies),
  });
}
