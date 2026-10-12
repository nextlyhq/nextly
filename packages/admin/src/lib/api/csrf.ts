import { BASE_URL } from "./fetcher";

// Fetch a CSRF token from the custom auth server. The server also
// sets the double-submit cookie as a Set-Cookie header, so the
// browser will echo it back on the following POST. Both halves must
// match server-side. Returns an empty string on failure so callers
// can still send the request and let the server respond with a
// structured CSRF_FAILED error.
//
// Wire shape (spec §7.6): the /auth/csrf endpoint emits
// `{ token: "..." }` directly via respondData.
export async function getCsrfToken(): Promise<string> {
  try {
    const res = await fetch(`${BASE_URL}/auth/csrf`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) {
      console.error("CSRF fetch failed with status:", res.status);
      return "";
    }
    const data: { token?: string } = await res.json();
    const token = data.token ?? "";
    if (!token) {
      console.warn("CSRF token not found in response");
    }
    return token;
  } catch (e) {
    console.error("Failed to fetch CSRF token:", e);
    return "";
  }
}

// The double-submit cookie `/auth/csrf` sets: `COOKIE_NAMES.csrf` in core's
// `auth/cookies/cookie-config.ts`, readable from script on purpose and scoped
// to `/admin`, where the admin runs.
const CSRF_COOKIE = "nextly_csrf";

/** The value of the CSRF cookie this page can see, or null when it has none. */
function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const pair of document.cookie.split(";")) {
    const at = pair.indexOf("=");
    if (at === -1 || pair.slice(0, at).trim() !== CSRF_COOKIE) continue;
    const value = pair.slice(at + 1).trim();
    if (value === "") return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

let fetching: Promise<string> | null = null;

/**
 * The token to send beside a write the session cookie authenticates.
 *
 * The CSRF COOKIE's value when the page holds one, and a fresh token from
 * `/auth/csrf` only when it does not. The server compares the header with the
 * cookie the browser sends, so the cookie is what the token has to equal, and
 * reading it keeps writes that overlap from rotating it under each other: a
 * fetch per write sets a new cookie each time, and a write still in flight
 * then carries a token the cookie no longer matches. Concurrent writes that
 * find no cookie share one fetch for the same reason.
 *
 * Empty when no token could be had, so the caller sends the request without
 * one and the server answers with its structured refusal.
 */
export function csrfTokenForWrite(): Promise<string> {
  const held = readCsrfCookie();
  if (held !== null) return Promise.resolve(held);
  fetching ??= getCsrfToken().finally(() => {
    fetching = null;
  });
  return fetching;
}
