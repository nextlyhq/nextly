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
import { validateCsrf } from "../../auth/csrf/validate";

import type { PluginRoute } from "./route-types";

/** Methods that change something, and so need CSRF protection. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** How a caller proved who they are, which decides whether CSRF applies. */
export type CallerCredential = "cookie" | "bearer" | "none";

/**
 * How the caller authenticated.
 *
 * An `Authorization` header is the discriminator: a browser never attaches one
 * cross-site on its own, so a request carrying one was made deliberately by
 * whoever holds the credential.
 */
export function callerCredential(request: Request): CallerCredential {
  if (request.headers.get("authorization")) return "bearer";
  return request.headers.get("cookie") ? "cookie" : "none";
}

/** Whether this request must present a CSRF token. */
export function csrfApplies(route: PluginRoute, request: Request): boolean {
  if (route.csrf !== true) return false;
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return false;
  // Only a cookie travels automatically, so only a cookie-authenticated
  // request can be made by a site the user did not intend to act on.
  return callerCredential(request) === "cookie";
}

/** Check the CSRF token, when one is required. */
export function checkRouteCsrf(
  route: PluginRoute,
  request: Request,
  body: Record<string, unknown> | undefined,
  allowedOrigins: string[]
): { valid: boolean; error?: string } {
  if (!csrfApplies(route, request)) return { valid: true };
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
 * The rate-limit bucket key for this route and caller.
 *
 * Namespaced by plugin, so one plugin's traffic cannot exhaust another's
 * budget, and separate from core's `/auth/*` bucket for the same reason.
 */
export function rateLimitKey(
  route: PluginRoute,
  pluginSlug: string,
  ip: string
): string | null {
  if (route.rateLimit !== "auth") return null;
  return `plugin-auth-ip:${pluginSlug}:${ip}`;
}

/** Why a route's declared options are invalid, or null when they are fine. */
export function validateRouteOptions(route: PluginRoute): string | null {
  if (route.csrf === true && route.public === true) {
    // A public route has no cookie identity to protect: CSRF defends a
    // credential the browser attaches automatically, and there is none here.
    // Accepting the combination would suggest a protection that is not there.
    return "csrf cannot be set on a public route: there is no cookie identity to protect";
  }
  if (route.rawBody === true && !UNSAFE_METHODS.has(route.method)) {
    return `rawBody is only meaningful on a method with a body, not ${route.method}`;
  }
  return null;
}
