import { respondAction } from "../../api/response-shapes";
import {
  isStrategyName,
  type AuditLogWriter,
} from "../../domains/audit/audit-log-writer";
import { auditReason } from "../../domains/audit/audit-reasons";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginContext } from "../../plugins/plugin-context";
import type { AuthUser } from "../../types/auth";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { setAccessTokenCookie } from "../cookies/access-token-cookie";
import { clearPendingCookie } from "../cookies/pending-cookie";
import { setRefreshTokenCookie } from "../cookies/refresh-token-cookie";
import { buildClaims } from "../jwt/claims";
import { signAccessTokenWithExpiry } from "../jwt/sign";
import type { AuthHookRegistry } from "../pipeline/hooks";
import {
  pendingPasswordVersion,
  type PendingClaims,
} from "../pipeline/pending-token";
import { sanitizeAdminPath } from "../redirect/sanitize-admin-path";
import {
  assertAccountUsable,
  type AccountGateOptions,
  type AccountState,
} from "../session/account-state";
import {
  generateRefreshToken,
  hashRefreshToken,
  generateRefreshTokenId,
} from "../session/refresh";

import { buildCookieHeaders, stallResponse } from "./handler-utils";
import { writeSessionRow, type WithSessionRowTransaction } from "./session-row";

/** A refresh token as stored: its hash, never the token itself. */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}

/** What storing a new refresh token needs. */
export interface RefreshTokenStoreDeps {
  storeRefreshToken: (record: RefreshTokenRecord) => Promise<void>;
  refreshTokenTTL: number;
  trustProxy: boolean;
  trustedProxyIps: string[];
}

/**
 * Mint a refresh token for a user and the row that stores its hash with the
 * request's client details. Returns the raw token for the cookie beside it.
 *
 * Shared by every path that records a client — a login, a resolved challenge,
 * a refresh, the first-run setup — so the row is built the same way, and the
 * client address read under the same proxy settings, on each. The development
 * auto-login records no client and writes its own row.
 */
export function newRefreshToken(
  deps: Omit<RefreshTokenStoreDeps, "storeRefreshToken">,
  userId: string,
  request: Request
): { rawToken: string; record: RefreshTokenRecord } {
  const rawToken = generateRefreshToken();
  return {
    rawToken,
    record: {
      id: generateRefreshTokenId(),
      userId,
      tokenHash: hashRefreshToken(rawToken),
      userAgent: request.headers.get("user-agent"),
      ipAddress: getTrustedClientIp(request, {
        trustProxy: deps.trustProxy,
        trustedProxyIps: deps.trustedProxyIps,
      }),
      expiresAt: new Date(Date.now() + deps.refreshTokenTTL * 1000),
    },
  };
}

/**
 * Store a new refresh token for a user and return the raw token for the
 * cookie: {@link newRefreshToken}, written as one plain insert.
 *
 * For the first-run setup, whose account is created by the same request. A
 * session for an account that existed before the request is written through
 * {@link writeSessionRow} instead, which judges the account again as it
 * writes.
 */
export async function storeNewRefreshToken(
  deps: RefreshTokenStoreDeps,
  userId: string,
  request: Request
): Promise<string> {
  const { rawToken, record } = newRefreshToken(deps, userId, request);
  await deps.storeRefreshToken(record);
  return rawToken;
}

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
  /** Whether an unverified email blocks sign-in (mirrors the password path). */
  requireEmailVerification: boolean;
  /**
   * Reads the account state the gate needs. Loaded here rather than trusted
   * from the caller, because the caller may be any strategy or a plugin.
   */
  fetchAccountState: (userId: string) => Promise<AccountState | null>;
  fetchRoleIds: (userId: string) => Promise<string[]>;
  fetchCustomFields: (userId: string) => Promise<Record<string, unknown>>;
  /**
   * Runs the session's refresh-row write in one transaction, under a lock on
   * the user row (see {@link writeSessionRow}).
   */
  withSessionRowTransaction: WithSessionRowTransaction;
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
export interface IssueSessionOptions {
  /**
   * The strategy that authenticated this login, recorded on the audit row.
   * Absent means the password path, which is the only one that predates this.
   */
  strategy?: string;
  /**
   * Where the client should land. Set when a login was interrupted by a
   * challenge and is now resuming, so the answer returns the destination the
   * login was originally headed for.
   */
  next?: string;
  /**
   * The password version the sign-in proved, when it proved one before this
   * call: the session is refused if the account's password was set again
   * before its refresh row is written. Absent, the version this call's own
   * gate reads is the one compared.
   */
  passwordUpdatedAt?: Date | null;
}

