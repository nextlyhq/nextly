/**
 * GET /auth/session
 * Returns the current session user from the access token.
 * No database hit; purely stateless JWT verification.
 *
 * In dev (NODE_ENV !== "production"), this handler also implements
 * `admin.devAutoLogin`: when the user has no valid session and the host
 * config has `admin.devAutoLogin: { email }`, we look up that user and
 * issue a real session cookie inline. Same JWT-signing codepath the
 * regular login flow uses (no shortcut for the crypto). Hard-blocked in
 * production with a console warning so a misconfigured deploy can't
 * silently auto-login users. See `attemptDevAutoLogin` below.
 */
import { respondData } from "../../api/response-shapes";
import {
  clearAccessTokenCookie,
  readAccessTokenCookie,
  setAccessTokenCookie,
} from "../cookies/access-token-cookie";
import { setRefreshTokenCookie } from "../cookies/refresh-token-cookie";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";
import { getSession } from "../session/get-session";
import {
  generateRefreshToken,
  generateRefreshTokenId,
  hashRefreshToken,
} from "../session/refresh";

import { jsonResponse, buildCookieHeaders } from "./handler-utils";
import type { AuthRouterDeps } from "./router";

// Track which dev-auto-login emails have already triggered the warning
// log this process. The handler runs on every /admin/api/auth/session
// request; without dedup the console fills up.
const devAutoLoginWarned = new Set<string>();

export type SessionHandlerDeps = Pick<
  AuthRouterDeps,
  | "secret"
  | "isProduction"
  | "accessTokenTTL"
  | "refreshTokenTTL"
  | "devAutoLogin"
  | "findUserByEmail"
  | "fetchRoleIds"
  | "fetchCustomFields"
  | "storeRefreshToken"
> & {
  // ipAddress is best-effort here — used as the audit signal on the
  // refresh-token row. Trust-proxy aware lookup happens upstream in
  // login; for dev-auto-login we accept whatever the framework's
  // existing extraction returns, since this codepath never runs in
  // production anyway.
  trustProxy?: boolean;
  trustedProxyIps?: string[];
};

// Reasons we treat the request as not-authenticated. The first three
// come from `getSession` (purely JWT shape and signature). `user_gone`
// is the dev-only stale-cookie case: the JWT verifies fine, but the
// user it points to has been deleted (e.g. `pnpm dev:reset` wiped the
// DB and re-seeded with a different super-admin id). Treated like
// `invalid` for cookie cleanup so the stale token does not survive
// across the next devAutoLogin re-issue.
type FailureReason = "no_token" | "expired" | "invalid" | "user_gone";

