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
import { readOrGenerateRequestId } from "../../api/request-id";
// Phase 4 (Task 10): respondAction emits `{ message, ...result }` on the
// success branches. The silent-success message is preserved verbatim on
// the no-reveal path so spec §13.2 anti-enumeration still holds (the
// reveal-on path swaps in "Account created." per spec §7.6).
import { respondAction } from "../../api/response-shapes";
import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";

import { jsonResponse, stallResponse } from "./handler-utils";

export interface RegisterHandlerDeps {
  allowedOrigins: string[];
  /**
   * Whether to surface email conflicts as 409 DUPLICATE (true) or swallow
   * them and return generic silent-success (false, the spec default).
   */
  revealRegistrationConflict: boolean;
  /**
   * Audit H11 (T-010): minimum response time in milliseconds. The
   * handler stalls every response path to this floor so an attacker
   * cannot distinguish "fresh account created" (slow — bcrypt + DB
   * inserts) from "conflict swallowed" (fast — just a DB read) by
   * timing.
   */
  loginStallTimeMs: number;
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
  const startTime = Date.now();
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
      await stallResponse(startTime, deps.loginStallTimeMs);
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
        await stallResponse(startTime, deps.loginStallTimeMs);
        // Phase 4 / spec §7.6: reveal-on success path uses the canonical
        // "Account created." action message and a 201 status.
        return respondAction(
          "Account created.",
          { user: { id: user.id, email: user.email, name: user.name } },
          {
            status: 201,
            headers: { "x-request-id": requestId },
          }
        );
      }
      await stallResponse(startTime, deps.loginStallTimeMs);
      // Spec §13.2: silent-success message is identical for real success
      // and swallowed-conflict so an attacker cannot distinguish them.
      // Wrap via respondAction for shape consistency without changing the
      // visible string.
      return respondAction(
        SILENT_SUCCESS_MESSAGE,
        {},
        {
          status: 200,
          headers: { "x-request-id": requestId },
        }
      );
    } catch (err) {
      // Spec §13.2: when the email is in use AND revealRegistrationConflict
      // is false (the default), swallow the DUPLICATE and return the same
      // silent-success message the success path returns. The handler builds
      // its own Response (does not flow through withErrorHandler), so we
      // log explicitly here so operators still see the conflict event.
      if (
        NextlyError.isCode(err, "DUPLICATE") &&
        !deps.revealRegistrationConflict
      ) {
        getNextlyLogger().info({
          kind: "register-duplicate-swallowed",
          requestId,
          logContext: err.logContext,
        });
        // TODO: send the "someone tried to register your account" courtesy
        // email to the existing user once email subsystem template support
        // lands (spec §19 follow-up).
        await stallResponse(startTime, deps.loginStallTimeMs);
        // Phase 4 / spec §13.2: same silent-success shape as the no-reveal
        // success branch. Anti-enumeration requires byte-equal responses.
        return respondAction(
          SILENT_SUCCESS_MESSAGE,
          {},
          {
            status: 200,
            headers: { "x-request-id": requestId },
          }
        );
      }
      throw err;
    }
  } catch (err) {
    await stallResponse(startTime, deps.loginStallTimeMs);
    if (NextlyError.is(err)) {
      return buildRegisterErrorResponse(err, requestId);
    }
    return buildRegisterErrorResponse(
      NextlyError.internal({ cause: err as Error }),
      requestId
    );
  }
}
