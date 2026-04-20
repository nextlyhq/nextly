/**
 * POST /auth/register
 * Registers a new user account.
 * Does NOT auto-login -- user must verify email first (if required).
 */
// CSRF double-submit cookie + origin check. Prevents cross-site forced
// account creation. See docs/auth/csrf.md.
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";

import { jsonResponse } from "./handler-utils.js";

export interface RegisterHandlerDeps {
  allowedOrigins: string[];
  registerUser: (data: {
    email: string;
    password: string;
    name: string;
  }) => Promise<{
    success: boolean;
    user?: { id: string; email: string; name: string };
    error?: string;
  }>;
}

export async function handleRegister(
  request: Request,
  deps: RegisterHandlerDeps
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

  const { email, password, name } = body;
  if (!email || !password || !name) {
    return jsonResponse(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Email, password, and name are required",
      },
    });
  }

  const result = await deps.registerUser({ email, password, name });

  if (!result.success) {
    return jsonResponse(400, {
      error: { code: "REGISTRATION_FAILED", message: result.error },
    });
  }

  return jsonResponse(201, { data: { user: result.user } });
}
