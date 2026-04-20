export const COOKIE_NAMES = {
  accessToken: "nextly_session",
  refreshToken: "nextly_refresh",
  csrf: "nextly_csrf",
} as const;

// Legacy cookie names to clear on upgrade from Auth.js
export const LEGACY_COOKIE_NAMES = [
  "nextly_cms_session",
  "nextly_cms_csrf",
  "nextly_cms_callback",
  "nextly_cms_state",
  "nextly_cms_pkce",
  "authjs.session-token",
  "authjs.csrf-token",
  "authjs.callback-url",
] as const;

export const COOKIE_PATHS = {
  accessToken: "/admin",
  refreshToken: "/admin/api/auth/refresh",
  csrf: "/admin",
} as const;

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
