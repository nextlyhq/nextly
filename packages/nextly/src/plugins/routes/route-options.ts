/**
 * The security options a plugin route can opt into.
 *
 * Each is something core already does for its own routes and a plugin
 * previously could not ask for. A plugin route mounted at the root has no CSRF
 * protection at all unless it writes its own, and a plugin sign-in route is as
 * much a credential-stuffing target as `/auth/login` — so the choice was
 * between every plugin reimplementing these and none of them having them.
 *
 * Kept as pure decisions, so the rules can be tested without a request
 * pipeline and the dispatcher stays the only thing that acts on them.
 *
 * @module plugins/routes/route-options
 * @since 1.0.0
 */
import { readAccessTokenCookie } from "../../auth/cookies/access-token-cookie";
import {
  readCsrfCookie,
  readCsrfFromRequest,
} from "../../auth/csrf/csrf-cookie";
import { validateCsrf, validateOrigin } from "../../auth/csrf/validate";
import { ipv6PrefixHex } from "../../auth/session/refresh-binding";
import { isReadOperation } from "../../middleware/rate-limit";

import type { PluginRoute } from "./route-types";

/** Methods that change something, and so need CSRF protection. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** How a caller proved who they are, which decides whether CSRF applies. */
export type CallerCredential = "cookie" | "bearer" | "none";

/**
 * The credential a PUBLIC route's caller carries, for the CSRF decision.
 *
 * A public route resolved nobody, so this reads the one cookie a handler can
 * act on — the session cookie `ctx.auth.currentUser` resolves — rather than
 * any cookie at all. Classifying by the `Cookie` header's presence treated an
 * analytics or locale cookie as a session, and a caller with any cookie was
 * then held to a check it could never pass. The session cookie wins over an
 * `Authorization` header: the header may be ambient HTTP authentication a
 * browser attached on its own.
 */
export function publicCallerCredential(request: Request): CallerCredential {
  if (readAccessTokenCookie(request)) return "cookie";
  return request.headers.get("authorization") ? "bearer" : "none";
}

/** The cross-site rule {@link routeCsrfMode} decides for one request. */
export type RouteCsrfMode = "none" | "origin" | "token" | "refuse";

/**
 * Which cross-site check a request to this route must pass.
 *
 * - `"origin"` — the DEFAULT for an authenticated route: the request must come
 *   from this site or an allowed origin. Browsers send `Origin` (or at least
 *   `Referer`) on every cross-site write, so this refuses a forged request
 *   while the admin's own requests, which send no token, pass. It is the
 *   origin check `validateCsrf` applies on core's `/auth/*` handlers, without
 *   the token those handlers also require.
 * - `"token"` — the route set `csrf: true`: a double-submit token as well as
 *   the origin, the protection core's `/auth/*` handlers take.
 * - `"refuse"` — the route set `csrf: false` and the session cookie is the
 *   credential. A route that opts out of the check accepts no write the
 *   session cookie authenticates: without the check, any page the browser
 *   counts as same-site (a sibling subdomain, say) could make one, and the
 *   callers an opt-out is for — an API key, a Bearer token — carry no session
 *   cookie. `csrf: false` cannot be combined with `public: true`;
 *   {@link validateRouteOptions} refuses the pair when routes are collected.
 * - `"none"` — the method changes nothing, the caller did not authenticate
 *   with the session cookie, or a public route did not set `csrf: true`.
 *
 * Only a cookie travels automatically, so only a cookie-authenticated request
 * can be made by a site the user did not intend to act on. The RESOLVED
 * credential decides: a browser can attach an Authorization header on its own
 * (ambient HTTP authentication), and classifying by header presence skipped
 * the check for a request whose session cookie admitted it.
 */
export function routeCsrfMode(
  route: PluginRoute,
  request: Request,
  credential: CallerCredential
): RouteCsrfMode {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return "none";
  if (credential !== "cookie") return "none";
  if (route.csrf === true) return "token";
  // Ahead of the public rule: collection refuses `csrf: false` on a public
  // route, and a route that reached here regardless still holds to it.
  if (route.csrf === false) return "refuse";
  // A public route skips the default: it authenticated no one, and a cookie
  // on the request — even an expired one — says nothing about what admitted
  // it. A public handler that resolves the session user and acts on them
  // declares `csrf: true`.
  if (route.public === true) return "none";
  return "origin";
}

/** Check the request against the route's cross-site rule. */
export function checkRouteCsrf(
  route: PluginRoute,
  request: Request,
  body: Record<string, unknown> | undefined,
  allowedOrigins: string[],
  credential: CallerCredential
): { valid: boolean; error?: string } {
  // The RESOLVED credential — the same argument the dispatcher decided the
  // mode with. Recomputing it here from header presence let a request carrying
  // an ambient Authorization header slip past the check just demanded.
  const mode = routeCsrfMode(route, request, credential);
  if (mode === "none") return { valid: true };
  if (mode === "refuse") {
    return {
      valid: false,
      error: "Route does not accept writes authenticated by the session cookie",
    };
  }
  if (mode === "origin") {
    return validateOrigin(request, allowedOrigins)
      ? { valid: true }
      : { valid: false, error: "Invalid request origin" };
  }
  return validateCsrf(
    request,
    readCsrfCookie(request),
    readCsrfFromRequest(body ?? {}, request),
    allowedOrigins
  );
}

/** Whether the response should carry `Cache-Control: no-store`. */
export function shouldNotStore(route: PluginRoute): boolean {
  // An auth-limited route's responses describe an authentication attempt, so
  // they are never cacheable whether or not the plugin remembered to say so.
  return route.noStore === true || route.rateLimit === "auth";
}

