import { createHash, randomBytes } from "node:crypto";

/**
 * The cart token: the only thing that finds a shopper's cart.
 *
 * 32 bytes from the operating system's secure random source, written as
 * base64url (43 characters), so it cannot be guessed. Only its SHA-256 is
 * stored: a copy of the database reaches no cart, and a slow hash would add
 * nothing to a value with 256 bits of entropy.
 */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Make a new cart token. */
export function newCartToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** The stored form of a token: its SHA-256, as 64 hex characters. */
export function hashCartToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A token as it arrived from outside, or `null` when it is not one this
 * plugin could have made. A malformed value is never looked up, so it cannot
 * reach a cart or be used to probe the table.
 */
export function parseCartToken(value: unknown): string | null {
  return typeof value === "string" && TOKEN_PATTERN.test(value) ? value : null;
}

/**
 * The cookie's name. With `secure`, the `__Host-` prefix makes the browser
 * refuse it unless it is `Secure`, has `Path=/` and names no domain, so no
 * subdomain and no plain-HTTP page can set or replace it. Without `secure`,
 * as in local development over HTTP, the prefix would make the browser drop
 * the cookie, so the plain name is used.
 *
 * @experimental
 */
export function cartCookieName(secure: boolean): string {
  return secure ? "__Host-commerce-cart" : "commerce-cart";
}

/**
 * The cart token from a request's `Cookie` header, or `null` when there is
 * none or it is malformed. Only the name for this mode is read: in production
 * a cookie without the prefix, which a subdomain could have set, is ignored.
 *
 * @experimental
 */
export function readCartToken(
  request: Request,
  secure: boolean
): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const name = cartCookieName(secure);
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    // The first cookie of the name is the one read. A token never needs
    // decoding, since base64url is cookie-safe, so a value that would is not
    // a token.
    return parseCartToken(part.slice(separator + 1).trim());
  }
  return null;
}

/**
 * The `Set-Cookie` value that keeps `token` in the browser until `expiresAt`,
 * the cart's own deadline, so the cookie never outlives the cart nor ends
 * before it. It is persistent rather than a session cookie: closing the
 * browser must not lose a cart the server still keeps.
 *
 * @experimental
 */
export function cartCookieHeader(input: {
  readonly token: string;
  readonly expiresAt: Date;
  readonly now: Date;
  readonly secure: boolean;
}): string {
  const maxAge = Math.max(
    0,
    Math.floor((input.expiresAt.getTime() - input.now.getTime()) / 1000)
  );
  return cookie(
    cartCookieName(input.secure),
    input.token,
    maxAge,
    input.secure
  );
}

/** The `Set-Cookie` value that removes the cart cookie. @experimental */
export function clearCartCookieHeader(secure: boolean): string {
  return cookie(cartCookieName(secure), "", 0, secure);
}

// HttpOnly so no script on the site can read the token; SameSite=Lax so
// another site's page cannot send a cart change with it; Path=/ so every
// storefront page can read it.
function cookie(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean
): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${String(maxAge)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
