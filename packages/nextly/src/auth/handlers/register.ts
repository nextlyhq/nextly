/**
 * POST /auth/register
 *
 * Registers a new user account. Per spec §13.2, the response is silent-success
 * by default — even when the email is already in use, the public response is
 * a generic "if this email is available, we've sent a confirmation link"
 * message. This eliminates account enumeration via the registration endpoint.
 *
 * The framework user can opt out via `auth.revealRegistrationConflict: true`
 * in their NextlyConfig, in which case email conflicts surface as 409 DUPLICATE.
 *
 * Does NOT auto-login -- user must verify email first (if required).
 */
// CSRF double-submit cookie + origin check. Prevents cross-site forced
// account creation. See docs/auth/csrf.md.
import { readOrGenerateRequestId } from "../../api/request-id.js";
import { NextlyError } from "../../errors/nextly-error.js";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";

import { jsonResponse } from "./handler-utils.js";

export interface RegisterHandlerDeps {
  allowedOrigins: string[];
  /**
   * Whether to surface email conflicts as 409 DUPLICATE (true) or swallow
   * them and return generic silent-success (false, the spec default).
   */
  revealRegistrationConflict: boolean;
  /**
   * Throws NextlyError on failure (validation, DUPLICATE on email conflict,
   * etc.). Returns the new user record on success.
   */
  registerUser: (data: {
    email: string;
    password: string;
    name: string;
  }) => Promise<{ id: string; email: string; name: string | null }>;
}

const SILENT_SUCCESS_MESSAGE =
  "If this email is available, we've sent a confirmation link.";

function buildRegisterErrorResponse(
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

export async function handleRegister(
  request: Request,
  deps: RegisterHandlerDeps
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
      // CSRF stays as a discrete code — it's a configuration / origin issue,
      // not an account-state leak. Keep the existing wire shape.
      return jsonResponse(
        403,
        { error: { code: "CSRF_FAILED", message: csrfResult.error } },
        { "x-request-id": requestId }
      );
    }

    const { email, password, name } = body;
    if (!email || !password || !name) {
      throw NextlyError.validation({
        errors: [
          ...(!email
            ? [{ path: "email", code: "REQUIRED", message: "Required." }]
            : []),
          ...(!password
            ? [{ path: "password", code: "REQUIRED", message: "Required." }]
            : []),
          ...(!name
            ? [{ path: "name", code: "REQUIRED", message: "Required." }]
            : []),
        ],
      });
    }

    try {
      const user = await deps.registerUser({ email, password, name });

      // Spec §13.2: even on real success, the public response is a generic
      // "if this email is available..." message — the response shape is
      // identical to the silent-success conflict path so an attacker cannot
      // distinguish "you registered" from "you tried to register a taken
      // email." When `revealRegistrationConflict` is true, real success
      // includes the user object; otherwise the generic message stays.
      if (deps.revealRegistrationConflict) {
        return new Response(
          JSON.stringify({
            data: {
              user: { id: user.id, email: user.email, name: user.name },
            },
          }),
          {
            status: 201,
            headers: {
              "content-type": "application/json",
              "x-request-id": requestId,
            },
          }
        );
      }
      return new Response(
        JSON.stringify({ data: { message: SILENT_SUCCESS_MESSAGE } }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
          },
        }
      );
    } catch (err) {
      // Spec §13.2: when the email is in use AND revealRegistrationConflict
      // is false (the default), swallow the DUPLICATE and return the same
      // silent-success message the success path returns. Operators can still
      // see the conflict in the server log via the original NextlyError
      // logContext (logged at the boundary by withErrorHandler / similar).
      if (
        NextlyError.isCode(err, "DUPLICATE") &&
        !deps.revealRegistrationConflict
      ) {
        // TODO: send the "someone tried to register your account" courtesy
        // email to the existing user once email subsystem template support
        // lands (spec §19 follow-up).
        return new Response(
          JSON.stringify({ data: { message: SILENT_SUCCESS_MESSAGE } }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-request-id": requestId,
            },
          }
        );
      }
      throw err;
    }
  } catch (err) {
    if (NextlyError.is(err)) {
      return buildRegisterErrorResponse(err, requestId);
    }
    return buildRegisterErrorResponse(
      NextlyError.internal({ cause: err as Error }),
      requestId
    );
  }
}
