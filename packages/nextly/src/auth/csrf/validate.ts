import { timingSafeEqual } from "node:crypto";

/**
 * Compare two CSRF tokens using constant-time comparison.
 * Prevents timing attacks on token validation.
 */
export function csrfTokensMatch(
  cookieToken: string,
  requestToken: string
): boolean {
  if (!cookieToken || !requestToken) return false;
  if (cookieToken.length !== requestToken.length) return false;

  try {
    const a = Buffer.from(cookieToken, "utf-8");
    const b = Buffer.from(requestToken, "utf-8");
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Methods that change something, and so need a cross-site check. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Whether `method` changes something, and so needs a cross-site check. */
export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

/**
 * Whether the request carries a `Bearer` token, which exempts it from the
 * cross-site check by its presence.
 *
 * A page on another site cannot make the browser attach a `Bearer` header, so
 * a request carrying one was sent by code that holds the token. The scheme is
 * matched without regard to case, as HTTP defines it, and the token must not
 * be empty: `Authorization: Bearer` alone carries nothing.
 */
export function carriesBearerToken(request: Request): boolean {
  const header = request.headers.get("authorization");
  return header !== null && /^bearer[ \t]+\S/i.test(header);
}

/**
 * Validate the Origin or Referer header against allowed origins.
 * Returns true if the request origin is allowed.
 */
export function validateOrigin(
  request: Request,
  allowedOrigins: string[]
): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const requestOrigin = origin || (referer ? refererOrigin(referer) : null);

  if (!requestOrigin) {
    // No origin header -- reject to be safe
    return false;
  }

  // Always allow the request's own host
  const selfOrigin = acceptedOwnOrigin(request);

  const allAllowed = [selfOrigin, ...allowedOrigins];

  return (
    allAllowed.some(
      allowed => requestOrigin.toLowerCase() === allowed.toLowerCase()
    ) || loopbackPageSubmittingToItself(request, requestOrigin)
  );
}

/** The three names of this machine a development server is opened at. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * In development only: whether the request comes from a page on a loopback
 * address and was sent to exactly that address.
 *
 * Under `next dev` the request's own origin, as `request.url` gives it, is the
 * server's configured host, not the address the browser used, so a page
 * opened at `127.0.0.1` for an app at `localhost` was refused on its own
 * server. Accepted here: an `Origin` naming `localhost`, `127.0.0.1` or
 * `[::1]` that is exactly the scheme and `Host` the request was sent with.
 * That is the request reaching the listener the page came from.
 *
 * What stays refused:
 * - Another loopback name, even on the same port: two listeners can hold
 *   `127.0.0.1:3000` and `[::1]:3000`, and be different applications.
 * - Any other host, `*.localhost` included. A page that rebinds its own
 *   domain to this machine still sends that domain as its origin.
 * - Anything outside development: production keeps the exact check.
 */
function loopbackPageSubmittingToItself(
  request: Request,
  requestOrigin: string
): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const host = request.headers.get("host");
  if (!host) return false;
  let origin: URL;
  try {
    origin = new URL(requestOrigin);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(origin.hostname.toLowerCase())) return false;
  const sentTo = `${new URL(request.url).protocol}//${host}`;
  return origin.origin.toLowerCase() === sentTo.toLowerCase();
}

/**
 * The origin a `Referer` names, or null when it is not a URL. A malformed
 * header is a refusal like a missing one, not a thrown error that answered
 * 500 instead of the CSRF refusal.
 */
function refererOrigin(referer: string): string | null {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * What a CSRF check answers. A refusal says which half refused: the token, or
 * the origin the request came from. The two need different things from the
 * person who sent it, a fresh page or a different address, so a form that is
 * refused can only say which if the answer does.
 */
export interface CsrfResult {
  valid: boolean;
  error?: string;
  reason?: "token" | "origin";
}

/**
 * The origin this check always accepts: the request's own, as the server
 * reads it. Under `next dev` that is the server's configured host, which need
 * not be the address the browser used (`127.0.0.1` for `localhost`).
 */
export function acceptedOwnOrigin(request: Request): string {
  return new URL(request.url).origin;
}

/**
 * Full CSRF validation: double-submit cookie + origin check.
 *
 * @param request - The incoming request
 * @param cookieToken - Token from the nextly_csrf cookie
 * @param requestToken - Token from request body or X-CSRF-Token header
 * @param allowedOrigins - Additional allowed origins from config
 */
export function validateCsrf(
  request: Request,
  cookieToken: string | null,
  requestToken: string | null,
  allowedOrigins: string[] = []
): CsrfResult {
  if (!cookieToken || !requestToken) {
    return { valid: false, error: "Missing CSRF token", reason: "token" };
  }

  if (!csrfTokensMatch(cookieToken, requestToken)) {
    return { valid: false, error: "Invalid CSRF token", reason: "token" };
  }

  if (!validateOrigin(request, allowedOrigins)) {
    return { valid: false, error: "Invalid request origin", reason: "origin" };
  }

  return { valid: true };
}