/** A minted session: the cookies to set, and the body a login response returns. */
export interface MintedSession {
  cookies: string[];
  body: {
    user: {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
      roleIds: string[];
    };
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
}

/**
 * Ask the shared account-state gate whether the account may hold a session,
 * and return the state it judged.
 *
 * Every step that acts for an account on its way to a session asks this one
 * function: the session mint, the login path before it sends a challenge or
 * runs a hook, and the forced password change before it changes the password.
 * Asking early keeps a refused account from receiving a challenge prompt, a
 * sent code, or a credential change it could never use. The password lockout
 * guards the password strategy only: a session finished by any other strategy
 * must not be blockable by someone typing wrong passwords at an address they
 * do not own.
 */
export async function gateAccountForSession(
  deps: Pick<
    IssueSessionDeps,
    "fetchAccountState" | "requireEmailVerification"
  >,
  userId: string,
  strategy: string | undefined
): Promise<AccountState> {
  const state = await deps.fetchAccountState(userId);
  if (!state) {
    throw NextlyError.invalidCredentials({
      logContext: { userId, reason: auditReason("user-not-found") },
    });
  }
  assertAccountUsable(state, sessionGateOptions(deps, strategy));
  return state;
}

/**
 * The gate options a sign-in's session is judged with, both when it starts
 * and again as its refresh row is written.
 */
function sessionGateOptions(
  deps: Pick<IssueSessionDeps, "requireEmailVerification">,
  strategy: string | undefined
): AccountGateOptions {
  return {
    requireEmailVerification: deps.requireEmailVerification,
    enforcePasswordLockout: strategy === undefined || strategy === "password",
  };
}

/**
 * Mint a session: run the account-state gate, build and sign the claims,
 * rotate in a refresh token, run the post-login hooks and record the success.
 *
 * Separated from the response so the JSON reply and the redirect a plugin
 * needs are two thin wrappers over ONE implementation, rather than two paths
 * that agree until one of them is edited.
 */
export async function mintSession(
  user: AuthUser,
  deps: IssueSessionDeps,
  request: Request,
  opts?: IssueSessionOptions
): Promise<MintedSession> {
  // Preconditions run first, before any token or refresh row exists. Every
  // strategy reaches a session through here, so this is the one place that can
  // refuse an account no matter which path authenticated it.
  const gated = await gateAccountForSession(deps, user.id, opts?.strategy);

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

  const { token: accessToken, expiresAt: accessTokenExpiresAt } =
    await signAccessTokenWithExpiry(claims, deps.secret, deps.accessTokenTTL);

  // Judged again as the row is written, under a lock on the user row: a
  // deactivation or a password set while the roles, the hooks and the
  // signing ran above would otherwise be outlived by the row written after
  // its revocation deleted the account's others. Before the post-login hooks
  // and the success record, so a refusal here leaves neither behind.
  const { rawToken: rawRefreshToken, record } = newRefreshToken(
    deps,
    user.id,
    request
  );
  await writeSessionRow(deps.withSessionRowTransaction, {
    record,
    gate: sessionGateOptions(deps, opts?.strategy),
    passwordUpdatedAt:
      opts?.passwordUpdatedAt !== undefined
        ? opts.passwordUpdatedAt
        : gated.passwordUpdatedAt,
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
    // Which method signed this person in. Success metadata is stored as given
    // rather than projected, so the shape is checked here instead.
    ...(isStrategyName(opts?.strategy)
      ? { metadata: { strategy: opts.strategy } }
      : {}),
  });

  const cookies = [
    setAccessTokenCookie(accessToken, deps.refreshTokenTTL, deps.isProduction),
    setRefreshTokenCookie(
      rawRefreshToken,
      deps.refreshTokenTTL,
      deps.isProduction
    ),
  ];

  return {
    cookies,
    body: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        image: user.image ?? null,
        roleIds,
      },
      accessToken,
      refreshToken: rawRefreshToken,
      // The token's own expiry, not a fresh reading: the hooks and the audit
      // write above are awaited, and a plugin hook is arbitrary code.
      expiresAt: accessTokenExpiresAt.toISOString(),
    },
  };
}

/**
 * Issue a session and answer the login request with it.
 *
 * The JSON half of {@link mintSession}: the canonical login body plus the
 * HttpOnly cookies (spec §7.6).
 */
export async function issueSession(
  user: AuthUser,
  deps: IssueSessionDeps,
  request: Request,
  requestId: string,
  opts?: IssueSessionOptions
): Promise<Response> {
  const minted = await mintSession(user, deps, request, opts);
  const body = opts?.next
    ? // Re-sanitized on the way out as well as before it was signed: this
      // value decides a navigation, and it costs nothing to check twice.
      { ...minted.body, next: sanitizeAdminPath(opts.next) }
    : minted.body;
  return respondAction("Logged in.", body, {
    status: 200,
    headers: buildCookieHeaders(minted.cookies, { "x-request-id": requestId }),
  });
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

/**
 * Finish a sign-in a pending step interrupted — a challenge answered, or a
 * forced password change completed.
 *
 * The session records the strategy the pending token carries, not the
 * handler's own: the method that signed the person in is the one that
 * authenticated them, not the one that answered the step. `next` is where the
 * sign-in was headed before it was interrupted, sanitized before it was
 * signed into the token. The pending cookie is cleared, because the step is
 * settled and a stale token must not be replayed, and the response takes the
 * sign-in's minimum time like every other outcome.
 */
export async function finishResumedSignIn(
  user: AuthUser,
  deps: IssueSessionDeps & { loginStallTimeMs: number },
  request: Request,
  requestId: string,
  pending: Pick<PendingClaims, "strategy" | "next" | "passwordUpdatedAt">,
  startTime: number
): Promise<Response> {
  const response = await issueSession(user, deps, request, requestId, {
    strategy: pending.strategy,
    next: pending.next,
    passwordUpdatedAt: pendingPasswordVersion(pending),
  });
  response.headers.append("Set-Cookie", clearPendingCookie());
  await stallResponse(startTime, deps.loginStallTimeMs);
  return response;
}
