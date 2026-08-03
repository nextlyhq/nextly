import { respondAction } from "../../api/response-shapes";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
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
  /**
   * Records the successful login. Required rather than optional: a session
   * issued without one is a login absent from the audit trail, and the point of
   * recording here is that no path can opt out by forgetting.
   */
  auditLog: AuditLogWriter;
}

/**
 * Issue a session for an authenticated user: fetch roles + custom fields, build
 * and (via `customizeClaims`) decorate the JWT claims, sign the access token,
 * rotate-in a fresh refresh token, and respond with the canonical login body +
 * HttpOnly cookies (spec §7.6). Extracted from the login handler so the
 * challenge-resolve path issues sessions identically.
 *
 * It also runs the post-login hooks and records the successful login, for that
 * same reason. Three handlers complete a login — password login, second-factor
 * resolution, and the forced first-sign-in password change — and each ran the
 * identical pair of steps after issuing the session. A user who always completes
 * a second factor never passes through the first, so recording at each call site
 * left that population out of the trail entirely; and the ORDER of those steps
 * decides whether the trail can contradict itself, which is not something three
 * copies should each be trusted to get right.
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

  // Last, after the post-login hooks. A hook that throws sends the caller into
  // its failure path, which returns an error and records a failure — the client
  // never receives the token body or the cookies. Recording the success before
  // that point left the trail asserting both outcomes for one attempt and
  // claiming the account was reached when nothing was delivered.
  //
  // Running the hooks here rather than in each caller is what makes that
  // ordering a property of the code instead of a convention: all three handlers
  // ran exactly this pair, and one of them getting the order wrong is invisible
  // until an audit is read.
  await deps.authHooks.runAfterLogin(user, deps.pluginCtx);
  // Attributed on purpose — naming the account is the account-state leak a
  // FAILURE must avoid, and is the whole value of a success.
  await deps.auditLog.write({
    kind: "login-succeeded",
    actorUserId: user.id,
    ipAddress: getTrustedClientIp(request, {
      trustProxy: deps.trustProxy,
      trustedProxyIps: deps.trustedProxyIps,
    }),
    userAgent: request.headers.get("user-agent"),
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
