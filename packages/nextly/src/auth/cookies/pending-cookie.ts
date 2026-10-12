/**
 * The cookie that carries a pending sign-in across a redirect.
 *
 * An external login that hits a second factor has nowhere to put the pending
 * token: the browser is being redirected, and a token in the URL ends up in
 * history, in the Referer header and in every access log on the way. So it
 * travels in an HttpOnly cookie instead, scoped to the admin panel, and the
 * login page resumes from it.
 *
 * @module auth/cookies/pending-cookie
 * @since 1.0.0
 */
import {
  parseCookie,
  serializeClearCookie,
  serializeCookie,
  type CookieOptions,
} from "./cookie-config";

/** Distinct from the session cookie: this authorizes resolving a challenge, nothing else. */
export const PENDING_COOKIE_NAME = "nextly_pending";

/**
 * Scoped to the admin panel rather than to the resolve endpoint alone, because
 * the login PAGE has to read that a challenge is outstanding before it can
 * post an answer.
 */
export const PENDING_COOKIE_PATH = "/admin";

function pendingCookieOptions(
  isProduction: boolean,
  maxAgeSeconds: number
): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    // Lax, not Strict: the cookie is set on a redirect arriving from the
    // identity provider, and Strict would withhold it on exactly that
    // navigation.
    sameSite: "lax",
    path: PENDING_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}

/** Set the pending-auth token for the challenge TTL. */
export function setPendingCookie(
  token: string,
  challengeTokenTTL: number,
  isProduction: boolean
): string {
  return serializeCookie(
    PENDING_COOKIE_NAME,
    token,
    pendingCookieOptions(isProduction, challengeTokenTTL)
  );
}

/** Clear the pending-auth cookie once the challenge is settled. */
export function clearPendingCookie(): string {
  return serializeClearCookie(PENDING_COOKIE_NAME, PENDING_COOKIE_PATH);
}

/** Read the pending-auth token a request carries, if any. */
export function readPendingCookie(request: Request): string | null {
  return parseCookie(request.headers.get("cookie"), PENDING_COOKIE_NAME);
}
