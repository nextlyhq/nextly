import { createHash, randomBytes } from "node:crypto";

/**
 * Bytes of entropy behind a PKCE code verifier, a `state`, or a `nonce`.
 *
 * Thirty-two bytes base64url-encode to exactly 43 characters, which is the
 * minimum length RFC 7636 permits for a verifier. Picking the floor is
 * deliberate: the ceiling (128) buys no security over a 256-bit random value
 * and every extra character is carried in a cookie and a query string.
 */
const ENTROPY_BYTES = 32;

/**
 * base64url per RFC 4648 §5 — the alphabet OAuth and JOSE use, with padding
 * stripped. Node can emit this directly, so there is no character rewriting to
 * get subtly wrong.
 */
function base64url(input: Buffer): string {
  return input.toString("base64url");
}

/**
 * A PKCE code verifier: 43 characters drawn from the unreserved set.
 *
 * base64url output is a subset of the `[A-Za-z0-9\-._~]` unreserved set RFC
 * 7636 §4.1 requires, so the value needs no escaping in the token request body
 * and survives a round trip through a cookie unchanged.
 */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(ENTROPY_BYTES));
}

/**
 * Derive the `S256` code challenge for a verifier.
 *
 * Always `S256`, never `plain`: a `plain` challenge is the verifier itself, so
 * an attacker who can read the authorization request can replay the code. OAuth
 * 2.1 removes `plain` for exactly that reason.
 */
export function deriveCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/**
 * An opaque `state` value.
 *
 * `state` is the CSRF anchor: it binds the callback to the browser that started
 * the flow, which is what stops an attacker completing someone else's login by
 * feeding them a callback URL. It is NOT interchangeable with `nonce` (replay
 * of an ID token) or with PKCE (interception of the code) — the three defend
 * different attacks and this plugin sends all three wherever the provider
 * supports them.
 */
export function generateState(): string {
  return base64url(randomBytes(ENTROPY_BYTES));
}

/**
 * An opaque OIDC `nonce`.
 *
 * Echoed back inside the ID token so a token minted for a different
 * authorization request cannot be replayed into this one. Providers that are
 * not OIDC (GitHub) issue no ID token and therefore carry no nonce; the
 * transaction still stores one so the record shape does not vary per provider.
 */
export function generateNonce(): string {
  return base64url(randomBytes(ENTROPY_BYTES));
}
