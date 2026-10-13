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
 *
 * Everything that decides what those tokens look like is written out here
 * rather than imported from the current code: the algorithm, the key the
 * secret becomes, and the pending marker. The tokens in circulation keep what
 * they were minted with, so a fixture that followed the current signer or
 * claims would move with them, and a change that broke real old tokens would
 * leave these tests passing.
 */
import { randomBytes } from "node:crypto";

import { SignJWT } from "jose";

/** The algorithm those tokens were signed with. */
const UNMARKED_ALGORITHM = "HS256";

/** The claim value that marked one of them as a pending-auth token. */
const UNMARKED_PENDING_MARKER = "pending-auth";

/** The key those tokens were signed with: the secret's UTF-8 bytes. */
function unmarkedKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

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
    .sign(unmarkedKey(secret));
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
    { typ: UNMARKED_PENDING_MARKER, ...unmarkedPendingClaims(userId) },
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
