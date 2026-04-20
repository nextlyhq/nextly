import { timingSafeEqual } from "node:crypto";

/**
 * Compare two CSRF tokens using constant-time comparison.
 * Prevents timing attacks on token validation.
 */
export function csrfTokensMatch(
  cookieToken: string,
  requestToken: string
): boolean {
  if (!cookieToken || !requestToken) return false;
  if (cookieToken.length !== requestToken.length) return false;

  try {
    const a = Buffer.from(cookieToken, "utf-8");
    const b = Buffer.from(requestToken, "utf-8");
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validate the Origin or Referer header against allowed origins.
 * Returns true if the request origin is allowed.
 */
export function validateOrigin(
  request: Request,
  allowedOrigins: string[]
): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const requestOrigin = origin || (referer ? new URL(referer).origin : null);

  if (!requestOrigin) {
    // No origin header -- reject to be safe
    return false;
  }

  // Always allow the request's own host
  const requestUrl = new URL(request.url);
  const selfOrigin = requestUrl.origin;

  const allAllowed = [selfOrigin, ...allowedOrigins];

  return allAllowed.some(
    allowed => requestOrigin.toLowerCase() === allowed.toLowerCase()
  );
}

/**
 * Full CSRF validation: double-submit cookie + origin check.
 *
 * @param request - The incoming request
 * @param cookieToken - Token from the nextly_csrf cookie
 * @param requestToken - Token from request body or X-CSRF-Token header
 * @param allowedOrigins - Additional allowed origins from config
 */
export function validateCsrf(
  request: Request,
  cookieToken: string | null,
  requestToken: string | null,
  allowedOrigins: string[] = []
): { valid: boolean; error?: string } {
  if (!cookieToken || !requestToken) {
    return { valid: false, error: "Missing CSRF token" };
  }

  if (!csrfTokensMatch(cookieToken, requestToken)) {
    return { valid: false, error: "Invalid CSRF token" };
  }

  if (!validateOrigin(request, allowedOrigins)) {
    return { valid: false, error: "Invalid request origin" };
  }

  return { valid: true };
}
