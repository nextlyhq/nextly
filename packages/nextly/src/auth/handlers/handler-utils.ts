import type { NextlyError } from "../../errors";

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
