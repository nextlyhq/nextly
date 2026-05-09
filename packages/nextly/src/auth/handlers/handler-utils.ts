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

