import { randomBytes } from "node:crypto";

import { SignJWT } from "jose";

export const ALGORITHM = "HS256";

/**
 * JWS `typ` values (RFC 8725 §3.11), one per purpose, so a token minted for
 * one job cannot verify as another. Without it every HS256 token signed with
 * `NEXTLY_SECRET` that carries a `sub` is accepted as a session, whatever it
 * was issued for.
 */
export const TOKEN_TYP = {
  session: "nextly-session+jwt",
  pending: "nextly-pending+jwt",
} as const;

export type TokenPurpose = keyof typeof TOKEN_TYP;

/**
 * A protected-header parameter that says the token was minted with the session
 * epoch claim. The header is signed, so only Nextly's own signing can set it.
 * Tokens minted before the claim existed have no such header, and the verifier
 * ignores their `nx_sev` claim, which an application's own field may carry.
 */
export const EPOCH_CLAIM_HEADER = "nxe";
export const EPOCH_CLAIM_HEADER_VALUE = 1;

/**
 * Convert a string secret to a Uint8Array key for jose.
 * Uses the raw bytes of the secret (UTF-8 encoded).
 */
export function secretToKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Sign a JWT access token.
 *
 * @param claims - The payload claims (from buildClaims)
 * @param secret - The NEXTLY_SECRET string
 * @param ttlSeconds - Token TTL in seconds (default 900 = 15 minutes)
 * @param notAfter - The latest moment, epoch ms, the token may be valid; see
 *   {@link signAccessTokenWithExpiry}.
 * @returns Signed JWT string
 */
export async function signAccessToken(
  claims: Record<string, unknown>,
  secret: string,
  ttlSeconds: number = 900,
  purpose: TokenPurpose = "session",
  notAfter?: number
): Promise<string> {
  const { token } = await signAccessTokenWithExpiry(
    claims,
    secret,
    ttlSeconds,
    purpose,
    notAfter
  );
  return token;
}

/**
 * Sign an access token and report the expiry it actually carries.
 *
 * Every caller that returns an `expiresAt` to a client must use this rather
 * than deriving one itself. Signing and responding are separated by awaited
 * work — storing the refresh token, running plugin `afterLogin` hooks, writing
 * the audit record — and a second clock reading taken after that work names a
 * later moment than the token holds. The overstatement is unbounded, because a
 * plugin hook is arbitrary code, and a client trusting it keeps sending a token
 * the server has already rejected.
 *
 * The timestamps are computed once and set explicitly rather than left to a
 * relative expression, so the returned `expiresAt` IS the `exp` claim rather
 * than a parallel calculation that happens to agree.
 *
 * `notAfter` (epoch ms) bounds `exp` absolutely: it is the last whole second
 * at or before that moment when that is sooner than the TTL's end. A session
 * passes the moment the first of its roles lapses, so its token stops being
 * accepted no later than that. Bounding here, against the same `issuedAt`,
 * rather than shortening the TTL beforehand keeps the bound exact: a TTL
 * worked out from an earlier clock reading moves with the second the token
 * is then issued in. A bound inside the current second yields a token that
 * is already expired, which the client refreshes, and the refresh no longer
 * carries the lapsed role.
 */
export async function signAccessTokenWithExpiry(
  claims: Record<string, unknown>,
  secret: string,
  ttlSeconds: number = 900,
  purpose: TokenPurpose = "session",
  notAfter?: number
): Promise<{ token: string; expiresAt: Date }> {
  const key = secretToKey(secret);
  const jti = randomBytes(16).toString("hex");
  // Whole seconds, because that is the resolution `exp` and `iat` are defined
  // at; deriving the Date from the same integer keeps the two exact.
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt =
    notAfter === undefined
      ? issuedAt + ttlSeconds
      : Math.min(issuedAt + ttlSeconds, Math.floor(notAfter / 1000));

  const jwt = new SignJWT(claims)
    .setProtectedHeader({
      alg: ALGORITHM,
      typ: TOKEN_TYP[purpose],
      [EPOCH_CLAIM_HEADER]: EPOCH_CLAIM_HEADER_VALUE,
    })
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .setJti(jti);

  return { token: await jwt.sign(key), expiresAt: new Date(expiresAt * 1000) };
}