export async function handleSession(
  request: Request,
  deps: SessionHandlerDeps
): Promise<Response> {
  const result = await getSession(request, deps.secret);

  let failureReason: FailureReason | null = null;
  if (!result.authenticated) {
    failureReason = result.reason;
  } else if (!deps.isProduction && deps.devAutoLogin) {
    // Dev-only safeguard against stale cookies. Without this check a
    // valid JWT signed against an old DB would resolve as
    // "authenticated", and every downstream permission lookup would
    // 403 against a phantom user (plus FK-checked writes - permission
    // cache, audit log - would crash with constraint failures).
    //
    // The seed always uses the same email (e.g. dev@nextly.local) but
    // a fresh user id on each `pnpm dev:reset`, so checking only that
    // the email exists isn't enough - we also compare ids. Any
    // mismatch means the JWT's user has been replaced.
    //
    // One findUserByEmail per session check is acceptable in dev; the
    // production path keeps the existing zero-DB-hit fast case.
    const live = await deps.findUserByEmail(result.user.email);
    if (!live || live.id !== result.user.id) failureReason = "user_gone";
  }

  if (failureReason === null && result.authenticated) {
    // Bare `{ user, accessToken }` per spec §7.6. The access token
    // already verified successfully (it's how we got here), so reading it
    // back from the cookie is safe. We surface it in the body so
    // non-cookie SDK consumers (mobile, CLI) can pull the live token
    // without owning cookie storage.
    const accessToken = readAccessTokenCookie(request);
    return respondData({ user: result.user, accessToken });
  }

  // Try dev-auto-login before the 401 path. Only fires when:
  //   - NODE_ENV !== "production" (hard runtime gate)
  //   - admin.devAutoLogin is configured with an email
  //   - the named user actually exists (we don't create users here)
  // Also reached when the JWT is valid but its user no longer exists
  // in the DB (the stale-cookie-after-reset case above).
  if (!deps.isProduction && deps.devAutoLogin) {
    const autoLoginResponse = await attemptDevAutoLogin(deps);
    if (autoLoginResponse) return autoLoginResponse;
  } else if (deps.isProduction && deps.devAutoLogin) {
    // Production guardrail: the config field shouldn't be set in prod,
    // and even if it is we ignore it. Warn loudly once per config load.
    const key = (deps.devAutoLogin as { email: string }).email;
    if (!devAutoLoginWarned.has(`prod:${key}`)) {
      devAutoLoginWarned.add(`prod:${key}`);
      console.warn(
        `[nextly] devAutoLogin ignored: NODE_ENV=production. ` +
          `Set this only for development. (configured email: ${key})`
      );
    }
  }

  // Only clear the access cookie when the JWT is tampered/malformed
  // ("invalid"), or when its user has been deleted from the dev DB
  // ("user_gone") - in either case the cookie is junk and should not
  // round-trip again. For an expired JWT we want the cookie to stay so
  // the client can still receive TOKEN_EXPIRED on parallel in-flight
  // requests and participate in the single coalesced refresh; clearing
  // here forces sibling requests into the no_token to AUTH_REQUIRED
  // branch, which bypasses refresh.
  const clearCookies: string[] = [];
  if (failureReason === "invalid" || failureReason === "user_gone") {
    clearCookies.push(clearAccessTokenCookie());
  }

  const code = failureReason === "expired" ? "TOKEN_EXPIRED" : "AUTH_REQUIRED";
  const message =
    code === "TOKEN_EXPIRED" ? "Session expired" : "Not authenticated";

  if (clearCookies.length > 0) {
    return new Response(JSON.stringify({ error: { code, message } }), {
      status: 401,
      headers: buildCookieHeaders(clearCookies),
    });
  }

  return jsonResponse(401, { error: { code, message } });
}

/**
 * Issue a real session for the configured devAutoLogin user. Mirrors the
 * happy-path of handleLogin (jwt/sign + refresh-token/store + cookie/set)
 * but deliberately skips password verification, lockout tracking,
 * email-verification gating, and audit logging because:
 *   - the contributor configured this in their own nextly.config.ts
 *   - the path is hard-blocked in production by handleSession's caller
 *   - bypassing `lockedUntil` and `emailVerified` is intentional: a dev
 *     environment shouldn't lock the contributor out of their own admin
 *     for typing the wrong password, and we don't want to require email
 *     verification flows just to log into the playground
 *
 * The only check that DOES fire is `isActive`; a deactivated user
 * shouldn't be auto-logged-in even in dev.
 *
 * Returns null when the user can't be found or the config shape is bad,
 * letting handleSession fall through to the normal 401.
 */
async function attemptDevAutoLogin(
  deps: SessionHandlerDeps
): Promise<Response | null> {
  if (!deps.devAutoLogin) return null;
  const { email } = deps.devAutoLogin;
  if (!email) return null;

  const user = await deps.findUserByEmail(email);
  if (!user || !user.isActive) {
    if (!devAutoLoginWarned.has(`miss:${email}`)) {
      devAutoLoginWarned.add(`miss:${email}`);
      console.warn(
        `[nextly] devAutoLogin: user "${email}" not found. ` +
          `Auto-login skipped. Either register the user or update ` +
          `admin.devAutoLogin.email in your nextly.config.ts.`
      );
    }
    return null;
  }

  // Per-process startup notice. Loud enough to spot in logs but
  // dedup'd so it doesn't spam every session check.
  if (!devAutoLoginWarned.has(`active:${email}`)) {
    devAutoLoginWarned.add(`active:${email}`);
    console.warn(
      `[nextly] devAutoLogin enabled for ${email}. ` +
        `DO NOT use this in production deployments.`
    );
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
  const rawRefreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  await deps.storeRefreshToken({
    id: generateRefreshTokenId(),
    userId: user.id,
    tokenHash: refreshTokenHash,
    userAgent: null,
    ipAddress: null,
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

  // Match the `respondData({ user, accessToken })` shape that the
  // authenticated `handleSession` branch returns above so SDK clients
  // (mobile, CLI, custom admin) parsing /auth/session see one shape
  // regardless of whether dev-auto-login fired.
  return new Response(
    JSON.stringify({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
      accessToken,
    }),
    {
      status: 200,
      headers: buildCookieHeaders(cookies),
    }
  );
}
