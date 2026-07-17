/**
 * Invite-token primitives shared by the two flows that issue and consume a
 * set-password link: {@link AuthService} (issue on demand, accept over HTTP)
 * and user creation (mint the link in the same transaction as the account).
 *
 * Keeping the value generation, hashing, and expiry in one place makes the
 * hash a single source of truth — a token stored by one flow must verify
 * against the hash computed by the other, so the algorithm cannot be allowed
 * to drift between them.
 *
 * @module domains/auth/lib/invite-token
 */

import { randomBytes, createHash } from "crypto";

import { getBaseUrl } from "../../../shared/lib/get-base-url";

/**
 * How long a set-password link stays valid. Seven days is the self-hosted
 * convention (GitHub, Vercel, Directus) — long enough to survive a weekend,
 * short enough that a leaked link expires on its own.
 */
export const INVITE_TOKEN_EXPIRY_HOURS = 24 * 7;

/**
 * Where a consumer's admin serves the accept-invite page. Mirrors the
 * reset-password / verify-email path family; the link is built against the
 * app's public base URL.
 */
export const ACCEPT_INVITE_PATH = "/admin/accept-invite";

/** SHA-256 hex digest of the raw token. Only the digest is ever stored. */
export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** A freshly generated invite token: the raw value, its hash, and its expiry. */
export interface InviteTokenValue {
  /** The raw, single-use token. Handed to the admin once and never stored. */
  token: string;
  /** SHA-256 digest of {@link token} — this is what the database keeps. */
  tokenHash: string;
  /** When the link stops working. */
  expiresAt: Date;
}

/**
 * Generate a 256-bit CSPRNG token with its hash and expiry. Pure computation —
 * the caller is responsible for persisting the hash.
 */
export function generateInviteTokenValue(): InviteTokenValue {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(
      Date.now() + INVITE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000
    ),
  };
}

/**
 * Build the copyable set-password link from a raw token. The base URL follows
 * the same resolution as outbound email links (`getBaseUrl`), so a configured
 * `NEXT_PUBLIC_APP_URL` produces an absolute link in every environment.
 */
export function buildAcceptInviteLink(
  rawToken: string,
  baseUrlOverride?: string | null
): string {
  const baseUrl = getBaseUrl(baseUrlOverride);
  return `${baseUrl}${ACCEPT_INVITE_PATH}?token=${encodeURIComponent(rawToken)}`;
}
