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
import { readOrGenerateRequestId } from "../../api/request-id";
import { NextlyError } from "../../errors/nextly-error";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";

import { jsonResponse, stallResponse } from "./handler-utils";

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

/**
 * Audit H2 (T-011): validate the user-supplied `redirectPath` before
 * passing it to the password-reset email builder. An unvalidated value
 * lets an attacker turn the reset email into a phishing redirect.
 *
 * Accepts:
 *   - Relative paths under `/admin/*` (the legitimate use-case for
 *     applications that mount the admin UI under `/admin`).
 *   - Absolute URLs whose origin is on the `ALLOWED_REDIRECT_HOSTS`
 *     env-var allowlist (comma-separated host[:port] entries).
 *
 * Rejected values fall back to `undefined` (the password-reset
 * service applies its default) and emit a `console.warn` so
 * misconfigurations are visible in production logs. Returning
 * `undefined` (not throwing) preserves the timing-equalised
 * anti-enumeration response shape.
 */
function sanitizeRedirectPath(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;

  // Reject obvious garbage early.
  if (raw.length > 2048 || raw.includes("\0")) {
    console.warn(
      `[nextly/auth] Rejected forgot-password redirectPath: oversized or contained null byte`
    );
    return undefined;
  }

  // Relative paths: must start with a single `/` (not `//`, which is
  // protocol-relative and resolves to a foreign origin) and live under
  // `/admin`.
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    if (raw === "/admin" || raw.startsWith("/admin/") || raw.startsWith("/admin?")) {
      return raw;
    }
    console.warn(
      `[nextly/auth] Rejected forgot-password redirectPath outside /admin: ${raw}`
    );
    return undefined;
  }

  // Absolute URLs: parse and check against ALLOWED_REDIRECT_HOSTS.
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    console.warn(
      `[nextly/auth] Rejected forgot-password redirectPath: unparseable URL: ${raw}`
    );
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    console.warn(
      `[nextly/auth] Rejected forgot-password redirectPath: bad protocol ${parsed.protocol}`
    );
    return undefined;
  }
  const allowed = (process.env.ALLOWED_REDIRECT_HOSTS ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const host = parsed.host.toLowerCase();
  if (allowed.includes(host)) {
    return raw;
  }
  console.warn(
    `[nextly/auth] Rejected forgot-password redirectPath: host ${host} not in ALLOWED_REDIRECT_HOSTS`
  );
  return undefined;
}

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

    // Audit H2 (T-011): validate redirectPath. The reset email embeds it
    // in the link, so an attacker who can post arbitrary requests to
    // /auth/forgot-password (no auth required) can craft a phishing
    // link that looks like a legitimate reset email but redirects the
    // victim to a controlled site. Reject with a silent fallback to
    // avoid breaking the existing enumeration protection (the caller
    // must not be able to distinguish "bad email" from "bad redirect").
    const safeRedirectPath = sanitizeRedirectPath(redirectPath);

    // Per spec §13.3: even if generatePasswordResetToken throws because the
    // email is unknown / invalid / locked / disabled, we silently swallow
    // and return the generic message. Internal infrastructure errors still
    // surface as 5xx so operators see them.
    try {
      await deps.generatePasswordResetToken(email, safeRedirectPath);
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
