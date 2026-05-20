/**
 * POST /auth/refresh
 * Rotates the refresh token and issues a new access token.
 * Re-fetches roles from DB (guarantees fresh roles within 15 min).
 */
import { readOrGenerateRequestId } from "../../api/request-id";
import { respondData } from "../../api/response-shapes";
import { NextlyError } from "../../errors";
import { getNextlyLogger } from "../../observability/logger";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
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
import { evaluateRefreshBinding } from "../session/refresh-binding";

import { buildCookieHeaders, buildAuthErrorResponse } from "./handler-utils";

export interface RefreshHandlerDeps {
  secret: string;
  isProduction: boolean;
  accessTokenTTL: number;
  refreshTokenTTL: number;
  findRefreshTokenByHash: (tokenHash: string) => Promise<{
    id: string;
    userId: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  } | null>;
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
  /** Gate XFF parsing on this. Default false. */
  trustProxy: boolean;
  /** CIDR list of proxy IPs (from TRUSTED_PROXY_IPS). */
  trustedProxyIps: string[];
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

  // Outer try/catch: ANY DB error during rotation must surface as a 503
  // envelope rather than `clearAndDeny`. The latter wipes the user's
  // cookies and forces a re-login -- destructive behavior for what may
  // be a momentary pool hiccup on a hosted database. As long as we have
  // not yet deleted the old refresh token, returning 503 leaves the
  // session intact: the client backs off, the next request fires a new
  // refresh, and the user keeps working.
  try {
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

    // Enforce refresh-token UA + trusted-IP binding before honoring
    // rotation. A hard mismatch (IP family flip or /24 / /48 prefix
    // change) revokes every refresh token for the user, since one
    // confirmed network mismatch suggests theft rather than benign
    // rotation.
    const currentUserAgent = request.headers.get("user-agent");
    const currentIp = getTrustedClientIp(request, {
      trustProxy: deps.trustProxy,
      trustedProxyIps: deps.trustedProxyIps,
    });
    const binding = evaluateRefreshBinding({
      storedUserAgent: tokenRecord.userAgent,
      currentUserAgent,
      storedIp: tokenRecord.ipAddress,
      currentIp,
    });

    if (binding.kind === "hard") {
      await deps.deleteRefreshToken(tokenRecord.id);
      await deps.deleteAllRefreshTokensForUser(tokenRecord.userId);
      getNextlyLogger().warn({
        kind: "refresh-binding-hard-fail",
        reason: binding.reason,
        tokenId: tokenRecord.id,
        userId: tokenRecord.userId,
      });
      return clearAndDeny("Session binding mismatch");
    }

    if (binding.kind === "soft") {
      getNextlyLogger().warn({
        kind: "refresh-binding-soft-warn",
        reason: binding.reason,
        tokenId: tokenRecord.id,
        userId: tokenRecord.userId,
      });
    }

    // Read-only phase: do every lookup BEFORE the destructive delete.
    // If any of these throws on a transient DB failure, the old token is
    // still valid and the catch block below returns a 503 -- the user's
    // session survives. The previous order (delete -> findUserById ->
    // ...) would leave the user with no refresh token if any lookup
    // failed, permanently breaking the session.
    const user = await deps.findUserById(tokenRecord.userId);
    if (!user || !user.isActive) {
      await deps.deleteRefreshToken(tokenRecord.id);
      return clearAndDeny("User not found or inactive");
    }
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

    // Write phase: delete the consumed token, then persist the new one.
    // Sequential rather than transactional -- the auth handler layer has
    // no transaction primitive today. If the second write fails, the
    // user lands in the "no valid refresh token" state on the next
    // attempt and falls back to login.
    await deps.deleteRefreshToken(tokenRecord.id);
    await deps.storeRefreshToken({
      id: generateRefreshTokenId(),
      userId: user.id,
      tokenHash: newTokenHash,
      userAgent: request.headers.get("user-agent"),
      ipAddress: getTrustedClientIp(request, {
        trustProxy: deps.trustProxy,
        trustedProxyIps: deps.trustedProxyIps,
      }),
      expiresAt: new Date(Date.now() + deps.refreshTokenTTL * 1000),
    });

    const cookies = [
      setAccessTokenCookie(
        accessToken,
        deps.refreshTokenTTL,
        deps.isProduction
      ),
      setRefreshTokenCookie(
        newRawToken,
        deps.refreshTokenTTL,
        deps.isProduction
      ),
    ];

    // Silent rotation per spec §7.6, no `message`. Body surfaces the
    // freshly-rotated tokens so non-cookie clients (mobile / SDK) can
    // replace their stored values; browser clients keep using the
    // HttpOnly cookies.
    return respondData(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          roleIds,
        },
        accessToken,
        refreshToken: newRawToken,
        // Authoritative server-side exp lives on the JWT itself.
        expiresAt: new Date(
          Date.now() + deps.accessTokenTTL * 1000
        ).toISOString(),
      },
      { status: 200, headers: buildCookieHeaders(cookies) }
    );
  } catch (err) {
    const requestId = readOrGenerateRequestId(request);
    const nextlyErr = NextlyError.is(err)
      ? err
      : NextlyError.serviceUnavailable({
          logMessage: "refresh: rotation failed",
          cause: err as Error,
        });
    getNextlyLogger().error({
      kind: "refresh-failed",
      ...nextlyErr.toLogJSON(requestId),
    });
    return buildAuthErrorResponse(nextlyErr, requestId);
  }
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
