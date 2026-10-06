/**
 * Refresh token cookie management.
 *
 * Scoped to core's auth endpoints (`COOKIE_PATHS.refreshToken`): `/refresh`
 * rotates it and `/logout` deletes its row.
 */
import {
  COOKIE_NAMES,
  COOKIE_PATHS,
  LEGACY_REFRESH_COOKIE_PATH,
  getCookieOptions,
  serializeCookie,
  serializeClearCookie,
  parseCookie,
} from "./cookie-config";

/**
 * The Set-Cookie headers that store a refresh token: the cookie itself, and
 * the clearing of any copy a browser still holds at the legacy path. That copy
 * is sent first to `/refresh`, being the more specific path, so left in place
 * it would shadow the new token.
 */
export function setRefreshTokenCookies(
  token: string,
  ttlSeconds: number,
  isProduction: boolean
): string[] {
  const options = getCookieOptions("refreshToken", isProduction, ttlSeconds);
  return [
    serializeCookie(COOKIE_NAMES.refreshToken, token, options),
    serializeClearCookie(COOKIE_NAMES.refreshToken, LEGACY_REFRESH_COOKIE_PATH),
  ];
}

/**
 * The Set-Cookie headers that clear the refresh token, at its path and at the
 * legacy one.
 */
export function clearRefreshTokenCookies(): string[] {
  return [
    serializeClearCookie(COOKIE_NAMES.refreshToken, COOKIE_PATHS.refreshToken),
    serializeClearCookie(COOKIE_NAMES.refreshToken, LEGACY_REFRESH_COOKIE_PATH),
  ];
}

/**
 * Read the refresh token from a Request's cookies.
 */
export function readRefreshTokenCookie(request: Request): string | null {
  return parseCookie(request.headers.get("cookie"), COOKIE_NAMES.refreshToken);
}

/**
 * A copy of `request` without the refresh cookie, for handing to code outside
 * core: auth hooks, auth strategies and plugin route handlers.
 *
 * The refresh cookie's path covers every `/auth/*` endpoint, so a request
 * there carries a token that mints sessions for its whole lifetime; only
 * core's refresh and logout handlers read it. Every other cookie and header,
 * the method, the URL and the body are kept, and the original request stays
 * readable; a body already read cannot be copied, and the copy then has none.
 *
 * The copy is built from the request's values, never from the request
 * object: a framework hands over an instance of its own `Request` class
 * (Next.js's), which the global `Request` constructor cannot read. So the
 * copy is a plain `Request`, without what a subclass such as `NextRequest`
 * adds, and an unread body is read into memory to carry it over. A request
 * without the cookie is returned as is.
 */
export async function withoutRefreshCookie(request: Request): Promise<Request> {
  const header = request.headers.get("cookie");
  if (readRefreshTokenCookie(request) === null || header === null) {
    return request;
  }
  const kept = header
    .split(";")
    .map(part => part.trim())
    .filter(
      part => part !== "" && !part.startsWith(`${COOKIE_NAMES.refreshToken}=`)
    );
  const headers = new Headers(request.headers);
  if (kept.length > 0) headers.set("cookie", kept.join("; "));
  else headers.delete("cookie");
  const body =
    request.bodyUsed || request.body === null
      ? undefined
      : await request.clone().arrayBuffer();
  return new Request(request.url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
    redirect: request.redirect,
  });
}
