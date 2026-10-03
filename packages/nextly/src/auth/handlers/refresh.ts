/**
 * POST /auth/refresh
 * Rotates the refresh token and issues a new access token.
 * Re-fetches roles from DB (guarantees fresh roles within 15 min).
 */
import { readOrGenerateRequestId } from "../../api/request-id";
import { respondData } from "../../api/response-shapes";
import { NextlyError } from "../../errors";
import { getNextlyLogger } from "../../observability/logger";
import type { PluginContext } from "../../plugins/plugin-context";
import type { AuthUser } from "../../types/auth";
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
import type { AuthHookRegistry } from "../pipeline/hooks";
import {
  accountMayHoldSession,
  type AccountGateOptions,
  type AccountState,
} from "../session/account-state";
import { hashRefreshToken } from "../session/refresh";
import { evaluateRefreshBinding } from "../session/refresh-binding";

import { buildCookieHeaders, buildAuthErrorResponse } from "./handler-utils";
import { newRefreshToken } from "./issue-session";
import { writeSessionRow, type WithSessionRowTransaction } from "./session-row";

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
  /**
   * Runs the rotation's write — the new row in, the presented row spent — in
   * one transaction under a lock on the user row (see `writeSessionRow`).
   */
  withSessionRowTransaction: WithSessionRowTransaction;
  findUserById: (userId: string) => Promise<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    isActive: boolean;
  } | null>;
  fetchRoleIds: (userId: string) => Promise<string[]>;
  fetchCustomFields: (userId: string) => Promise<Record<string, unknown>>;
  /** Reads the account state the shared session gate decides on. */
  fetchAccountState: (userId: string) => Promise<AccountState | null>;
  /** Whether an unverified email blocks a rotation (mirrors the password path). */
  requireEmailVerification: boolean;
  /** Gate XFF parsing on this. Default false. */
  trustProxy: boolean;
  /** CIDR list of proxy IPs (from TRUSTED_PROXY_IPS). */
  trustedProxyIps: string[];
  /**
   * Auth-flow hooks (D71). Optional so legacy test fixtures keep working; the DI
   * path always supplies it. When present, `customizeClaims` runs on refresh too
   * (so plugin claims survive token rotation).
   */
  authHooks?: AuthHookRegistry;
  /** Plugin context for {@link authHooks}; supplied alongside `authHooks`. */
  pluginCtx?: PluginContext;
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
    if (!user) {
      await deps.deleteRefreshToken(tokenRecord.id);
      return clearAndDeny("User not found");
    }
    // The same gate every session-issuing path uses, so an account deactivated
    // mid-session loses it at the next rotation instead of surviving for as
    // long as it keeps refreshing. Refused here rather than by the generic
    // catch below, which would answer 401 and leave both the refresh row and
    // the cookies alive.
    const gate = refreshGateOptions(deps);
    const accountState = await deps.fetchAccountState(user.id);
    if (!accountState || !accountMayHoldSession(accountState, gate)) {
      return refuseAccount(deps, tokenRecord.id);
    }
    const [roleIds, customFields] = await Promise.all([
      deps.fetchRoleIds(user.id),
      deps.fetchCustomFields(user.id),
    ]);

    const claims = await refreshedClaims(deps, user, roleIds, customFields);
    const accessToken = await signAccessToken(
      claims,
      deps.secret,
      deps.accessTokenTTL
    );

    const rotated = await rotateRefreshRow(deps, request, {
      presentedId: tokenRecord.id,
      userId: user.id,
      gate,
      passwordUpdatedAt: accountState.passwordUpdatedAt,
    });
    if (rotated instanceof Response) return rotated;
    const newRawToken = rotated.rawToken;

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

/**
 * The claims a rotated access token carries: the ones a login would mint,
 * with plugin claim customization (D71) re-applied so refreshed tokens keep
 * the same custom claims.
 */
async function refreshedClaims(
  deps: RefreshHandlerDeps,
  user: { id: string; email: string; name: string; image: string | null },
  roleIds: string[],
  customFields: Record<string, unknown>
): Promise<ReturnType<typeof buildClaims>> {
  const claims = buildClaims({
    userId: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    roleIds,
    customFields,
  });
  if (!deps.authHooks || !deps.pluginCtx) return claims;
  return deps.authHooks.runCustomizeClaims(
    claims,
    {
      id: user.id as AuthUser["id"],
      email: user.email,
      name: user.name,
      image: user.image,
    },
    deps.pluginCtx
  );
}

/**
 * Put the new refresh row in and spend the presented one, in one transaction
 * that first judges the account again under a lock on its user row.
 *
 * A deactivation or a password set while the request read and signed is seen
 * there and refuses the rotation, as the first gate would have; one that
 * commits after waits for this transaction and then deletes the new row with
 * the account's others. Returns the new raw token, or the refusal to answer
 * with.
 */
async function rotateRefreshRow(
  deps: RefreshHandlerDeps,
  request: Request,
  args: {
    presentedId: string;
    userId: string;
    gate: AccountGateOptions;
    passwordUpdatedAt: Date | null;
  }
): Promise<{ rawToken: string } | Response> {
  const { rawToken, record } = newRefreshToken(deps, args.userId, request);
  let written;
  try {
    written = await writeSessionRow(deps.withSessionRowTransaction, {
      record,
      gate: args.gate,
      passwordUpdatedAt: args.passwordUpdatedAt,
      consumeId: args.presentedId,
    });
  } catch (error) {
    if (!NextlyError.isCode(error, "AUTH_INVALID_CREDENTIALS")) throw error;
    return refuseAccount(deps, args.presentedId);
  }
  return written === "consumed-elsewhere" ? supersededDeny() : { rawToken };
}

/**
 * The gate options a refresh is judged with, when it starts and again as its
 * row is written.
 */
function refreshGateOptions(deps: RefreshHandlerDeps): AccountGateOptions {
  return {
    requireEmailVerification: deps.requireEmailVerification,
    // A refresh is not a password attempt. A lockout triggered by someone
    // else guessing passwords must not end a session already established.
    enforcePasswordLockout: false,
  };
}

/**
 * End the refreshing session of an account that may no longer hold one: its
 * presented row deleted and its cookies cleared.
 */
async function refuseAccount(
  deps: RefreshHandlerDeps,
  presentedId: string
): Promise<Response> {
  await deps.deleteRefreshToken(presentedId);
  return clearAndDeny("Account may no longer hold a session");
}

/**
 * The answer to a rotation that lost its presented row to another rotation.
 *
 * The other request — a second tab refreshing at the same moment — has just
 * set fresh cookies on this browser, so clearing them here would sign the
 * winner out too. The cookies are left alone and the code says why, so a
 * client can retry with the cookies it now holds. A token that is replayed
 * after its rotation is not this case: its row is gone before the lookup,
 * which answers with the cookie-clearing refusal.
 */
function supersededDeny(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "REFRESH_SUPERSEDED",
        message: "Refresh token already rotated",
      },
    }),
    { status: 401, headers: { "Content-Type": "application/json" } }
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
