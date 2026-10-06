export const COOKIE_NAMES = {
  accessToken: "nextly_session",
  refreshToken: "nextly_refresh",
  csrf: "nextly_csrf",
} as const;

/** The admin panel's base path, which every auth cookie is scoped under. */
const ADMIN_PATH = "/admin";

/** Where core's `/auth/*` endpoints answer, below the admin's API. */
const AUTH_API_PATH = `${ADMIN_PATH}/api/auth`;

/**
 * The path each auth cookie is scoped to.
 *
 * The refresh token is scoped to the auth endpoints rather than to `/refresh`
 * alone, so sign-out receives it too and can delete its row: scoped to
 * `/refresh`, the browser never sent it to `/logout`, and the row stayed valid
 * for its whole lifetime after the user signed out. Only core's refresh and
 * logout handlers read it: auth hooks, strategies and plugin routes, which a
 * request under that path can reach, receive it without the cookie
 * (`withoutRefreshCookie`).
 */
export const COOKIE_PATHS = {
  accessToken: ADMIN_PATH,
  refreshToken: AUTH_API_PATH,
  csrf: ADMIN_PATH,
} as const;

/**
 * The refresh cookie's earlier, narrower path. A browser can still hold a
 * cookie set there, under the same name; it is cleared wherever the refresh
 * cookie is set or cleared, so the two never coexist.
 */
export const LEGACY_REFRESH_COOKIE_PATH = `${AUTH_API_PATH}/refresh`;

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge?: number;
}

/**
 * Get cookie options for the current environment.
 * secure=true in production, false in development.
 */
export function getCookieOptions(
  type: "accessToken" | "refreshToken" | "csrf",
  isProduction: boolean,
  maxAge?: number
): CookieOptions {
  const base: CookieOptions = {
    httpOnly: type !== "csrf", // CSRF cookie must be JS-readable
    secure: isProduction,
    sameSite: "lax",
    path: COOKIE_PATHS[type],
  };

  if (maxAge !== undefined) {
    base.maxAge = maxAge;
  }

  return base;
}

/**
 * Serialize a cookie into a Set-Cookie header string.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions
): string {
  let cookie = `${name}=${encodeURIComponent(value)}`;
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`;
  cookie += `; Path=${options.path}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  return cookie;
}

/**
 * Create a Set-Cookie header that clears/expires a cookie.
 */
export function serializeClearCookie(name: string, path: string): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/**
 * Parse a cookie value from a cookie header string by name.
 */
export function parseCookie(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
