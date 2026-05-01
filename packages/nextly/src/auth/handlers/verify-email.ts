// CSRF is enforced on /resend (state-changing, sends email, cross-origin
// abusable). It is NOT enforced on /verify-email proper because the URL
// token is itself the unguessable secret. See docs/auth/csrf.md.
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";

import { jsonResponse } from "./handler-utils";

export interface VerifyEmailHandlerDeps {
  allowedOrigins: string[];
  verifyEmail: (
    token: string
  ) => Promise<{ success: boolean; error?: string; email?: string }>;
  resendVerificationEmail: (
    email: string
  ) => Promise<{ success: boolean; error?: string }>;
}

export async function handleVerifyEmail(
  request: Request,
  deps: VerifyEmailHandlerDeps
): Promise<Response> {
  const body = await request.json();

  const { token } = body;
  if (!token) {
    return jsonResponse(400, {
      error: { code: "VALIDATION_ERROR", message: "Token is required" },
    });
  }

  const result = await deps.verifyEmail(token);

  if (!result.success) {
    return jsonResponse(400, {
      error: {
        code: "VERIFICATION_FAILED",
        message: result.error || "Invalid or expired token",
      },
    });
  }

  return jsonResponse(200, {
    data: { success: true, email: result.email },
  });
}

export async function handleResendVerification(
  request: Request,
  deps: VerifyEmailHandlerDeps
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

  const { email } = body;
  if (!email) {
    return jsonResponse(400, {
      error: { code: "VALIDATION_ERROR", message: "Email is required" },
    });
  }

  // Always returns success to prevent enumeration
  await deps.resendVerificationEmail(email);

  return jsonResponse(200, {
    data: {
      success: true,
      message: "If the email exists, a verification link has been sent",
    },
  });
}
