/**
 * PATCH /auth/change-password
 * Changes password for the currently authenticated user.
 * Revokes all refresh tokens (force re-login on all devices).
 */
// CSRF double-submit cookie + origin check. This endpoint is the highest-
// value target for account takeover, so CSRF is non-negotiable here.
// See docs/auth/csrf.md.
import { clearAccessTokenCookie } from "../cookies/access-token-cookie.js";
import { clearRefreshTokenCookie } from "../cookies/refresh-token-cookie.js";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";
import { getSession } from "../session/get-session.js";

import { jsonResponse, buildCookieHeaders } from "./handler-utils.js";

export interface ChangePasswordHandlerDeps {
  secret: string;
  allowedOrigins: string[];
  changePassword: (
    userId: string,
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  deleteAllRefreshTokensForUser: (userId: string) => Promise<void>;
}

export async function handleChangePassword(
  request: Request,
  deps: ChangePasswordHandlerDeps
): Promise<Response> {
  const sessionResult = await getSession(request, deps.secret);
  if (!sessionResult.authenticated) {
    return jsonResponse(401, {
      error: { code: "UNAUTHENTICATED", message: "Authentication required" },
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

  const clearCookies = [clearAccessTokenCookie(), clearRefreshTokenCookie()];

  return new Response(JSON.stringify({ data: { success: true } }), {
    status: 200,
    headers: buildCookieHeaders(clearCookies),
  });
}
