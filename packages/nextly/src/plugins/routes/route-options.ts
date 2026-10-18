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
import {
  readCsrfCookie,
  readCsrfFromRequest,
} from "../../auth/csrf/csrf-cookie";
import {
  carriesBearerToken,
  isUnsafeMethod,
  validateCsrf,
  validateOrigin,
} from "../../auth/csrf/validate";
import { ipv6PrefixHex } from "../../auth/session/refresh-binding";
import { isReadOperation } from "../../middleware/rate-limit";
import { isPlainObject } from "../../shared/lib/plain-copy";

import type { PluginRoute, RouteMethod } from "./route-types";

/** How a caller proved who they are, which decides whether CSRF applies. */
export type CallerCredential = "cookie" | "bearer" | "none";

/**
 * The credential a PUBLIC route's caller carries, for the CSRF decision.
 *
 * A public route resolved nobody, so this takes whether the session cookie
 * authenticates — the cookie `ctx.auth.currentUser` resolves, rather than any
 * cookie at all. Classifying by the `Cookie` header's presence treated an
 * analytics or locale cookie as a session, and classifying by the session
 * cookie's presence held a caller whose expired or malformed cookie
 * authenticates nobody to a token only a signed-in caller can hold. The
 * session wins over an `Authorization` header; without one, only a `Bearer`
 * token makes the caller a bearer caller (see {@link carriesBearerToken}). A
 * browser attaches Basic, Digest, Negotiate or NTLM credentials on its own,
 * cross-site included, so no other scheme does: the scheme is matched
 * exactly, not against a list of browser schemes a new one would slip past.
 */
export function publicCallerCredential(
  request: Request,
  sessionAuthenticated: boolean
): CallerCredential {
  if (sessionAuthenticated) return "cookie";
  return carriesBearerToken(request) ? "bearer" : "none";
}

/** The cross-site rule {@link routeCsrfMode} decides for one request. */
export type RouteCsrfMode = "none" | "origin" | "token" | "refuse";

/**
 * Which cross-site check a request to this route must pass.
 *
 * - `"origin"` — the DEFAULT for an authenticated route: the request must come
 *   from this site or an allowed origin. Browsers send `Origin` (or at least
 *   `Referer`) on every cross-site write, so this refuses a forged request
 *   while a same-origin write that carries no token passes. It is the
 *   origin check `validateCsrf` applies on core's `/auth/*` handlers, without
 *   the token those handlers also require. Also what `csrf: true` asks of an
 *   anonymous caller.
 * - `"token"` — the route set `csrf: true` and the session cookie is the
 *   credential: a double-submit token as well as the origin, the protection
 *   core's `/auth/*` handlers take.
 * - `"refuse"` — the route set `csrf: false` and the session cookie is the
 *   credential. A route that opts out of the check accepts no write the
 *   session cookie authenticates: without the check, any page the browser
 *   counts as same-site (a sibling subdomain, say) could make one, and the
 *   callers an opt-out is for — an API key, a Bearer token — carry no session
 *   cookie. `csrf: false` cannot be combined with `public: true`;
 *   {@link validateRouteOptions} refuses the pair when routes are collected.
 * - `"none"` — the method changes nothing, the caller sent a `Bearer` token,
 *   or the route did not set `csrf: true` and the session cookie is not the
 *   credential, or a public route did not set it at all.
 *
 * Only a cookie travels automatically, so only a request carrying one can be
 * made by a site the user did not intend to act on. That is not only the
 * session cookie: a plugin's own cookie for anonymous visitors, such as a
 * guest cart's id, rides along on a cross-site form post too, which is why
 * `csrf: true` checks an anonymous caller's origin. Such a caller holds no
 * token, and needs none for the origin to be checked. The RESOLVED credential
 * decides: a browser can attach an Authorization header on its own (ambient
 * HTTP authentication), and classifying by header presence skipped the check
 * for a request whose session cookie admitted it.
 */
