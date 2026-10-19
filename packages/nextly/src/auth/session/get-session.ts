import { readAccessTokenCookie } from "../cookies/access-token-cookie";
import { JWT_INTERNAL_CLAIMS, type NextlyJwtPayload } from "../jwt/claims";
import { verifyAccessToken, type VerifyResult } from "../jwt/verify";

import { sessionTokenIsCurrent } from "./session-standing";
import type { SessionUser } from "./session-types";

export type GetSessionResult =
  | { authenticated: true; user: SessionUser }
  | { authenticated: false; reason: "no_token" | "expired" | "invalid" };

/**
 * Extract and verify the session from a request.
 *
 * The signature says core issued the token; it does not say the account may
 * still use it. So a verified token is also checked against its account's
 * row, cached for a few seconds (`session-standing`): one that no longer
 * exists, is not active, or has had its sessions ended since the token was
 * signed answers `invalid`. That is within ten seconds of a deactivation or
 * an administrator setting the password, at every place that reads a session
 * through here. A failure to read the row throws rather than answering.
 */
export async function getSession(
  request: Request,
  secret: string
): Promise<GetSessionResult> {
  const token = readAccessTokenCookie(request);
  if (!token) {
    return { authenticated: false, reason: "no_token" };
  }

  const result: VerifyResult = await verifyAccessToken(token, secret);

  if (!result.valid) {
    return {
      authenticated: false,
      reason: result.reason === "expired" ? "expired" : "invalid",
    };
  }

  // A single-purpose pending-auth token (issued mid-challenge, D71) is a valid
  // JWT but must NEVER establish a full session — it only authorizes
  // /auth/challenge/resolve. The refusal now lives in the verifier, which is
  // reached by every session-resolution path (requireAuth, /auth/session,
  // determineUser fallthrough) rather than only by the ones that remembered.
  // After the signature, so a request without a token core signed never
  // reaches the database.
  if (!(await sessionTokenIsCurrent(result.payload))) {
    return { authenticated: false, reason: "invalid" };
  }

  const user = payloadToSessionUser(result.payload);
  return { authenticated: true, user };
}

function payloadToSessionUser(payload: NextlyJwtPayload): SessionUser {
  const user: Record<string, unknown> = {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    image: payload.image,
    roleIds: payload.roleIds || [],
  };

  // Spread custom fields (anything not in standard or known claims)
  const knownClaims = new Set([
    ...JWT_INTERNAL_CLAIMS,
    "sub",
    "email",
    "name",
    "image",
    "roleIds",
  ]);

  for (const [key, value] of Object.entries(payload)) {
    if (!knownClaims.has(key)) {
      user[key] = value;
    }
  }

  return user as SessionUser;
}

/**
 * Check if a session user has a specific role.
 */
export function hasRole(user: SessionUser, roleSlug: string): boolean {
  return user.roleIds.includes(roleSlug);
}

/**
 * Check if a session user has any of the specified roles.
 */
export function hasAnyRole(user: SessionUser, roleSlugs: string[]): boolean {
  return roleSlugs.some(slug => user.roleIds.includes(slug));
}

/**
 * Check if a session user has all of the specified roles.
 */
export function hasAllRoles(user: SessionUser, roleSlugs: string[]): boolean {
  return roleSlugs.every(slug => user.roleIds.includes(slug));
}
