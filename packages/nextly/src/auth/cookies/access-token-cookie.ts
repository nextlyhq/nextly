import {
  COOKIE_NAMES,
  getCookieOptions,
  serializeCookie,
  serializeClearCookie,
  parseCookie,
} from "./cookie-config.js";

/**
 * Create a Set-Cookie header for the access token.
 */
export function setAccessTokenCookie(
  token: string,
  ttlSeconds: number,
  isProduction: boolean
): string {
  const options = getCookieOptions("accessToken", isProduction, ttlSeconds);
  return serializeCookie(COOKIE_NAMES.accessToken, token, options);
}

/**
 * Create a Set-Cookie header that clears the access token cookie.
 */
export function clearAccessTokenCookie(): string {
  return serializeClearCookie(COOKIE_NAMES.accessToken, "/admin");
}

/**
 * Read the access token from a Request's cookies.
 */
export function readAccessTokenCookie(request: Request): string | null {
  return parseCookie(request.headers.get("cookie"), COOKIE_NAMES.accessToken);
}
