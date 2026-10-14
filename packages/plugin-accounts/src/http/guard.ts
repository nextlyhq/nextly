import type { AccountsCore } from "../core/ports";
import { accountsError } from "../errors";
import type { AccountsSettings } from "../settings";

import { cookieName, readCookie } from "./cookies";

/** The header a write sends the plugin's CSRF token in. */
export const CSRF_HEADER = "x-accounts-csrf";

/**
 * Refuses a write that does not come from the site itself: its `Origin`
 * (or, without one, its `Referer`) must be the configured origin, whether
 * or not it carries a cookie, and it must send the plugin's CSRF token in
 * `x-accounts-csrf`, matching the token's cookie, which no other site's page
 * can read.
 *
 * @throws `ACCOUNTS_CROSS_SITE`
 */
export function assertSameSiteWrite(
  request: Request,
  settings: Pick<AccountsSettings, "origin">,
  core: Pick<AccountsCore, "opaque">
): void {
  assertSameOrigin(request.headers, settings);

  const sent = request.headers.get(CSRF_HEADER) ?? "";
  const held = readCookie(request, cookieName(settings, "csrf")) ?? "";
  if (sent === "" || held === "" || !core.opaque.equal(sent, held)) {
    throw accountsError("ACCOUNTS_CROSS_SITE", { reason: "csrf" });
  }
}

/**
 * Refuses a write whose `Origin` (or, without one, its `Referer`) is not
 * the configured origin, whether or not it carries a cookie. A request with
 * neither is refused too: every browser the plugin supports sends `Origin`
 * on a POST, a form's included.
 *
 * @throws `ACCOUNTS_CROSS_SITE`
 */
export function assertSameOrigin(
  headers: Headers,
  settings: Pick<AccountsSettings, "origin">
): void {
  const from = headers.get("origin") ?? originOf(headers.get("referer"));
  if (from !== new URL(settings.origin).origin)
    throw accountsError("ACCOUNTS_CROSS_SITE", { reason: "origin" });
}

/**
 * Where a visitor may be sent back to after signing in: a path on the
 * site's own origin. Another origin, a protocol-relative address, a
 * backslash a browser reads as one, and an encoded path are all refused,
 * answering `fallback`. The path is judged again once the URL parser has
 * normalised it, since dot segments such as `/%2e%2e//host` normalise to a
 * protocol-relative path.
 */
export function safeReturnPath(
  settings: Pick<AccountsSettings, "origin">,
  next: string | undefined,
  fallback = "/"
): string {
  if (next === undefined || !isLocalPath(next)) return fallback;
  const url = new URL(next, settings.origin);
  if (url.origin !== new URL(settings.origin).origin) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;

  return isLocalPath(path) ? path : fallback;
}

/**
 * A path that stays on the origin it is resolved against: one leading
 * slash, never two, and no backslash, whitespace or encoded slash a
 * browser could read as a host.
 */
function isLocalPath(path: string): boolean {
  return /^\/(?![/\\])/.test(path) && !/[\\\s]|%2f|%5c/i.test(path);
}

function originOf(referer: string | null): string | null {
  if (referer === null) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
