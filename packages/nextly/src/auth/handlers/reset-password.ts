/**
 * POST /auth/reset-password
 *
 * Resets password using a valid reset token. Per spec §13.4, all token-related
 * failure modes (expired, unknown, used) collapse into a single response:
 * 400 INVALID_INPUT / "This reset link is invalid or has expired." Internal
 * details (which leg actually failed) live only in logContext.
 *
 * On success, revokes all refresh tokens for the user (force re-login on
 * all devices).
 */
// CSRF double-submit cookie + origin check. The URL token is already an
// unguessable secret, but CSRF still prevents cross-origin abuse of the
// authenticated password-reset form. See docs/auth/csrf.md.
import { readOrGenerateRequestId } from "../../api/request-id.js";
import { NextlyError } from "../../errors/nextly-error.js";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";

import { jsonResponse } from "./handler-utils.js";

export interface ResetPasswordHandlerDeps {
  allowedOrigins: string[];
  /**
   * Throws NextlyError on failure (any token-related failure, including
   * expired / unknown / used, must be normalised by the caller into the
   * INVALID_INPUT shape). Returns the user's email on success so the caller
   * can wipe their refresh tokens.
   */
  resetPasswordWithToken: (
    token: string,
    newPassword: string
  ) => Promise<{ email: string }>;
  deleteAllRefreshTokensForUser: (userId: string) => Promise<void>;
  findUserByEmail: (email: string) => Promise<{ id: string } | null>;
}

function buildResetErrorResponse(
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

/**
 * Collapse all token-related failures (expired, unknown, used) into the
 * spec §13.4 unified response. Anything else (DB outage, etc.) propagates.
 */
function normaliseTokenFailure(err: unknown): NextlyError {
  if (NextlyError.is(err)) {
    if (
      err.code === "NOT_FOUND" ||
      err.code === "INVALID_INPUT" ||
      err.code === "TOKEN_EXPIRED" ||
      err.code === "VALIDATION_ERROR"
    ) {
      return new NextlyError({
        code: "INVALID_INPUT",
        publicMessage: "This reset link is invalid or has expired.",
        logContext: {
          ...(err.logContext ?? {}),
          originalCode: err.code,
        },
      });
    }
  }
  // Not a token-related failure — caller handles (typically rethrow).
  throw err;
}

export async function handleResetPassword(
  request: Request,
  deps: ResetPasswordHandlerDeps
): Promise<Response> {
  const requestId = readOrGenerateRequestId(request);

  try {
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
      return jsonResponse(
        403,
        { error: { code: "CSRF_FAILED", message: csrfResult.error } },
        { "x-request-id": requestId }
      );
    }

    const { token, newPassword } = body;
    if (!token || !newPassword) {
      throw NextlyError.validation({
        errors: [
          ...(!token
            ? [{ path: "token", code: "REQUIRED", message: "Required." }]
            : []),
          ...(!newPassword
            ? [{ path: "newPassword", code: "REQUIRED", message: "Required." }]
            : []),
        ],
      });
    }

    let result: { email: string };
    try {
      result = await deps.resetPasswordWithToken(token, newPassword);
    } catch (err) {
      // normaliseTokenFailure either returns the unified INVALID_INPUT error
      // or re-throws (for non-token failures). The thrown re-throw is caught
      // by the outer catch.
      throw normaliseTokenFailure(err);
    }

    // Revoke all refresh tokens for this user (password changed)
    if (result.email) {
      const user = await deps.findUserByEmail(result.email);
      if (user) {
        await deps.deleteAllRefreshTokensForUser(user.id);
      }
    }

    return new Response(JSON.stringify({ data: { success: true } }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    if (NextlyError.is(err)) {
      return buildResetErrorResponse(err, requestId);
    }
    return buildResetErrorResponse(
      NextlyError.internal({ cause: err as Error }),
      requestId
    );
  }
}
