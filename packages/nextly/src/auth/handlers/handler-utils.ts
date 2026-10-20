import {
  auditFailureMetadata,
  isStrategyName,
  type AuditLogWriter,
} from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors/nextly-error";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import {
  acceptedOwnOrigin,
  type CsrfResult,
  validateCsrf,
} from "../csrf/validate";

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
 * The first `limit` bytes of a request's body, or `null` past them, or once
 * `signal` aborts the read (for a body arriving too slowly).
 */
export async function boundedBody(
  request: Request,
  limit: number,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  // A clone, so the request's own body is left for whoever reads it next.
  const stream = request.clone().body;
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  // Cancelling ends a read in progress; the loop then sees the abort.
  const abort = () => {
    reader.cancel().catch(() => undefined);
  };
  if (signal?.aborted) return null;
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    if (signal?.aborted) return null;
    const { done, value } = await reader.read().catch(() => ({
      done: true as const,
      value: undefined,
    }));
    if (signal?.aborted) return null;
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      // A declared length can be absent or wrong; stop reading here either
      // way. Not awaited: cancelling one branch of a cloned body settles only
      // once the other branch is cancelled too, and the handler is about to
      // read that one to its end.
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  signal?.removeEventListener("abort", abort);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
 *
 * `strategy` is the sign-in method the attempt was using, when the caller
 * knows it. It is stated here rather than read from the error, because the
 * account-state gate raises its own error and knows nothing about the method:
 * a refusal it produced would otherwise record no method at all. A value that
 * is not a strategy name is left off, as the projection would drop it.
 */
export async function recordLoginFailure(
  deps: LoginFailureDeps,
  request: Request,
  err: unknown,
  requestId: string,
  strategy?: string
): Promise<void> {
  await deps.auditLog.write({
    kind: "login-failed",
    ipAddress: getTrustedClientIp(request, {
      trustProxy: deps.trustProxy,
      trustedProxyIps: deps.trustedProxyIps,
    }),
    userAgent: request.headers.get("user-agent"),
    metadata: {
      ...auditFailureMetadata(err, requestId),
      ...(isStrategyName(strategy) ? { strategy } : {}),
    },
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
    // Internal, unless the database was only busy.
    NextlyError.is(err) ? err : NextlyError.fromUnexpected(err),
    requestId
  );
}

/**
 * The error a CSRF refusal answers with, in the canonical envelope.
 *
 * Carries which half refused in `data.reason`. A refused origin also carries
 * `data.appOrigin`, the origin this check accepts as the request's own, so the
 * form can tell the person where the app answers. It is the server's own
 * address, never anything the request sent, and a page on another site cannot
 * read this answer.
 */
export function csrfFailure(
  request: Request,
  result: CsrfResult
): {
  code: "CSRF_FAILED";
  message: string;
  data?: { reason: "token" | "origin"; appOrigin?: string };
} {
  const message = result.error ?? "CSRF validation failed";
  if (result.reason === "origin") {
    return {
      code: "CSRF_FAILED",
      message,
      data: { reason: "origin", appOrigin: acceptedOwnOrigin(request) },
    };
  }
  return result.reason
    ? { code: "CSRF_FAILED", message, data: { reason: result.reason } }
    : { code: "CSRF_FAILED", message };
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
        { error: csrfFailure(request, result) },
        { "x-request-id": requestId }
      );
}
