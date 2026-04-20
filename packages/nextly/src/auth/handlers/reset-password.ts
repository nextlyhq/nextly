/**
 * POST /auth/reset-password
 * Resets password using a valid reset token.
 * Revokes all refresh tokens for the user (force re-login on all devices).
 */
// CSRF double-submit cookie + origin check. The URL token is already an
// unguessable secret, but CSRF still prevents cross-origin abuse of the
// authenticated password-reset form. See docs/auth/csrf.md.
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";

import { jsonResponse } from "./handler-utils.js";

export interface ResetPasswordHandlerDeps {
  allowedOrigins: string[];
  resetPasswordWithToken: (
    token: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string; email?: string }>;
  deleteAllRefreshTokensForUser: (userId: string) => Promise<void>;
  findUserByEmail: (email: string) => Promise<{ id: string } | null>;
}

export async function handleResetPassword(
  request: Request,
  deps: ResetPasswordHandlerDeps
): Promise<Response> {
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

  const { token, newPassword } = body;
  if (!token || !newPassword) {
    return jsonResponse(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Token and new password are required",
      },
    });
  }

  const result = await deps.resetPasswordWithToken(token, newPassword);

  if (!result.success) {
    return jsonResponse(400, {
      error: {
        code: "RESET_FAILED",
        message: result.error || "Invalid or expired token",
      },
    });
  }

  // Revoke all refresh tokens for this user (password changed)
  if (result.email) {
    const user = await deps.findUserByEmail(result.email);
    if (user) {
      await deps.deleteAllRefreshTokensForUser(user.id);
    }
  }

  return jsonResponse(200, { data: { success: true } });
}
