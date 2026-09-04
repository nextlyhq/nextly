import { randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { derivePurposeKey, HANDOFF_KEY_LABEL } from "./keys";

/**
 * How long a completed provider login may wait to be redeemed at
 * `POST /auth/login`.
 *
 * The token travels from the callback to the login page and is redeemed by
 * script on arrival, so the whole window is one redirect and one fetch. Sixty
 * seconds is generous for that and short enough that a token captured from a
 * browser history entry or a proxy log is almost always already dead.
 */
export const HANDOFF_TTL_SECONDS = 60;

/** The `typ` claim marking a token as a login handoff. */
const HANDOFF_TYP = "sso-handoff";

/** The verified identity a handoff token carries from the callback to the strategy. */
export interface HandoffClaims {
  /** Local user id the provider login resolved to. */
  userId: string;
  /** Provider key that authenticated them, e.g. `"google"`. */
  provider: string;
  /** Unique id for this handoff, used to enforce single use. */
  jti: string;
}

/** Thrown when a handoff token is missing, expired, tampered, replayed, or the wrong type. */
export class InvalidHandoffError extends Error {
  constructor(reason: string) {
    super(`invalid sso handoff token: ${reason}`);
    this.name = "InvalidHandoffError";
  }
}

/**
 * Remembers which handoff tokens have already been redeemed.
 *
 * A signed token with an expiry is replayable until it expires; single use is
 * what reduces the window to the first redemption. Entries are dropped once
 * their token could no longer verify anyway, so the set stays bounded by the
 * login rate over one TTL rather than growing without limit.
 *
 * This is per process, which is correct for a single instance and incomplete
 * behind several: a replay routed to a different worker sees an empty set. The
 * signature, the sixty-second expiry and the `typ` still hold there, so the
 * exposure is a replay inside one minute rather than an open one — and the
 * whole token disappears once core lets a plugin route mint a session directly.
 */
class RedeemedHandoffs {
  private readonly seen = new Map<string, number>();

  /** Record a redemption. Returns false when this token was already redeemed. */
  claim(jti: string, expiresAtMs: number): boolean {
    this.evictExpired();
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, expiresAtMs);
    return true;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(jti);
    }
  }

  /** Drop every record. Test seam; never called by the plugin at runtime. */
  reset(): void {
    this.seen.clear();
  }
}

const redeemed = new RedeemedHandoffs();

/** Drop the redeemed-handoff record. Exposed for tests, which need isolation between cases. */
export function resetRedeemedHandoffs(): void {
  redeemed.reset();
}

/**
 * Mint a short-lived handoff token for an already-verified provider login.
 *
 * The token asserts only that a provider authenticated this local user moments
 * ago. It is not a session and cannot become one: it is signed with a key
 * derived for this purpose alone, so core's session verifier — which checks an
 * HS256 signature against the raw application secret — cannot validate it.
 */
export async function mintHandoff(
  claims: Omit<HandoffClaims, "jti">,
  secret: string,
  ttlSeconds: number = HANDOFF_TTL_SECONDS
): Promise<string> {
  const key = derivePurposeKey(secret, HANDOFF_KEY_LABEL);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    typ: HANDOFF_TYP,
    sub: claims.userId,
    provider: claims.provider,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key);
}

/**
 * Verify and redeem a handoff token.
 *
 * Redemption is part of verification rather than a separate step the caller
 * could omit: a token that verifies twice is not single-use, and the only place
 * that would notice the omission is a replay.
 *
 * @throws InvalidHandoffError on expiry, tampering, the wrong token type, a
 *   malformed payload, or a second redemption.
 */
export async function verifyHandoff(
  token: string,
  secret: string
): Promise<HandoffClaims> {
  const key = derivePurposeKey(secret, HANDOFF_KEY_LABEL);
  let payload: Record<string, unknown>;
  try {
    // Pinned algorithm — an unpinned verifier trusts the token's own header,
    // which is how `alg: none` and HS-vs-RS confusion become forgeries.
    const result = await jwtVerify(token, key, { algorithms: ["HS256"] });
    payload = result.payload;
  } catch (err) {
    throw new InvalidHandoffError(
      err instanceof Error ? err.message : "verification-failed"
    );
  }

  if (payload.typ !== HANDOFF_TYP) throw new InvalidHandoffError("wrong-type");
  if (
    typeof payload.sub !== "string" ||
    typeof payload.provider !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new InvalidHandoffError("malformed");
  }

  if (!redeemed.claim(payload.jti, payload.exp * 1000)) {
    throw new InvalidHandoffError("already-redeemed");
  }

  return {
    userId: payload.sub,
    provider: payload.provider,
    jti: payload.jti,
  };
}
