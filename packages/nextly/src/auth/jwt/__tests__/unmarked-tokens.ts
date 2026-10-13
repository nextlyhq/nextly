/**
 * Tokens as this package signed them before a token's header named its
 * purpose: a protected header carrying the algorithm alone, with no `typ`.
 *
 * Nothing in the package mints one any more, but tokens minted that way are
 * still in circulation until they expire, and the verifier accepts an absent
 * header `typ` for them until the allowance ends. Tests that ask how a reader
 * treats one need a faithful copy of the old signer, and it lives here once so
 * every such test presents the same shape: the claims as given, plus the
 * `iat`, `exp` and `jti` the old signer always set.
 */
import { randomBytes } from "node:crypto";

import { SignJWT } from "jose";

import { PENDING_AUTH_TYP } from "../claims";
import { secretToKey } from "../sign";

/**
 * The algorithm those tokens were signed with, written out rather than taken
 * from the current signer: the tokens in circulation keep the algorithm they
 * were minted with, whatever the signer moves to later.
 */
const UNMARKED_ALGORITHM = "HS256";

/** Sign `claims` with a header that names the algorithm and nothing else. */
export async function signUnmarkedToken(
  claims: Record<string, unknown>,
  secret: string,
  ttlSeconds = 300
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: UNMARKED_ALGORITHM })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .setJti(randomBytes(16).toString("hex"))
    .sign(secretToKey(secret));
}

/** The claims the old `mintPendingToken` signed, apart from the pending marker. */
function unmarkedPendingClaims(userId: string): Record<string, unknown> {
  return { sub: userId, challengeId: "totp", attempts: 0 };
}

/**
 * A pending-auth token as the old `mintPendingToken` minted it: marked as
 * pending by its `typ` CLAIM only, which is all that tells it apart from an
 * unmarked session token for the same user.
 */
export function signUnmarkedPendingToken(
  userId: string,
  secret: string
): Promise<string> {
  return signUnmarkedToken(
    { typ: PENDING_AUTH_TYP, ...unmarkedPendingClaims(userId) },
    secret
  );
}

/**
 * The control for {@link signUnmarkedPendingToken}: the very same claims with
 * the pending marker left out. A reader that refuses the one and accepts the
 * other can only be telling them apart by that marker.
 */
export function signUnmarkedPendingTokenWithoutMarker(
  userId: string,
  secret: string
): Promise<string> {
  return signUnmarkedToken(unmarkedPendingClaims(userId), secret);
}
