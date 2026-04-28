/**
 * POST /auth/forgot-password
 *
 * Per spec §13.3, always returns 200 with a generic message regardless of
 * whether the email matched a user. This prevents account enumeration via
 * the forgot-password endpoint.
 *
 * Generates a password reset token and sends email when the email is
 * registered; silently returns the same generic message when it is not.
 */
// CSRF double-submit cookie + origin check. Restored after c80d2982
// reverted the earlier restore in 4bc0d9ee. See docs/auth/csrf.md.
import { readOrGenerateRequestId } from "../../api/request-id.js";
import { NextlyError } from "../../errors/nextly-error.js";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";

import { jsonResponse, stallResponse } from "./handler-utils.js";

export interface ForgotPasswordHandlerDeps {
  allowedOrigins: string[];
  loginStallTimeMs: number;
  /**
   * Throws NextlyError on internal failure. The handler always swallows
   * NotFound / Invalid email lookups and returns the generic silent-success
   * message anyway — no caller-visible distinction between matched and
   * unmatched emails.
   */
  generatePasswordResetToken: (
    email: string,
    redirectPath?: string
  ) => Promise<{ token?: string }>;
}

const SILENT_MESSAGE =
  "If that email is in our records, you'll receive a reset link shortly.";

function buildForgotErrorResponse(
  err: NextlyError,
  requestId: string
): Response {
  return new Response(
    JSON.stringify({ error: err.toResponseJSON(requestId) }),
    {
      status: err.statusCode,
      headers: {
        "content-type": "application/problem+json",
        "x-request-id": requestId,
      },
    }
  );
}

export async function handleForgotPassword(
  request: Request,
  deps: ForgotPasswordHandlerDeps
): Promise<Response> {
  const startTime = Date.now();
  const requestId = readOrGenerateRequestId(request);

  try {
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
      return jsonResponse(
        403,
        { error: { code: "CSRF_FAILED", message: csrfResult.error } },
        { "x-request-id": requestId }
      );
    }

    const { email, redirectPath } = body;
    if (!email) {
      throw NextlyError.validation({
        errors: [{ path: "email", code: "REQUIRED", message: "Required." }],
      });
    }

    // Per spec §13.3: even if generatePasswordResetToken throws because the
    // email is unknown / invalid / locked / disabled, we silently swallow
    // and return the generic message. Internal infrastructure errors still
    // surface as 5xx so operators see them.
    try {
      await deps.generatePasswordResetToken(email, redirectPath);
    } catch (err) {
      if (
        NextlyError.is(err) &&
        (err.code === "NOT_FOUND" ||
          err.code === "AUTH_INVALID_CREDENTIALS" ||
          err.code === "VALIDATION_ERROR")
      ) {
        // Expected "no such email / cannot reset" cases. Swallow.
      } else {
        // Real failure (DB outage, mailer down, etc.). Re-throw so the
        // outer catch returns 5xx.
        throw err;
      }
    }

    await stallResponse(startTime, deps.loginStallTimeMs);
    return new Response(JSON.stringify({ data: { message: SILENT_MESSAGE } }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    await stallResponse(startTime, deps.loginStallTimeMs);
    if (NextlyError.is(err)) {
      return buildForgotErrorResponse(err, requestId);
    }
    return buildForgotErrorResponse(
      NextlyError.internal({ cause: err as Error }),
      requestId
    );
  }
}