export function routeCsrfMode(
  route: PluginRoute,
  request: Request,
  credential: CallerCredential
): RouteCsrfMode {
  if (!isUnsafeMethod(request.method)) return "none";
  // A browser never attaches a Bearer token by itself, so a cross-site page
  // cannot make this request on someone else's behalf.
  if (credential === "bearer") return "none";
  // Anonymous: a route that asked for the check gets the origin half of it.
  // A route that did not ask keeps taking cross-origin writes, as a webhook
  // receiver or other server-facing route must.
  if (credential === "none") return route.csrf === true ? "origin" : "none";
  if (route.csrf === true) return "token";
  // Ahead of the public rule: collection refuses `csrf: false` on a public
  // route, and a route that reached here regardless still holds to it.
  if (route.csrf === false) return "refuse";
  // A public route skips the default: it authenticated no one, and a cookie
  // on the request — even an expired one — says nothing about what admitted
  // it. A public handler that resolves the session user does so through
  // `ctx.auth.currentUser`, which applies the same origin check to a write
  // and answers a cross-site one with no user; `csrf: true` adds the token.
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

/** Every method a route can declare; keyed so a new one must be added here. */
const ROUTE_METHODS: Record<RouteMethod, true> = {
  GET: true,
  POST: true,
  PATCH: true,
  PUT: true,
  DELETE: true,
};

/** Why a declared `principal` is not `{ kind, required? }`, or null. */
function principalShapeProblem(principal: unknown): string | null {
  if (!isPlainObject(principal)) {
    return `principal must be { kind, required? }, not ${JSON.stringify(principal)}`;
  }
  const { kind, required, ...rest } = principal;
  if (typeof kind !== "string" || Object.keys(rest).length > 0) {
    return `principal must be { kind, required? } with kind a string, not ${JSON.stringify(principal)}`;
  }
  if (required !== undefined && typeof required !== "boolean") {
    return `principal.required must be true or false, not ${JSON.stringify(required)}`;
  }
  return null;
}

/**
 * Why a route's `principal` cannot be served, or null when it can or the
 * route has none.
 *
 * The shape is checked as `rateLimit`'s is, for a JavaScript plugin with no
 * type to hold it. The two pairs are refused because each would hand the
 * route someone the option promises it never sees: a public route
 * authenticates nobody, and a permission is something only staff and API
 * keys hold, so the route would admit the staff it was declared to keep out.
 * Whether a plugin registers the kind is asked where routes are collected,
 * which has every plugin's kinds in hand.
 */
function principalOptionProblem(route: PluginRoute): string | null {
  if (route.principal === undefined) return null;
  const shapeProblem = principalShapeProblem(route.principal);
  if (shapeProblem !== null) return shapeProblem;
  if (route.public === true) {
    return "principal cannot be combined with public: true; a route that asks for a signed-in person is not public";
  }
  if (route.requiredPermission !== undefined) {
    return "principal cannot be combined with requiredPermission; a plugin's signed-in person holds no permission, so the route would admit staff instead";
  }
  return null;
}

/** Why a route's declared options are invalid, or null when they are fine. */
export function validateRouteOptions(route: PluginRoute): string | null {
  // As with `rateLimit` below, the union binds only TypeScript: a JavaScript
  // plugin's `"post"` would be registered under that literal, and requests,
  // whose methods are uppercase and matched exactly, would never reach it.
  if (
    typeof route.method !== "string" ||
    !Object.hasOwn(ROUTE_METHODS, route.method)
  ) {
    return `method must be one of ${Object.keys(ROUTE_METHODS).join(", ")}, not ${JSON.stringify(route.method)}`;
  }
  if (route.rawBody === true && !isUnsafeMethod(route.method)) {
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
  const principalProblem = principalOptionProblem(route);
  if (principalProblem !== null) return principalProblem;
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
 * caller counts as the same client and a `"general"` or `{ max, windowMs }`
 * route's per-client limit is one bucket for the whole site: one client can
 * spend it for everyone. The operator is told which routes do. An `"auth"`
 * route is left out: it is counted per identity under a ceiling instead, as
 * core's sign-in is, and {@link unkeyedAuthRouteWarnings} names the ones that
 * cannot say which identity a request names.
 */
export function rateLimitProxyWarning(
  routes: ReadonlyArray<{ fullPath: string; route: PluginRoute }>,
  trustProxy: boolean
): string | null {
  if (trustProxy) return null;
  const limited = routes
    .filter(
      entry =>
        entry.route.rateLimit !== undefined && entry.route.rateLimit !== "auth"
    )
    .map(entry => `${entry.route.method} ${entry.fullPath}`);
  if (limited.length === 0) return null;
  return (
    "[nextly] These plugin routes are rate limited per client, but " +
    "security.trustProxy is off, so no client address is read and every " +
    `client shares one limit: ${limited.join(", ")}. Turn on ` +
    "security.trustProxy when the app runs behind a proxy you control."
  );
}

/**
 * One boot warning for each `rateLimit: "auth"` plugin route without a
 * `limitKey`, or none while the auth limiter is off.
 *
 * Such a route's requests from clients whose address cannot be read are
 * bounded only by the plugin's ceiling, a hundred times the auth budget,
 * since nothing names the identity to count them by; nothing about a working
 * route shows that, so each is named where an operator reads.
 */
export function unkeyedAuthRouteWarnings(
  routes: ReadonlyArray<{
    pluginName: string;
    fullPath: string;
    route: PluginRoute;
  }>,
  authLimitOn: boolean
): string[] {
  if (!authLimitOn) return [];
  return routes
    .filter(
      entry =>
        entry.route.rateLimit === "auth" &&
        typeof entry.route.limitKey !== "function"
    )
    .map(
      entry =>
        `[nextly] Plugin "${entry.pluginName}" route ${entry.route.method} ` +
        `${entry.fullPath} is rate limited as auth but names no limitKey, so ` +
        "requests from clients whose address cannot be read are limited only " +
        "by a ceiling shared by the plugin's auth routes, not per identity. " +
        "Give the route a limitKey, or set security.trustProxy behind a proxy " +
        "that reports the client to limit them per client."
    );
}
