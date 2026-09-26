import { jwtVerify, errors as joseErrors } from "jose";

import { PENDING_AUTH_TYP, type NextlyJwtPayload } from "./claims";
import { ALGORITHM, secretToKey, TOKEN_TYP, type TokenPurpose } from "./sign";

export type VerifyResult =
  | { valid: true; payload: NextlyJwtPayload }
  | { valid: false; reason: "expired" | "invalid" | "malformed" };

/**
 * Verify a token for ONE purpose.
 *
 * A header `typ` naming another purpose is refused, so a token minted for a
 * challenge or any future single-purpose flow cannot be presented as a
 * session. An absent header `typ` is still accepted, because tokens already in
 * circulation were minted before the header existed; a later release drops
 * that allowance. Pending tokens are additionally recognised by their claim,
 * as they were before, which is what covers those legacy tokens meanwhile.
 *
 * The algorithm list is explicit: left implicit, a token declaring `alg:
 * "none"` can talk the verifier out of checking the signature.
 */
export async function verifyToken(
  token: string,
  secret: string,
  purpose: TokenPurpose
): Promise<VerifyResult> {
  try {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      secretToKey(secret),
      { algorithms: [ALGORITHM] }
    );
    const typ = protectedHeader.typ;
    if (typ !== undefined && typ !== TOKEN_TYP[purpose]) {
      return { valid: false, reason: "invalid" };
    }
    if (purpose === "session" && payload.typ === PENDING_AUTH_TYP) {
      return { valid: false, reason: "invalid" };
    }
    return { valid: true, payload: payload as unknown as NextlyJwtPayload };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      return { valid: false, reason: "expired" };
    }
    // JWTClaimValidationFailed, JWSSignatureVerificationFailed, JWSInvalid, etc.
    return { valid: false, reason: "invalid" };
  }
}

/**
 * Verify and decode a JWT access token.
 *
 * A thin wrapper over {@link verifyToken} for the session purpose, so every
 * existing caller gets the typed-token rules without being edited.
 *
 * @param token - The JWT string from the cookie
 * @param secret - The NEXTLY_SECRET string
 * @returns VerifyResult with payload on success or reason on failure
 */
export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<VerifyResult> {
  return verifyToken(token, secret, "session");
}
