/**
 * Refresh token cookie management.
 * Tightly scoped to /admin/api/auth/refresh path only.
 */
import {
  COOKIE_NAMES,
  getCookieOptions,
  serializeCookie,
  serializeClearCookie,
  parseCookie,
} from "./cookie-config";

/**
 * Create a Set-Cookie header for the refresh token.
 */
export function setRefreshTokenCookie(
  token: string,
  ttlSeconds: number,
  isProduction: boolean
): string {
  const options = getCookieOptions("refreshToken", isProduction, ttlSeconds);
  return serializeCookie(COOKIE_NAMES.refreshToken, token, options);
}

/**
 * Create a Set-Cookie header that clears the refresh token cookie.
 */
export function clearRefreshTokenCookie(): string {
  return serializeClearCookie(
    COOKIE_NAMES.refreshToken,
    "/admin/api/auth/refresh"
  );
}

/**
 * Read the refresh token from a Request's cookies.
 */
export function readRefreshTokenCookie(request: Request): string | null {
  return parseCookie(request.headers.get("cookie"), COOKIE_NAMES.refreshToken);
}
