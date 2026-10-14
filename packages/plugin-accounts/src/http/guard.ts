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
  const from =
    request.headers.get("origin") ?? originOf(request.headers.get("referer"));
  if (from !== new URL(settings.origin).origin)
    throw accountsError("ACCOUNTS_CROSS_SITE", { reason: "origin" });

  const sent = request.headers.get(CSRF_HEADER) ?? "";
  const held = readCookie(request, cookieName(settings, "csrf")) ?? "";
  if (sent === "" || held === "" || !core.opaque.equal(sent, held)) {
    throw accountsError("ACCOUNTS_CROSS_SITE", { reason: "csrf" });
  }
}

/**
 * Where a visitor may be sent back to after signing in: a path on the
 * site's own origin. Another origin, a protocol-relative address, a
 * backslash a browser reads as one, and an encoded path are all refused,
 * answering `fallback`.
 */
export function safeReturnPath(
  settings: Pick<AccountsSettings, "origin">,
  next: string | undefined,
  fallback = "/"
): string {
  if (
    next === undefined ||
    !/^\/(?![/\\])/.test(next) ||
    /[\\\s]|%2f|%5c/i.test(next)
  )
    return fallback;
  const url = new URL(next, settings.origin);
  if (url.origin !== new URL(settings.origin).origin) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}

function originOf(referer: string | null): string | null {
  if (referer === null) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
