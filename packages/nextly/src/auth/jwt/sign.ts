import { randomBytes } from "node:crypto";

import { SignJWT } from "jose";

const ALGORITHM = "HS256";

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
 * @returns Signed JWT string
 */
export async function signAccessToken(
  claims: Record<string, unknown>,
  secret: string,
  ttlSeconds: number = 900
): Promise<string> {
  const { token } = await signAccessTokenWithExpiry(claims, secret, ttlSeconds);
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
 */
export async function signAccessTokenWithExpiry(
  claims: Record<string, unknown>,
  secret: string,
  ttlSeconds: number = 900
): Promise<{ token: string; expiresAt: Date }> {
  const key = secretToKey(secret);
  const jti = randomBytes(16).toString("hex");
  // Whole seconds, because that is the resolution `exp` and `iat` are defined
  // at; deriving the Date from the same integer keeps the two exact.
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;

  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .setJti(jti);

  return { token: await jwt.sign(key), expiresAt: new Date(expiresAt * 1000) };
}
