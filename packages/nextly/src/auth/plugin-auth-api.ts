/**
 * The one safe way for a plugin to finish a login it authenticated elsewhere.
 *
 * Without it, a plugin holding a verified external identity has to assemble a
 * session itself: mint the token, set the cookies, remember the audit row, and
 * remember every account-state rule the password path applies. Each plugin
 * would reimplement that, and the ones that got it wrong would be the ones
 * granting sessions to accounts core would have refused.
 *
 * @module auth/plugin-auth-api
 * @since 1.0.0
 */
import {
  auditFailureMetadata,
  isStrategyName,
  type AuditLogWriter,
} from "../domains/audit/audit-log-writer";
import { auditReason } from "../domains/audit/audit-reasons";
import { NextlyError } from "../errors/nextly-error";
import { env } from "../lib/env";
import type { PluginContext } from "../plugins/plugin-context";
import type { AuthUser } from "../types/auth";
import { getTrustedClientIp } from "../utils/get-trusted-client-ip";

import { setPendingCookie } from "./cookies/pending-cookie";
import { readCsrfCookie, readCsrfFromRequest } from "./csrf/csrf-cookie";
import { validateCsrf } from "./csrf/validate";
import { mintSession, type IssueSessionDeps } from "./handlers/issue-session";
import type { AuthHookRegistry } from "./pipeline/hooks";
import {
  MUST_CHANGE_PASSWORD_CHALLENGE,
  mintPendingToken,
  newChallengeFlowId,
} from "./pipeline/pending-token";
import { sanitizeAdminPath } from "./redirect/sanitize-admin-path";
import { assertAccountUsable } from "./session/account-state";
import { getSession } from "./session/get-session";

export interface CompleteLoginOptions {
  /** The incoming request (for IP/UA in the audit row and the cookie Secure flag). */
  request: Request;
  /** Strategy name recorded on the audit rows, e.g. "oauth-google". */
  strategy: string;
  /** Admin path to land on. Sanitized here; anything unsafe becomes "/admin". */
  next?: string;
  /** Extra Set-Cookie values the caller needs on the final response. */
  appendCookies?: string[];
}

export interface PluginAuthApi {
  /**
   * Finish a login a plugin authenticated elsewhere (for example an OAuth
   * callback).
   *
   * Order, the same as the password path's, preconditions first:
   *   1. load the user by id (callers cannot fabricate profile fields);
   *   2. the beforeLogin hooks (maintenance mode and IP allowlists apply to
   *      an external login too);
   *   3. the account-state gate (inactive and unverified refused; the password
   *      lockout does not apply);
   *   4. the afterAuthenticate hooks (second factor);
   *   5. mint the session.
   *
   * Its responses:
   *  - a usable account with no challenge: 302 to `next`, with session cookies;
   *  - a challenge or a forced password change: 302 to `/admin/login?resume=1`
   *    with an HttpOnly pending cookie, so no token ever appears in a URL;
   *  - any refusal: 302 to `/admin/login?error=signin-failed`, with an
   *    actor-less `login-failed` row carrying the strategy and the reason.
   *
   * It always returns a Response and never throws for a login outcome, so
   * every plugin fails the same safe way.
   */
  completeLogin(userId: string, opts: CompleteLoginOptions): Promise<Response>;
  /**
   * The session user for this request, or null. Resolved through `getSession`,
   * so the typed-token rules apply and no plugin parses the cookie itself.
   */
  currentUser(request: Request): Promise<{ id: string; email: string } | null>;
  /**
   * Check the double-submit CSRF token on a request.
   *
   * For a handler that needs the check CONDITIONALLY — a route serving both a
   * browser form and an API key, say — where the route-level `csrf` option
   * would apply it to both. Uses the same validation as core's own routes, so
   * a plugin never writes a second implementation of it.
   */
  verifyCsrf(
    request: Request
  ): Promise<{ valid: true } | { valid: false; reason: string }>;
}

/** Everything `completeLogin` needs, resolved lazily so services can initialise first. */
export interface CompleteLoginDeps extends IssueSessionDeps {
  findUserById: (userId: string) => Promise<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    isActive: boolean;
    mustChangePassword?: boolean | null;
  } | null>;
  authHooks: AuthHookRegistry;
  pluginCtx: PluginContext;
  auditLog: AuditLogWriter;
  challengeTokenTTL: number;
}