/**
 * The part of a client address a rate limit counts by.
 *
 * An IPv4 address is one client. An IPv6 client is normally handed a whole
 * /64 and chooses addresses within it freely, so counting the full address let
 * one client rotate through the prefix and never reach its limit; the /64 is
 * what it actually holds. An IPv4 address written in IPv6's mapped form is the
 * IPv4 client, not a /64 shared by every IPv4 client.
 */
export function rateLimitClient(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const prefix = ipv6PrefixHex(ip, 64);
  return prefix === null ? ip : `${prefix}::/64`;
}

/**
 * The rate-limit bucket key for this route and caller.
 *
 * Namespaced by plugin, so one plugin's traffic cannot exhaust another's
 * budget, and separate from core's `/auth/*` bucket for the same reason. And
 * by ROUTE: one bucket for every route of a plugin made an SSO sign-in, which
 * spends one request on `authorize` and one on `callback`, cost two of the
 * same budget, and an office behind one address was locked out at half the
 * sign-ins the limit meant.
 */
export function rateLimitKey(
  route: PluginRoute,
  pluginSlug: string,
  ip: string
): string | null {
  const declared = route.rateLimit;
  if (declared === undefined) return null;
  // The PATH, not the method: an auth bucket guards the sign-in step the path
  // names, whichever method reaches it — a form-post callback and its GET
  // twin are one step.
  const at = `${pluginSlug}:${route.path}:${rateLimitClient(ip)}`;
  // Each declared form gets its own bucket namespace: an auth route's budget
  // exists to make guessing expensive, and ordinary traffic must not be able
  // to spend it.
  if (declared === "auth") return `plugin-auth-ip:${at}`;
  if (declared === "general") {
    // SUFFIXED by the read/write class, exactly as the core limiter keys its
    // own buckets: reads and writes have separate configured limits, so a
    // shared counter let enough GETs raise the count past `writeLimit` and
    // refuse the next POST without a single write having been spent — read
    // traffic denying mutations.
    const operation = isReadOperation(route.method) ? "read" : "write";
    return `plugin-general-ip:${at}:${operation}`;
  }
  // A route's own allowance is per METHOD too: two methods on one path may
  // declare different limits, and one counter checked against both let the
  // looser method's traffic spend the stricter one's budget.
  return `plugin-route-ip:${at}:${route.method}`;
}

/** Whether a declared custom allowance is one a limiter can apply. */
function isRouteAllowance(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const { max, windowMs, ...rest } = value as Record<string, unknown>;
  return (
    Object.keys(rest).length === 0 &&
    Number.isSafeInteger(max) &&
    (max as number) > 0 &&
    Number.isSafeInteger(windowMs) &&
    (windowMs as number) > 0
  );
}

/** Why a route's declared options are invalid, or null when they are fine. */
export function validateRouteOptions(route: PluginRoute): string | null {
  if (route.rawBody === true && !UNSAFE_METHODS.has(route.method)) {
    return `rawBody is only meaningful on a method with a body, not ${route.method}`;
  }
  // `csrf: false` refuses writes the session cookie authenticates, while a
  // public route checks nothing by default: on a public route the opt-out
  // reads as switching protection off where it would switch a refusal on.
  // Refused rather than guessed — a public handler that acts on the signed-in
  // user declares `csrf: true`, and one that does not leaves `csrf` unset.
  if (route.public === true && route.csrf === false) {
    return "csrf: false cannot be combined with public: true; declare csrf: true if the handler acts on the signed-in user, or leave csrf unset";
  }
  // The union is a TYPESCRIPT guarantee, and an unchecked JavaScript plugin
  // has none: a typo like "authn" parsed happily, made `rateLimitKey` answer
  // null, and the route then ran with no limiter at all — silently losing the
  // credential-stuffing budget the author believed they had declared, and the
  // no-store protection an auth route gets. Refused at collection, where the
  // declared/known mismatch is still a configuration error rather than a
  // running route missing its protection.
  if (
    route.rateLimit !== undefined &&
    route.rateLimit !== "auth" &&
    route.rateLimit !== "general" &&
    !isRouteAllowance(route.rateLimit)
  ) {
    return `rateLimit must be "auth", "general" or { max, windowMs } with positive integers, not ${JSON.stringify(route.rateLimit)}`;
  }
  return null;
}

/**
 * The boot warning for rate-limited routes on an install that does not trust
 * its proxy, or null when there is nothing to say.
 *
 * Without `security.trustProxy` no client address is read at all, so every
 * caller counts as the same client and a route's per-client limit is one
 * bucket for the whole site: one client can spend it for everyone. Core's own `/auth/*` routes accept that trade-off
 * deliberately; a plugin route inherits it, so the operator is told which
 * routes do.
 */
export function rateLimitProxyWarning(
  routes: ReadonlyArray<{ fullPath: string; route: PluginRoute }>,
  trustProxy: boolean
): string | null {
  if (trustProxy) return null;
  const limited = routes
    .filter(entry => entry.route.rateLimit !== undefined)
    .map(entry => `${entry.route.method} ${entry.fullPath}`);
  if (limited.length === 0) return null;
  return (
    "[nextly] These plugin routes are rate limited per client, but " +
    "security.trustProxy is off, so no client address is read and every " +
    `client shares one limit: ${limited.join(", ")}. Turn on ` +
    "security.trustProxy when the app runs behind a proxy you control."
  );
}
