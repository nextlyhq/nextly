/**
 * CSRF cookie management.
 * The CSRF cookie is NOT httpOnly so JavaScript can read it.
 */
import {
  COOKIE_NAMES,
  getCookieOptions,
  serializeCookie,
  serializeClearCookie,
  parseCookie,
} from "../cookies/cookie-config";

/**
 * Create a Set-Cookie header for the CSRF token.
 */
export function setCsrfCookie(token: string, isProduction: boolean): string {
  const options = getCookieOptions("csrf", isProduction);
  return serializeCookie(COOKIE_NAMES.csrf, token, options);
}

/**
 * Create a Set-Cookie header that clears the CSRF cookie.
 */
export function clearCsrfCookie(): string {
  return serializeClearCookie(COOKIE_NAMES.csrf, "/admin");
}

/**
 * Read the CSRF token from a Request's cookies.
 */
export function readCsrfCookie(request: Request): string | null {
  return parseCookie(request.headers.get("cookie"), COOKIE_NAMES.csrf);
}

/**
 * Read the CSRF token from a request body or X-CSRF-Token header.
 */
export function readCsrfFromRequest(
  body: Record<string, unknown> | null,
  request: Request
): string | null {
  const headerToken = request.headers.get("x-csrf-token");
  if (headerToken) return headerToken;

  if (body && typeof body.csrfToken === "string") {
    return body.csrfToken;
  }

  return null;
}
