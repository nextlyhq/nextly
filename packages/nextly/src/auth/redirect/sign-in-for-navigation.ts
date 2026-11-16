/**
 * Where a browser NAVIGATING to a route that needs a session goes when it
 * has none it can use: the admin's sign-in page, which comes back to the
 * address afterwards.
 *
 * The admin refreshes an expired session in its fetch code, on a
 * `TOKEN_EXPIRED` answer, and the refresh cookie is sent only to the auth
 * endpoints. A page the browser opens itself (an OAuth provider sending the
 * person back to a callback, a link opened in a new tab) runs none of that
 * code and never carries that cookie, so the route it reaches cannot refresh
 * the session, and a JSON refusal is shown to the person as raw text. The
 * sign-in page can do what the route cannot: it refreshes an expired session
 * without asking, or asks the person to sign in, and then opens the address
 * it was given again.
 *
 * @module auth/redirect/sign-in-for-navigation
 */
import type { NextlyError } from "../../errors/nextly-error";

import { DEFAULT_ADMIN_PATH, sanitizeAdminPath } from "./sanitize-admin-path";

/** The admin's sign-in page. */
const SIGN_IN_PATH = `${DEFAULT_ADMIN_PATH}/login`;

/**
 * Whether the request is a browser opening a page in a tab or window, read
 * from its Fetch Metadata. A fetch, a frame, a form post (whose body a
 * redirect would lose) and a client sending no metadata are not.
 */
function isPageNavigation(request: Request): boolean {
  const method = request.method.toUpperCase();
  return (
    (method === "GET" || method === "HEAD") &&
    request.headers.get("sec-fetch-mode") === "navigate" &&
    request.headers.get("sec-fetch-dest") === "document"
  );
}

/**
 * The redirect to sign in and back for a request refused with `error`, or
 * `null` when the refusal should be answered as it is.
 *
 * Only for a page navigation, only for a refusal that a session would answer
 * (`TOKEN_EXPIRED` or `AUTH_REQUIRED`), and only for an address inside the
 * admin, where the session cookie is sent: outside it, signing in would not
 * change the answer. The address comes back exactly as requested, query
 * included, so a callback still has its parameters; it is the request's own
 * path, never a value the caller named, and is held to the admin like any
 * destination after sign-in. `303` so the return is a GET, and never stored,
 * as the refusal it replaces is personal to the request.
 */
export function signInForNavigation(
  request: Request,
  error: NextlyError
): Response | null {
  if (error.code !== "TOKEN_EXPIRED" && error.code !== "AUTH_REQUIRED") {
    return null;
  }
  if (!isPageNavigation(request)) return null;
  const { pathname, search } = new URL(request.url);
  const address = `${pathname}${search}`;
  // An address the admin would not return to is answered as before.
  if (sanitizeAdminPath(address) !== address) return null;
  const location = `${SIGN_IN_PATH}?${new URLSearchParams({ next: address })}`;
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });
}
