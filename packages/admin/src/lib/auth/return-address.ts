/**
 * Where the sign-in page sends a browser once it has a session.
 *
 * The server sends a browser that opened one of its pages without a usable
 * session (an OAuth provider sending the person back to a callback, a link
 * opened in a new tab) to the sign-in page with the page's address as `next`.
 * There the admin refreshes an expired session as it does for any request,
 * or the person signs in, and the browser goes back to that address.
 *
 * `next` is in the query string, where anyone can write a link, so it is held
 * to core's rule for where the admin may send a browser after sign-in
 * (`sanitizeAdminPath`), the one the server holds a sign-in's own destination
 * to.
 *
 * @module lib/auth/return-address
 */
import { DEFAULT_ADMIN_PATH, sanitizeAdminPath } from "nextly/admin-path";

import { PUBLIC_ROUTE_PATHS, ROUTES } from "@admin/constants/routes";

/**
 * How long a return is remembered, to notice the address sending the
 * browser straight back to sign in.
 */
const RETURN_WINDOW_MS = 30_000;

/** Where the last return is remembered, for this tab only. */
const LAST_RETURN_KEY = "nextly:sign-in-return";

/** A path with no trailing slash, as the route list spells them. */
function bare(pathname: string): string {
  return pathname.replace(/\/$/, "");
}

function isPublicPage(pathname: string): boolean {
  return (PUBLIC_ROUTE_PATHS as readonly string[]).includes(bare(pathname));
}

/**
 * The address the sign-in page was asked to return to, or null: on any other
 * page, when none was asked, or when the address is not one the admin may
 * send a browser to. Never a signed-out page such as the sign-in page itself,
 * and never the admin root, where a sign-in lands anyway.
 */
export function returnAddress(): string | null {
  const { pathname, search } = window.location;
  if (bare(pathname) !== ROUTES.LOGIN) return null;
  const asked = new URLSearchParams(search).get("next");
  if (asked === null) return null;
  const address = sanitizeAdminPath(asked);
  if (address === DEFAULT_ADMIN_PATH) return null;
  const { pathname: target } = new URL(address, window.location.origin);
  return isPublicPage(target) ? null : address;
}

/**
 * Where a finished sign-in lands. Drawn at the sign-in page (or another public
 * page), its return address or else the dashboard; drawn in place of a screen
 * the visitor asked for, that screen, reloaded now that there is a session.
 * Either way an address on this page's own origin.
 */
export function afterSignInAddress(): string {
  const { pathname, search } = window.location;
  if (!isPublicPage(pathname)) return `${pathname}${search}`;
  return returnAddress() ?? ROUTES.DASHBOARD;
}

/**
 * Where a sign-in that has just finished sends the browser, given the
 * destination the server answered with: that destination when the login
 * carried one, and otherwise {@link afterSignInAddress}. The server names the
 * admin root for a login that carried no destination, as a password sign-in
 * never does, so the root is read as "none". Every way a sign-in finishes
 * (the password alone, a second factor, a required new password) lands
 * through here, so a sign-in page's return address holds on each.
 */
export function landingAfterSignIn(serverNext?: string | null): string {
  return serverNext !== undefined &&
    serverNext !== null &&
    serverNext !== DEFAULT_ADMIN_PATH
    ? serverNext
    : afterSignInAddress();
}

/** Whether `address` was returned to within the window, in this tab. */
function returnedLately(address: string, now: number): boolean {
  try {
    const raw = window.sessionStorage.getItem(LAST_RETURN_KEY);
    if (raw === null) return false;
    const last = JSON.parse(raw) as { address?: unknown; at?: unknown };
    return (
      last.address === address &&
      typeof last.at === "number" &&
      now - last.at >= 0 &&
      now - last.at < RETURN_WINDOW_MS
    );
  } catch {
    // Storage refused or holding something else: nothing is remembered.
    return false;
  }
}

/** Remember a return to `address`; false when it could not be kept. */
function rememberReturn(address: string, now: number): boolean {
  try {
    window.sessionStorage.setItem(
      LAST_RETURN_KEY,
      JSON.stringify({ address, at: now })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * With a session in hand, open the return address in place of the sign-in
 * page; true when it did. Opened as a whole page, since the address may be a
 * server route rather than an admin screen, and in place of this one, so
 * Back does not return to the sign-in page.
 *
 * Not when the same address sent the browser back here moments ago: it
 * refused the session this page found, and opening it again would send the
 * browser between the two for ever. Nor when the return cannot be remembered
 * (storage refused), since nothing would then notice that happening. The
 * caller then goes on as it would with nowhere to return to.
 */
export function returnWithSession(
  open: (address: string) => void = address => window.location.replace(address)
): boolean {
  const address = returnAddress();
  if (address === null) return false;
  const now = Date.now();
  if (returnedLately(address, now)) return false;
  if (!rememberReturn(address, now)) return false;
  open(address);
  return true;
}
