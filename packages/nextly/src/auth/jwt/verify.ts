import { jwtVerify, errors as joseErrors } from "jose";

import type { NextlyJwtPayload } from "./claims.js";
import { secretToKey } from "./sign.js";

export type VerifyResult =
  | { valid: true; payload: NextlyJwtPayload }
  | { valid: false; reason: "expired" | "invalid" | "malformed" };

/**
 * Verify and decode a JWT access token.
 *
 * @param token - The JWT string from the cookie
 * @param secret - The NEXTLY_SECRET string
 * @returns VerifyResult with payload on success or reason on failure
 */
export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<VerifyResult> {
  try {
    const key = secretToKey(secret);
    const { payload } = await jwtVerify(token, key);
    return { valid: true, payload: payload as unknown as NextlyJwtPayload };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      return { valid: false, reason: "expired" };
    }
    // JWTClaimValidationFailed, JWSSignatureVerificationFailed, JWSInvalid, etc.
    return { valid: false, reason: "invalid" };
  }
}
