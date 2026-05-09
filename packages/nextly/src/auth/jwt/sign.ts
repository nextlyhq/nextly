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
  const key = secretToKey(secret);
  const jti = randomBytes(16).toString("hex");

  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setJti(jti);

  return jwt.sign(key);
}
