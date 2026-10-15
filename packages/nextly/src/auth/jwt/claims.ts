/**
 * The claim a session token carries its account's session epoch in: the
 * number on the user row that rises whenever the account's sessions are
 * ended. A token signed at an older number is refused where a session is read
 * (`auth/session/session-standing`).
 *
 * Namespaced, because claim names were the app's own before this one: a
 * custom user field or a `customizeClaims` claim called plainly `sev` keeps
 * working, and a token signed before the upgrade with such a claim is not
 * read as carrying an epoch.
 */
export const SESSION_EPOCH_CLAIM = "nx_sev";

// Standard JWT claims that are excluded from session user data. `typ` is here
// because a custom user field of that name would otherwise be spread into the
// claims and read as a token kind, and the session epoch for the same reason:
// a custom field of that name would decide which tokens stay valid, and a
// login hook may not set it either (`auth/pipeline/hooks.ts`).
export const JWT_INTERNAL_CLAIMS = [
  "iat",
  "exp",
  "jti",
  "sub",
  "nbf",
  "aud",
  "iss",
  "typ",
  SESSION_EPOCH_CLAIM,
] as const;

/**
 * The `typ` CLAIM that marks a token as a single-purpose pending-auth token,
 * as distinct from the JWS header `typ` in {@link TOKEN_TYP}. It lives here
 * rather than beside the pending-token helpers so the verifier can refuse one
 * without importing them, which would make the two modules import each other.
 */
export const PENDING_AUTH_TYP = "pending-auth";

export interface NextlyJwtPayload {
  // Standard claims
  sub: string; // User ID
  iat: number; // Issued at
  exp: number; // Expires at
  jti: string; // Unique token ID

  // Nextly claims
  email: string;
  name: string;
  image: string | null;
  roleIds: string[];
  /** The session epoch the token was signed at; absent on older tokens. */
  nx_sev?: number;

  // Custom user fields from user_ext table (spread dynamically)
  [key: string]: unknown;
}

export interface BuildClaimsInput {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  roleIds: string[];
  /**
   * The account's session epoch as the user row holds it now. Every core
   * caller passes it. Optional so code that builds its own claims keeps
   * compiling: left out, it is zero, so the token works until the account's
   * sessions are first ended and is refused from then on, which errs toward
   * signing the person out rather than keeping them in.
   */
  sessionEpoch?: number;
  customFields?: Record<string, unknown>;
}

/**
 * Build JWT claims from user data.
 * Does NOT set iat/exp/jti -- those are set by the signing function.
 */
export function buildClaims(input: BuildClaimsInput): Record<string, unknown> {
  const claims: Record<string, unknown> = {
    sub: input.userId,
    email: input.email,
    name: input.name,
    image: input.image,
    roleIds: input.roleIds,
    [SESSION_EPOCH_CLAIM]: input.sessionEpoch ?? 0,
  };

  // Spread custom user fields (from user_ext table)
  if (input.customFields) {
    for (const [key, value] of Object.entries(input.customFields)) {
      // Don't overwrite standard or Nextly claims
      if (
        !JWT_INTERNAL_CLAIMS.includes(
          key as (typeof JWT_INTERNAL_CLAIMS)[number]
        ) &&
        !(key in claims)
      ) {
        claims[key] = value;
      }
    }
  }

  return claims;
}
