/**
 * POST /auth/accept-invite
 *
 * Accepts an invite link: the new person sets their own password, and the
 * account is verified, activated and signed-in-capable in one step. All
 * token-related failures (unknown, used, expired) collapse into a single
 * response so a guessed token learns nothing about which invites are live;
 * the real reason lives only in logContext.
 */
import { readOrGenerateRequestId } from "../../api/request-id";
import { respondAction } from "../../api/response-shapes";
import { NextlyError } from "../../errors/nextly-error";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";

import { jsonResponse } from "./handler-utils";

export interface AcceptInviteHandlerDeps {
  allowedOrigins: string[];
  /**
   * Throws NextlyError on failure. Any token-related failure (unknown, used,
   * expired) must be normalised by the caller into the INVALID_INPUT shape;
   * a weak password surfaces as VALIDATION_ERROR and is passed through so the
   * person sees what to fix.
   */
  acceptInvite: (
    token: string,
    newPassword: string
  ) => Promise<{ userId: string }>;
}

function buildErrorResponse(err: NextlyError, requestId: string): Response {
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

/** Field errors carried by a VALIDATION_ERROR, or null for any other shape. */
function validationFieldErrors(
  err: NextlyError
): ReadonlyArray<{ path: string }> | null {
  const data = err.publicData;
  if (data && "errors" in data && Array.isArray(data.errors)) {
    return data.errors;
  }
  return null;
}

/**
 * Collapse the token-not-usable failures (unknown, used, expired) into one
 * response. A weak-password validation error is deliberately left alone — the
 * token was fine, so hiding the real reason would only confuse the person, and
 * a password complaint reveals nothing about which invites are live.
 */
function normaliseInviteFailure(err: unknown): NextlyError {
  if (NextlyError.is(err)) {
    if (err.code === "VALIDATION_ERROR") {
      const fields = validationFieldErrors(err);
      const isTokenOnly =
        fields !== null && fields.every(e => e.path === "token");
      // A password (or other non-token) validation error is actionable — pass
      // it through untouched.
      if (!isTokenOnly) return err;
    }
    if (
      err.code === "NOT_FOUND" ||
      err.code === "INVALID_INPUT" ||
      err.code === "TOKEN_EXPIRED" ||
      err.code === "VALIDATION_ERROR"
    ) {
      return new NextlyError({
        code: "INVALID_INPUT",
        publicMessage: "This invite link is invalid or has expired.",
        logContext: { ...(err.logContext ?? {}), originalCode: err.code },
      });
    }
  }
  throw err;
}

export async function handleAcceptInvite(
  request: Request,
  deps: AcceptInviteHandlerDeps
): Promise<Response> {
  const requestId = readOrGenerateRequestId(request);

  try {
    // Untrusted input: a non-object body (null, an array, a number) must not
    // reach the destructure below, where it would throw an internal 500, and a
    // non-string token or password must not reach the service.
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
      return jsonResponse(
        403,
        { error: { code: "CSRF_FAILED", message: csrfResult.error } },
        { "x-request-id": requestId }
      );
    }

    const { token, newPassword } = body;
    const tokenMissing = typeof token !== "string" || token.length === 0;
    const passwordMissing =
      typeof newPassword !== "string" || newPassword.length === 0;
    if (tokenMissing || passwordMissing) {
      throw NextlyError.validation({
        errors: [
          ...(tokenMissing
            ? [{ path: "token", code: "REQUIRED", message: "Required." }]
            : []),
          ...(passwordMissing
            ? [{ path: "newPassword", code: "REQUIRED", message: "Required." }]
            : []),
        ],
      });
    }
    // token and newPassword are non-empty strings past this point.

    try {
      await deps.acceptInvite(token, newPassword);
    } catch (err) {
      throw normaliseInviteFailure(err);
    }

    return respondAction(
      "Invite accepted.",
      {},
      { status: 200, headers: { "x-request-id": requestId } }
    );
  } catch (err) {
    if (NextlyError.is(err)) {
      return buildErrorResponse(err, requestId);
    }
    return buildErrorResponse(
      NextlyError.internal({ cause: err as Error }),
      requestId
    );
  }
}
