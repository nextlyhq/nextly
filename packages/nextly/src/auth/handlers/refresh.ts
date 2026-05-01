/**
 * POST /auth/refresh
 * Rotates the refresh token and issues a new access token.
 * Re-fetches roles from DB (guarantees fresh roles within 15 min).
 */
import {
  setAccessTokenCookie,
  clearAccessTokenCookie,
} from "../cookies/access-token-cookie";
import {
  setRefreshTokenCookie,
  readRefreshTokenCookie,
  clearRefreshTokenCookie,
} from "../cookies/refresh-token-cookie";
import { clearCsrfCookie } from "../csrf/csrf-cookie";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";
import {
  hashRefreshToken,
  generateRefreshToken,
  generateRefreshTokenId,
} from "../session/refresh";

import { buildCookieHeaders, getClientIp } from "./handler-utils";

export interface RefreshHandlerDeps {
  secret: string;
  isProduction: boolean;
  accessTokenTTL: number;
  refreshTokenTTL: number;
  findRefreshTokenByHash: (
    tokenHash: string
  ) => Promise<{ id: string; userId: string; expiresAt: Date } | null>;
  deleteRefreshToken: (id: string) => Promise<void>;
  deleteAllRefreshTokensForUser: (userId: string) => Promise<void>;
  storeRefreshToken: (record: {
    id: string;
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }) => Promise<void>;
  findUserById: (userId: string) => Promise<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    isActive: boolean;
  } | null>;
  fetchRoleIds: (userId: string) => Promise<string[]>;
  fetchCustomFields: (userId: string) => Promise<Record<string, unknown>>;
}

export async function handleRefresh(
  request: Request,
  deps: RefreshHandlerDeps
): Promise<Response> {
  const rawToken = readRefreshTokenCookie(request);

  if (!rawToken) {
    return clearAndDeny("No refresh token");
  }

  const tokenHash = hashRefreshToken(rawToken);
  const tokenRecord = await deps.findRefreshTokenByHash(tokenHash);

  if (!tokenRecord) {
    // Token not found -- could be token theft (replayed consumed token).
    // The legitimate user's rotated token is still valid.
    return clearAndDeny("Invalid refresh token");
  }

  if (tokenRecord.expiresAt < new Date()) {
    await deps.deleteRefreshToken(tokenRecord.id);
    return clearAndDeny("Refresh token expired");
  }

  // Delete the consumed token (rotation)
  await deps.deleteRefreshToken(tokenRecord.id);

  const user = await deps.findUserById(tokenRecord.userId);
  if (!user || !user.isActive) {
    return clearAndDeny("User not found or inactive");
  }

  // Re-fetch fresh roles and custom fields
  const [roleIds, customFields] = await Promise.all([
    deps.fetchRoleIds(user.id),
    deps.fetchCustomFields(user.id),
  ]);

  const claims = buildClaims({
    userId: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    roleIds,
    customFields,
  });
  const accessToken = await signAccessToken(
    claims,
    deps.secret,
    deps.accessTokenTTL
  );

  const newRawToken = generateRefreshToken();
  const newTokenHash = hashRefreshToken(newRawToken);
  await deps.storeRefreshToken({
    id: generateRefreshTokenId(),
    userId: user.id,
    tokenHash: newTokenHash,
    userAgent: request.headers.get("user-agent"),
    ipAddress: getClientIp(request),
    expiresAt: new Date(Date.now() + deps.refreshTokenTTL * 1000),
  });

  const cookies = [
    setAccessTokenCookie(accessToken, deps.refreshTokenTTL, deps.isProduction),
    setRefreshTokenCookie(newRawToken, deps.refreshTokenTTL, deps.isProduction),
  ];

  return new Response(
    JSON.stringify({
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          roleIds,
        },
      },
    }),
    { status: 200, headers: buildCookieHeaders(cookies) }
  );
}

function clearAndDeny(message: string): Response {
  const clearCookies = [
    clearAccessTokenCookie(),
    clearRefreshTokenCookie(),
    clearCsrfCookie(),
  ];

  return new Response(
    JSON.stringify({
      error: { code: "REFRESH_FAILED", message },
    }),
    { status: 401, headers: buildCookieHeaders(clearCookies) }
  );
}
