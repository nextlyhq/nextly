/**
 * POST /auth/forgot-password
 * Generates a password reset token and sends email.
 * Always returns success to prevent email enumeration.
 */
// CSRF double-submit cookie + origin check. Restored after c80d2982
// reverted the earlier restore in 4bc0d9ee. See docs/auth/csrf.md.
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";

import { jsonResponse, stallResponse } from "./handler-utils.js";

export interface ForgotPasswordHandlerDeps {
  allowedOrigins: string[];
  loginStallTimeMs: number;
  generatePasswordResetToken: (
    email: string,
    redirectPath?: string
  ) => Promise<{ success: boolean; token?: string }>;
}

export async function handleForgotPassword(
  request: Request,
  deps: ForgotPasswordHandlerDeps
): Promise<Response> {
  const startTime = Date.now();

  const body = await request.json();

  // Validate CSRF before any side-effect. Stall response to keep timing
  // uniform with the success path (anti-enumeration).
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
    return jsonResponse(403, {
      error: { code: "CSRF_FAILED", message: csrfResult.error },
    });
  }

  const { email, redirectPath } = body;
  if (!email) {
    await stallResponse(startTime, deps.loginStallTimeMs);
    return jsonResponse(400, {
      error: { code: "VALIDATION_ERROR", message: "Email is required" },
    });
  }

  // Always returns success to prevent email enumeration.
  await deps.generatePasswordResetToken(email, redirectPath);

  await stallResponse(startTime, deps.loginStallTimeMs);
  return jsonResponse(200, {
    data: {
      success: true,
      message: "If the email exists, a reset link has been sent",
    },
  });
}
