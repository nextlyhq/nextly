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
import { z } from "zod";

import { readOrGenerateRequestId } from "../../api/request-id";
import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";
import { EmailSchema, PasswordSchema } from "../../schemas/validation";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";

import { jsonResponse, stallResponse } from "./handler-utils";

/**
 * Audit M9 (T-021): structured payload validation at the route layer.
 * Reuses the canonical EmailSchema (RFC 5321 + trim/lowercase) and
 * PasswordSchema (length + class requirements) so register matches the
 * checks the rest of the auth surface already enforces. Name is bounded
 * to a sensible UI range — not load-bearing security, but rejects
 * trivially silly inputs (empty string, multi-megabyte payloads).
 */
const RegisterPayloadSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(100, "Name must be 100 characters or less."),
});

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

/**
 * Map a zod issue to one of the codes the rest of the API uses for
 * validation errors. Anything we don't have a stable equivalent for
 * collapses to "INVALID" — the human-readable message still carries
 * the specific reason.
 */
function zodIssueToCode(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return "REQUIRED";
    case "too_small":
      return issue.minimum === 1 ? "REQUIRED" : "TOO_SHORT";
    case "too_big":
      return "TOO_LONG";
    case "invalid_format":
      return "INVALID_FORMAT";
    default:
      return "INVALID";
  }
}

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

    const parsed = RegisterPayloadSchema.safeParse(body);
    if (!parsed.success) {
      throw NextlyError.validation({
        errors: parsed.error.issues.map(issue => ({
          path: issue.path.join(".") || "root",
          code: zodIssueToCode(issue),
          message: issue.message.endsWith(".")
            ? issue.message
            : `${issue.message}.`,
        })),
      });
    }
    const { email, password, name } = parsed.data;

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
      await stallResponse(startTime, deps.loginStallTimeMs);
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
