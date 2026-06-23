import { respondAction } from "../../api/response-shapes";
import type { PluginContext } from "../../plugins/plugin-context";
import type { AuthUser } from "../../types/auth";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { setAccessTokenCookie } from "../cookies/access-token-cookie";
import { setRefreshTokenCookie } from "../cookies/refresh-token-cookie";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";
import type { AuthHookRegistry } from "../pipeline/hooks";
import {
  generateRefreshToken,
  hashRefreshToken,
  generateRefreshTokenId,
} from "../session/refresh";

import { buildCookieHeaders } from "./handler-utils";

/**
 * The slice of login/challenge deps needed to mint a session. Shared by the
 * login handler and the challenge-resolve handler so both issue sessions
 * identically (D71).
 */
export interface IssueSessionDeps {
  secret: string;
  isProduction: boolean;
  accessTokenTTL: number;
  refreshTokenTTL: number;
  trustProxy: boolean;
  trustedProxyIps: string[];
  fetchRoleIds: (userId: string) => Promise<string[]>;
  fetchCustomFields: (userId: string) => Promise<Record<string, unknown>>;
  storeRefreshToken: (record: {
    id: string;
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }) => Promise<void>;
  /** Auth-flow hooks; `customizeClaims` runs over the claims before signing. */
  authHooks: AuthHookRegistry;
  /** The plugin context handed to auth hooks. */
  pluginCtx: PluginContext;
}

/**
 * Issue a session for an authenticated user: fetch roles + custom fields, build
 * and (via `customizeClaims`) decorate the JWT claims, sign the access token,
 * rotate-in a fresh refresh token, and respond with the canonical login body +
 * HttpOnly cookies (spec §7.6). Extracted from the login handler so the
 * challenge-resolve path issues sessions identically.
 */
export async function issueSession(
  user: AuthUser,
  deps: IssueSessionDeps,
  request: Request,
  requestId: string
): Promise<Response> {
  const [roleIds, customFields] = await Promise.all([
    deps.fetchRoleIds(user.id),
    deps.fetchCustomFields(user.id),
  ]);

  let claims = buildClaims({
    userId: user.id,
    email: user.email,
    name: user.name ?? "",
    image: user.image ?? null,
    roleIds,
    customFields,
  });
  // customizeClaims (D71) — add/rename claims. No-op when no hooks registered.
  claims = await deps.authHooks.runCustomizeClaims(
    claims,
    user,
    deps.pluginCtx
  );

  const accessToken = await signAccessToken(
    claims,
    deps.secret,
    deps.accessTokenTTL
  );

  const rawRefreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  await deps.storeRefreshToken({
    id: generateRefreshTokenId(),
    userId: user.id,
    tokenHash: refreshTokenHash,
    userAgent: request.headers.get("user-agent"),
    ipAddress: getTrustedClientIp(request, {
      trustProxy: deps.trustProxy,
      trustedProxyIps: deps.trustedProxyIps,
    }),
    expiresAt: new Date(Date.now() + deps.refreshTokenTTL * 1000),
  });

  const cookies = [
    setAccessTokenCookie(accessToken, deps.refreshTokenTTL, deps.isProduction),
    setRefreshTokenCookie(
      rawRefreshToken,
      deps.refreshTokenTTL,
      deps.isProduction
    ),
  ];

  return respondAction(
    "Logged in.",
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        image: user.image ?? null,
        roleIds,
      },
      accessToken,
      refreshToken: rawRefreshToken,
      expiresAt: new Date(
        Date.now() + deps.accessTokenTTL * 1000
      ).toISOString(),
    },
    {
      status: 200,
      headers: buildCookieHeaders(cookies, { "x-request-id": requestId }),
    }
  );
}

/**
 * Mint a challenge response (multi-step auth, D71): a short-lived single-purpose
 * pending-auth token plus the challenge type/hint the client renders. No session
 * is issued until the challenge is resolved.
 */
export function challengeResponse(
  challenge: { id: string; userId: string; uiHint?: Record<string, unknown> },
  pendingToken: string,
  requestId: string
): Response {
  return new Response(
    JSON.stringify({
      status: "challenge",
      challengeType: challenge.id,
      pendingToken,
      uiHint: challenge.uiHint ?? null,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
    }
  );
}
