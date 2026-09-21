import { PENDING_AUTH_TYP } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";
import { verifyToken } from "../jwt/verify";

/**
 * The `typ` claim that marks a token as a single-purpose pending-auth token.
 * The access guard (`require-auth`) rejects any token carrying this, so a
 * pending token can NEVER be used to authenticate a normal request.
 *
 * Defined in `jwt/claims` and re-exported here, where its consumers look for
 * it, so the verifier can refuse one without importing this module.
 */
export { PENDING_AUTH_TYP };

/**
 * Sentinel `challengeId` for the forced first-sign-in password change. A user
 * whose account still holds an admin-set password is issued a pending token
 * carrying this id instead of a session; `handleSetInitialPassword` accepts
 * only tokens marked with it.
 */
export const MUST_CHANGE_PASSWORD_CHALLENGE = "must-change-password";

export interface PendingClaims {
  userId: string;
  challengeId: string;
  attempts: number;
  /**
   * The strategy that authenticated the login this challenge interrupted.
   * Signed into the token so it survives the round trip: the browser holds the
   * token between the challenge and its answer, and the session the answer
   * mints must record the method that actually signed the person in.
   */
  strategy?: string;
}

/**
 * @experimental Mint a short-lived, signed pending-auth token (D71). It carries
 * only the candidate user, the challenge it gates, and an attempt counter — it
 * authorizes nothing except resolving that challenge.
 */
export async function mintPendingToken(
  claims: PendingClaims,
  secret: string,
  ttlSeconds: number
): Promise<string> {
  return signAccessToken(
    {
      typ: PENDING_AUTH_TYP,
      sub: claims.userId,
      challengeId: claims.challengeId,
      attempts: claims.attempts,
      ...(claims.strategy ? { strategy: claims.strategy } : {}),
    },
    secret,
    ttlSeconds,
    "pending"
  );
}

/** Thrown when a pending-auth token is missing, expired, tampered, or the wrong type. */
export class InvalidPendingTokenError extends Error {
  constructor(reason: string) {
    super(`invalid pending-auth token: ${reason}`);
    this.name = "InvalidPendingTokenError";
  }
}

/**
 * @experimental Verify a pending-auth token and return its claims. Throws
 * {@link InvalidPendingTokenError} on expiry/tamper/wrong-type — the resolve
 * handler maps that to a generic 401.
 */
export async function verifyPendingToken(
  token: string,
  secret: string
): Promise<PendingClaims> {
  const result = await verifyToken(token, secret, "pending");
  if (!result.valid) throw new InvalidPendingTokenError(result.reason);
  if (result.payload.typ !== PENDING_AUTH_TYP) {
    throw new InvalidPendingTokenError("wrong-type");
  }
  return {
    userId: String(result.payload.sub),
    challengeId: String(result.payload.challengeId),
    attempts: Number(result.payload.attempts ?? 0),
    // A token minted before the claim existed came from the password path,
    // which was the only one that could reach a challenge.
    strategy:
      typeof result.payload.strategy === "string"
        ? result.payload.strategy
        : "password",
  };
}
