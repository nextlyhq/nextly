import { signAccessToken } from "../jwt/sign";
import { verifyAccessToken } from "../jwt/verify";

/**
 * The `typ` claim that marks a token as a single-purpose pending-auth token.
 * The access guard (`require-auth`) rejects any token carrying this, so a
 * pending token can NEVER be used to authenticate a normal request.
 */
export const PENDING_AUTH_TYP = "pending-auth";

export interface PendingClaims {
  userId: string;
  challengeId: string;
  attempts: number;
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
    },
    secret,
    ttlSeconds
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
  const result = await verifyAccessToken(token, secret);
  if (!result.valid) throw new InvalidPendingTokenError(result.reason);
  if (result.payload.typ !== PENDING_AUTH_TYP) {
    throw new InvalidPendingTokenError("wrong-type");
  }
  return {
    userId: String(result.payload.sub),
    challengeId: String(result.payload.challengeId),
    attempts: Number(result.payload.attempts ?? 0),
  };
}
