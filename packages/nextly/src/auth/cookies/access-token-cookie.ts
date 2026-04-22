import {
  COOKIE_NAMES,
  getCookieOptions,
  serializeCookie,
  serializeClearCookie,
  parseCookie,
} from "./cookie-config.js";

/**
 * Create a Set-Cookie header for the access token.
 *
 * `cookieMaxAgeSeconds` controls only when the browser drops the cookie — the
 * JWT's own `exp` claim (set by `signAccessToken`) is the authoritative
 * expiration. Callers should pass the refresh-token TTL here so that expired
 * JWTs still reach the server and drive the TOKEN_EXPIRED refresh flow.
 */
export function setAccessTokenCookie(
  token: string,
  cookieMaxAgeSeconds: number,
  isProduction: boolean
): string {
  const options = getCookieOptions(
    "accessToken",
    isProduction,
    cookieMaxAgeSeconds
  );
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
