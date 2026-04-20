// Standard JWT claims that are excluded from session user data
export const JWT_INTERNAL_CLAIMS = [
  "iat",
  "exp",
  "jti",
  "sub",
  "nbf",
  "aud",
  "iss",
] as const;

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

  // Custom user fields from user_ext table (spread dynamically)
  [key: string]: unknown;
}

export interface BuildClaimsInput {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  roleIds: string[];
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