/** Where a refused external login is sent. Generic on purpose: it names nothing. */
const SIGNIN_FAILED_PATH = "/admin/login?error=signin-failed";
/** Where an interrupted login is sent, for the page to resume from the cookie. */
const RESUME_PATH = "/admin/login?resume=1";

/**
 * A plugin supplying a malformed strategy name is a programming error rather
 * than a login outcome, so it throws where the plugin author will see it
 * instead of redirecting an end user to a generic failure.
 */
function assertStrategyName(strategy: string): void {
  if (!isStrategyName(strategy)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "strategy",
          code: "INVALID",
          message:
            "A strategy name must be up to 64 lowercase letters, digits, ':', '_' or '-'.",
        },
      ],
    });
  }
}

/** A 302 that carries cookies and is never cached. */
function redirectWithCookies(location: string, cookies: string[]): Response {
  const headers = new Headers({
    Location: location,
    // A redirect that hands out session cookies must not be stored by anything
    // between the server and the browser.
    "Cache-Control": "no-store",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/**
 * Load the account and establish that it may hold a session.
 *
 * The `beforeLogin` hooks run between the two, because a deployment-wide
 * refusal (maintenance, an IP allowlist) applies to an external login as much
 * as to a password one. The account-state gate then runs BEFORE any hook that
 * might act — sending a code, notifying someone — so an account that may not
 * hold a session never triggers one.
 */
async function loadUsableUser(
  deps: CompleteLoginDeps,
  userId: string,
  opts: CompleteLoginOptions
): Promise<{
  id: string;
  email: string;
  name: string;
  image: string | null;
  mustChangePassword?: boolean | null;
}> {
  // Returns the error rather than throwing it, so the throw stays at the site
  // where the check is and the compiler can narrow past it.
  const refusal = (): NextlyError =>
    NextlyError.invalidCredentials({
      logContext: {
        userId,
        reason: auditReason("user-not-found"),
        strategy: opts.strategy,
      },
    });

  const user = await deps.findUserById(userId);
  if (!user) throw refusal();

  await deps.authHooks.runBeforeLogin(
    { request: opts.request, body: {}, strategyName: opts.strategy },
    deps.pluginCtx
  );

  const state = await deps.fetchAccountState(user.id);
  if (!state) throw refusal();
  assertAccountUsable(state, {
    requireEmailVerification: deps.requireEmailVerification,
    // An external login is not a password attempt, so wrong passwords typed
    // at this address must not block it.
    enforcePasswordLockout: false,
  });

  return user;
}

/**
 * The refusals a login may legitimately end in, as opposed to failures.
 *
 * Every one of these is a decision ABOUT the caller, so each is answered the
 * same audited way. Anything outside this set means the attempt could not be
 * judged at all.
 */
const EXPECTED_LOGIN_REFUSALS = [
  "AUTH_INVALID_CREDENTIALS",
  "FORBIDDEN",
  "RATE_LIMITED",
  "AUTH_REQUIRED",
] as const;

function isExpectedLoginRefusal(err: unknown): boolean {
  return EXPECTED_LOGIN_REFUSALS.some(code => NextlyError.isCode(err, code));
}

export function createPluginAuthApi(
  getDeps: () => CompleteLoginDeps
): PluginAuthApi {
  async function redirectToResume(
    deps: CompleteLoginDeps,
    pending: {
      userId: string;
      challengeId: string;
      strategy: string;
      next: string;
    },
    extra: string[]
  ): Promise<Response> {
    const token = await mintPendingToken(
      {
        userId: pending.userId,
        challengeId: pending.challengeId,
        attempts: 0,
        strategy: pending.strategy,
        next: pending.next,
        // A fresh flow: each provider login this redirect pauses gets its own
        // attempt budget, separate from the password login it may share an
        // account and a challenge with. The flow's expiry is FIXED here and
        // carried unchanged by every re-issue, so a renewed token cannot
        // extend the lifetime the budget is bounded by.
        flow: newChallengeFlowId(),
        flowExpiresAt: Math.floor(Date.now() / 1000) + deps.challengeTokenTTL,
      },
      deps.secret,
      deps.challengeTokenTTL
    );
    return redirectWithCookies(RESUME_PATH, [
      setPendingCookie(token, deps.challengeTokenTTL, deps.isProduction),
      ...extra,
    ]);
  }

  return {
    async completeLogin(userId, opts) {
      assertStrategyName(opts.strategy);
      const deps = getDeps();
      const next = sanitizeAdminPath(opts.next);
      const extra = opts.appendCookies ?? [];

      try {
        const user = await loadUsableUser(deps, userId, opts);

        const after = await deps.authHooks.runAfterAuthenticate(
          {
            id: user.id as AuthUser["id"],
            email: user.email,
            name: user.name,
            image: user.image,
          },
          deps.pluginCtx
        );

        if (after && typeof after === "object" && "challenge" in after) {
          return await redirectToResume(
            deps,
            {
              userId: String(after.challenge.userId),
              challengeId: after.challenge.id,
              strategy: opts.strategy,
              next,
            },
            extra
          );
        }

        if (user.mustChangePassword) {
          return await redirectToResume(
            deps,
            {
              userId: user.id,
              challengeId: MUST_CHANGE_PASSWORD_CHALLENGE,
              strategy: opts.strategy,
              next,
            },
            extra
          );
        }

        const minted = await mintSession(after, deps, opts.request, {
          strategy: opts.strategy,
        });
        return redirectWithCookies(next, [...minted.cookies, ...extra]);
      } catch (err) {
        // An EXPECTED refusal is answered; anything else is a failure of the
        // system rather than a verdict about the caller, and must keep
        // travelling. `beforeLogin` hooks may abort with any typed policy
        // error, and only invalid-credentials was handled — so a hook denying
        // by policy or rate limit broke the documented always-return-a-redirect
        // contract, skipped the `login-failed` row, and surfaced the exception
        // in whichever plugin route had called in.
        //
        // A NAMED set rather than "any NextlyError": an INTERNAL_ERROR or a
        // DATABASE_ERROR reaching here means the login could not be decided,
        // and answering "sign-in failed" would present an outage as a verdict
        // about the person's credentials.
        if (!isExpectedLoginRefusal(err)) throw err;
        // Actor-less, like the login handler: naming the account on a failure
        // is the enumeration leak the generic response exists to avoid.
        await deps.auditLog.write({
          kind: "login-failed",
          // The strategy is attached here rather than relied on from the
          // error: the account-state gate raises its own error and knows
          // nothing about the caller, so every refusal would otherwise name
          // the method only when it happened to come from this module. It is
          // safe to state directly, having been validated on the way in.
          metadata: {
            ...auditFailureMetadata(err),
            strategy: opts.strategy,
          },
          ipAddress: getTrustedClientIp(opts.request, {
            trustProxy: deps.trustProxy,
            trustedProxyIps: deps.trustedProxyIps,
          }),
          userAgent: opts.request.headers.get("user-agent"),
        });
        return redirectWithCookies(SIGNIN_FAILED_PATH, extra);
      }
    },

    async verifyCsrf(request) {
      // The BODY is read from a clone, because the caller still needs the
      // original to read its own fields, and the token can arrive either
      // way: core admin requests carry csrfToken in the JSON body, and a
      // plugin form posting the same shape was refused here for lacking the
      // header it never needed on core routes.
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = await request.clone().json();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        // A body that is not JSON carries no token; the header is still
        // checked.
      }
      const result = validateCsrf(
        request,
        readCsrfCookie(request),
        readCsrfFromRequest(body, request),
        env.NEXTLY_ALLOWED_ORIGINS_PARSED ?? []
      );
      return result.valid
        ? { valid: true }
        : { valid: false, reason: result.error ?? "csrf-failed" };
    },

    async currentUser(request) {
      const deps = getDeps();
      const result = await getSession(request, deps.secret);
      return result.authenticated
        ? { id: String(result.user.id), email: String(result.user.email) }
        : null;
    },
  };
}
