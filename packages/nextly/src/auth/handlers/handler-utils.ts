import {
  auditFailureMetadata,
  type AuditLogWriter,
} from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors/nextly-error";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";

/**
 * Create a JSON Response with the given status and body.
 */
export function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

/**
 * Build the canonical singular `{ error }` envelope (spec §6.4) for auth
 * handler failures: `application/problem+json` body, `x-request-id`
 * header, and status pulled from the NextlyError. Every auth handler
 * (login, register, forgot-password, reset-password, setup, ...) routes
 * its catch branches through this helper to keep the wire shape uniform.
 */
export function buildAuthErrorResponse(
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
 * Ensure the response takes at least stallMs to prevent timing attacks.
 * Used on login/forgot-password to prevent email enumeration.
 */
export async function stallResponse(
  startTime: number,
  stallMs: number
): Promise<void> {
  const elapsed = Date.now() - startTime;
  if (elapsed < stallMs) {
    await new Promise(resolve => setTimeout(resolve, stallMs - elapsed));
  }
}

/**
 * Merge multiple Set-Cookie header strings into a single headers object.
 * Uses the standard approach of passing multiple Set-Cookie values.
 */
export function buildCookieHeaders(
  cookies: string[],
  extra?: Record<string, string>
): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...extra,
  });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return headers;
}

/**
 * Safely parse a JSON request body. Returns null if parsing fails.
 */
export async function parseJsonBody(
  request: Request
): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The request body as a JSON object, or `{}` for anything else.
 *
 * For a handler that checks its own fields. A body that is not an object —
 * `null`, an array, a number, or not JSON at all — must not reach a
 * destructure, where it throws an internal error, so it is read as a body
 * with no fields and the handler's own field checks refuse it.
 */
export async function readJsonObjectBody(
  request: Request
): Promise<Record<string, unknown>> {
  const raw: unknown = await request.json().catch(() => null);
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** What recording a failed sign-in needs. */
export interface LoginFailureDeps {
  auditLog: AuditLogWriter;
  trustProxy: boolean;
  trustedProxyIps: string[];
}

/**
 * Record a failed sign-in as one `login-failed` event.
 *
 * Every path that ends a sign-in attempt in failure records it the same way,
 * and none splits by reason: that would re-introduce the account-state leak
 * the single error wire shape collapses. The row keeps only values this
 * package controls, and names no actor — a failure must not say which
 * account was reached — so nothing links it to a person. The specific cause
 * reaches the operator through the log instead.
 */
export async function recordLoginFailure(
  deps: LoginFailureDeps,
  request: Request,
  err: unknown,
  requestId: string
): Promise<void> {
  await deps.auditLog.write({
    kind: "login-failed",
    ipAddress: getTrustedClientIp(request, {
      trustProxy: deps.trustProxy,
      trustedProxyIps: deps.trustedProxyIps,
    }),
    userAgent: request.headers.get("user-agent"),
    metadata: auditFailureMetadata(err, requestId),
  });
}

/**
 * The response a failed sign-in answers with. A `NextlyError` serialises as
 * itself; anything else collapses to one internal error, so no internals
 * reach the wire.
 */
export function loginFailureResponse(
  err: unknown,
  requestId: string
): Response {
  return buildAuthErrorResponse(
    NextlyError.is(err) ? err : NextlyError.internal({ cause: err as Error }),
    requestId
  );
}

/**
 * The CSRF refusal a state-changing auth request answers with, or null when
 * the request is allowed to proceed.
 *
 * Returning the response rather than throwing keeps the caller's stall in its
 * own hands: on a path that stalls, every refusal takes the same minimum time,
 * so a rejected CSRF token cannot be told from a rejected code by how long it
 * took.
 */
export function csrfRefusal(
  request: Request,
  body: Record<string, unknown>,
  deps: { allowedOrigins: string[] },
  requestId: string
): Response | null {
  const result = validateCsrf(
    request,
    readCsrfCookie(request),
    readCsrfFromRequest(body, request),
    deps.allowedOrigins
  );
  return result.valid
    ? null
    : jsonResponse(
        403,
        { error: { code: "CSRF_FAILED", message: result.error } },
        { "x-request-id": requestId }
      );
}
