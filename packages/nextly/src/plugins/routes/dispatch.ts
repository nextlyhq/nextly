import { buildErrorResponse } from "../../api/error-response";
import { readOrGenerateRequestId } from "../../api/request-id";
import { applySessionCacheHeaders } from "../../api/response-shapes";
import {
  apiKeyScopeFrom,
  type AuthenticatedScope,
} from "../../auth/authenticated-scope";
import { runWithCallerScope } from "../../auth/caller-scope";
import { withoutRefreshCookie } from "../../auth/cookies/refresh-token-cookie";
import { readCsrfBody } from "../../auth/csrf/read-csrf-body";
import { carriesBearerToken } from "../../auth/csrf/validate";
import {
  isErrorResponse,
  requireAuthentication,
  requirePermission,
} from "../../auth/middleware";
import { toNextlyAuthError } from "../../auth/middleware/to-nextly-error";
import { beginSessionConsultation } from "../../auth/plugin-auth-api";
import { getSession } from "../../auth/session/get-session";
import { NextlyError } from "../../errors/nextly-error";
import { runWithRequestScope } from "../../hooks/request-scope";
import { currentFlattenedErrors } from "../../hooks/side-effect-warnings";
import {
  isReadOperation,
  RATE_LIMIT_DEFAULTS,
  type RateLimitStore,
} from "../../middleware/rate-limit";
import {
  currentRestLimitGate,
  type RestLimitGate,
  type RestLimitTarget,
} from "../../middleware/rest-limit-gate";
import { getNextlyLogger } from "../../observability/logger";
import { SKIP_TIMEZONE_FORMAT_HEADER } from "../../shared/lib/date-formatting";
import type { AuthUser } from "../../types/auth";
import {
  recognisePrincipal,
  runWithPrincipalAnswers,
} from "../principals/recognise";
import type { Principal, PluginRoutePrincipal } from "../principals/types";
import type { PluginSelf } from "../self";

import { composeMiddleware } from "./middleware";
import { parsePermissionSlug } from "./permission-slug";
import { buildPluginRouteCaller } from "./route-caller";
import {
  checkRouteCsrf,
  publicCallerCredential,
  rateLimitKey,
  routeCsrfMode,
  shouldNotStore,
  type CallerCredential,
} from "./route-options";
import { resolveRoutePermission } from "./route-permission";
import type { RouteMatch } from "./route-registry";
import type {
  PluginRoute,
  PluginRouteCaller,
  PluginRouteContext,
} from "./route-types";

/**
 * Map a failure on a plugin route to the error Response a caller receives.
 *
 * Through the shared builder, so a plugin route answers with what every other
 * route answers with. Hand-building the body here agreed on the status and the
 * content type and differed on everything the builder had gained since, so a
 * plugin route was the one surface with no development diagnostics.
 *
 * A non-NextlyError becomes a generic 500 with the thrown error chained, never
 * a crash: a handler failure must not take the server down (D28-adjacent
 * robustness), and discarding it left the one failure with no typed detail as
 * the one failure with no detail at all.
 */
function toErrorResponse(req: Request, err: unknown): Response {
  const nextlyErr = NextlyError.is(err)
    ? err
    : NextlyError.internal({
        ...(err instanceof Error ? { cause: err } : {}),
        logContext: { kind: "plugin-route-handler-error" },
      });
  return buildErrorResponse(nextlyErr, {
    requestId: readOrGenerateRequestId(req),
    // Read here because this frame is inside the request's warning scope --
    // the dynamic router opens it around the dispatch that reaches this.
    flattened: currentFlattenedErrors(),
  });
}

/** Who a route's caller turned out to be, and how they proved it. */
interface RouteAuth {
  user: AuthUser | null;
  authenticatedScope?: AuthenticatedScope;
  caller: PluginRouteCaller | null;
  /** The plugin's kind of signed-in person, on a route that asks for one. */
  principal: Principal | null;
  /** How the caller actually authenticated, for the CSRF decision. */
  credential: CallerCredential;
}

/**
 * Resolve secure-by-default auth for a route. `public: true` skips auth
 * (`user` is `null`). A route asking for a `principal` recognises that kind of
 * person and reads no staff credential. Otherwise the request must be
 * authenticated; if the route declares `requiredPermission`, that permission
 * is enforced too. Returns either the caller or the failure (401/403) for the
 * caller to serialize.
 *
 * The failure rather than a finished Response, so the one boundary that builds
 * a plugin route's error body builds all of them. Returning a ready response
 * here is how a rejected request came back in the legacy `{ data }` shape while
 * a failing handler on the same route came back in the canonical `{ error }`
 * one.
 */
async function resolvePluginRouteAuth(
  req: Request,
  route: PluginRoute,
  self: PluginSelf
): Promise<RouteAuth | { error: NextlyError }> {
  // First, and instead of every staff path below: a route asking for a kind
  // never reads the staff session or an API key, so its handler cannot be
  // handed staff on a request a person made from a browser holding both.
  if (route.principal !== undefined) {
    return principalRouteAuth(req, route.principal, self);
  }
  if (route.public === true) {
    return {
      user: null,
      caller: null,
      principal: null,
      // No credential resolved anyone on a public route, and a handler may
      // still resolve the session cookie through ctx.auth.currentUser — so
      // whether that cookie authenticates is what decides, not the presence
      // of it or of any other cookie.
      credential: publicCallerCredential(req, await sessionAuthenticates(req)),
    };
  }

  const required = requiredPermissionOrRefusal(route, self);
  if ("error" in required) return required;

  // requirePermission already enforces authentication, so the permission-gated
  // path needs a single call (avoids verifying the session twice).
  const authResult = required.permission
    ? await requirePermission(req, ...permissionArgs(required.permission))
    : await requireAuthentication(req);

  if (isErrorResponse(authResult)) {
    return { error: toNextlyAuthError(authResult) };
  }
  return authenticatedCaller(authResult);
}

/**
 * Whether the request's session cookie authenticates anyone.
 *
 * Through `getSession` with the secret `requireAuthentication` and
 * `ctx.auth.currentUser` verify it with, so a public route's caller counts as
 * signed in exactly when its handler would see a user. An expired or malformed
 * cookie authenticates nobody, and its caller is anonymous.
 */
async function sessionAuthenticates(req: Request): Promise<boolean> {
  const { env } = await import("../../lib/env");
  return (await getSession(req, env.NEXTLY_SECRET || "")).authenticated;
}

/**
 * Auth for a route that asks for a plugin's kind of signed-in person.
 *
 * A route that requires the kind refuses a request with nobody of it exactly
 * as a secure route refuses an unauthenticated one, so the answer says
 * nothing a staff route's would not.
 *
 * The credential is a cookie's unless the request carries a `Bearer` token.
 * A plugin's session is whatever the plugin made it, so core cannot tell its
 * cookie from its header; treating the person as a cookie caller holds their
 * writes to the route's cross-site check, and a `Bearer` token exempts by its
 * presence, as it does for every caller, whether or not anyone was
 * recognised. Nobody recognised and no `Bearer` token is an anonymous caller,
 * held to the origin check where the route sets `csrf: true`, as any
 * anonymous write to such a route is.
 */
async function principalRouteAuth(
  req: Request,
  asked: PluginRoutePrincipal,
  self: PluginSelf
): Promise<RouteAuth | { error: NextlyError }> {
  let principal: Principal | null;
  try {
    principal = await recognisePrincipal(req, asked.kind);
  } catch (cause) {
    // Only a kind missing from the registry throws here, which collection
    // refuses at boot. Answered as a server fault rather than let through:
    // the catch-all above this maps no thrown error to a response.
    return {
      error: NextlyError.internal({
        ...(cause instanceof Error ? { cause } : {}),
        logContext: {
          reason: "plugin-route-principal-unresolved",
          plugin: self.name,
          principalKind: asked.kind,
        },
      }),
    };
  }
  if (principal === null && asked.required !== false) {
    return {
      error: NextlyError.authRequired({
        logContext: {
          reason: "plugin-route-principal-required",
          plugin: self.name,
          principalKind: asked.kind,
        },
      }),
    };
  }
  return {
    user: null,
    caller: null,
    principal,
    // The Bearer token first: it exempts by its presence whether or not
    // anyone was recognised, so nobody recognised does not take it away.
    credential: carriesBearerToken(req)
      ? "bearer"
      : principal === null
        ? "none"
        : "cookie",
  };
}

/**
 * The successful half of route auth: who is asking, with what scope, and how
 * they actually authenticated.
 *
 * Split from the resolver so the mapping is one function with one job. The
 * `credential` answers the CSRF decision: a browser can attach an
 * `Authorization` header automatically (ambient HTTP authentication), and
 * classifying by header presence then skipped CSRF for a request whose
 * session cookie was the credential that let it in — the resolved method
 * cannot lie about which one admitted the request. The API-key scope beside
 * it carries the key's own grants rather than its owner's: a viewer-scoped
 * key minted by a super-admin is judged by the key, not the owner.
 */
function authenticatedCaller(
  authResult: Exclude<
    Awaited<ReturnType<typeof requireAuthentication>>,
    { statusCode: number }
  >
): RouteAuth & { user: AuthUser; caller: PluginRouteCaller } {
  const user: AuthUser = {
    id: authResult.userId as AuthUser["id"],
    email: authResult.userEmail ?? "",
    name: authResult.userName ?? null,
  };
  return {
    user,
    authenticatedScope:
      authResult.authMethod === "api-key"
        ? apiKeyScopeFrom(authResult)
        : undefined,
    // Built from the same `authResult` the scope above is derived from, so
    // the raw grant and the question asked of it cannot disagree about who
    // is asking.
    caller: buildPluginRouteCaller(authResult),
    principal: null,
    credential: authResult.authMethod === "session" ? "cookie" : "bearer",
  };
}

/**
 * The permission slug this route requires on this install, or the refusal a
 * gate that cannot be computed owes.
 *
 * A route gating on one of the plugin's own collections gives a function,
 * because the host may have renamed it and a fixed slug would name a grant
 * nobody was seeded. And a gate that cannot be computed REFUSES: falling
 * through to `requireAuthentication` would drop the permission check
 * entirely and admit any signed-in caller — a thrown resolver silently
 * OPENING the route it was written to close.
 */
function requiredPermissionOrRefusal(
  route: PluginRoute,
  self: PluginSelf
): { permission?: string } | { error: NextlyError } {
  try {
    return {
      permission: resolveRoutePermission(route.requiredPermission, self),
    };
  } catch (cause) {
    // A permission the route cannot work out is the plugin's fault, not the
    // caller's: answered 500, as any server fault is, and never let through.
    // A 403 told the caller their grant fell short when no grant could have
    // been enough. The resolver's own error, or the empty slug's, goes to the
    // log.
    return {
      error: new NextlyError({
        code: "INTERNAL_ERROR",
        publicMessage: "An unexpected error occurred.",
        logMessage: "a plugin route's requiredPermission could not be resolved",
        ...(cause instanceof Error ? { cause } : {}),
        logContext: {
          reason: "plugin-route-permission-unresolved",
          plugin: self.name,
          path: route.path,
        },
      }),
    };
  }
}

function permissionArgs(slug: string): [string, string] {
  const { action, resource } = parsePermissionSlug(slug);
  return [action, resource];
}

/**
 * What every plugin-route response says about itself, whoever wrote it.
 *
 * Both properties are decided HERE rather than by the plugin, because neither
 * header is on the surface a plugin may import: a plugin wanting either would
 * have to hardcode an internal string, which is the same defect one
 * indirection along. This is the one place every plugin response converges on.
 *
 * ## The body is opaque, so it must survive verbatim
 *
 * Every JSON response passes through the framework's timezone rewriting, which
 * walks nested values and rewrites any string matching its ISO pattern BY
 * VALUE, whatever the key is called. A plugin's body is whatever that plugin
 * defined and the framework knows nothing about its shape, so a block prop or
 * a description holding text like `2026-09-08T12:34Z` arrived already
 * rewritten — and inserting then saving it persists content the author never
 * wrote. The same reason a webhook delivery's captured text opts out.
 *
 * A plugin that wants timestamps normalised can normalise them; a plugin whose
 * text is silently altered has no way back to what it stored.
 *
 * ## An authenticated answer belongs to one session
 *
 * Secure-by-default decides the auth; this is the same rule reaching the
 * cache. A route that required a session answers from that caller's own
 * access, so a shared proxy holding one authorized response could serve it to
 * the next request without the authentication check running again. Applied to
 * the REFUSAL as well, which is the direction that looks like a working gate.
 *
 * A `public: true` route is deliberately left alone: it serves the same bytes
 * to everyone, and forcing `no-store` would throw away caching it is entitled
 * to.
 *
 * Timestamp formatting is skipped unless the route asks for it. The boundary
 * rewrites date-looking strings by VALUE, so a plugin returning descriptors or
 * free text would have fields mangled that were never timestamps. A route
 * answering with collection documents sets `formatTimestamps` and is treated
 * like the built-in read it replaced.
 *
 * Headers are REBUILT rather than set in place. A handler may return a
 * response whose headers are immutable — one that came from `fetch`, say —
 * and setting a header on that throws, turning a marking step into a 500.
 */
function markPluginResponse(
  response: Response,
  route: PluginRoute,
  /**
   * Whether the invocation read a session, as `trackSessionConsultation`
   * reports it. A boolean rather than the request, because the answer is a
   * property of the invocation and not of any one `Request` object.
   */
  sessionConsulted = false
): Response {
  const headers = new Headers(response.headers);
  if (route.formatTimestamps !== true) {
    headers.set(SKIP_TIMEZONE_FORMAT_HEADER, "1");
  }
  if (route.public !== true) applySessionCacheHeaders(headers);
  // A handler that read the caller's session answered personally, however
  // the route was declared: a shared proxy caching that answer would serve
  // one caller's data to another. currentUser flags the request on the way
  // through; this is where the flag becomes a header, so no plugin can
  // forget it.
  if (sessionConsulted) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The refusal a secure route owes a caller that presented no credential.
 *
 * Reached only before the registry is filled. A cold worker decides from the
 * DECLARATION that this request is going to be refused, and declines to run
 * database and plugin startup on its behalf; without this the request instead
 * falls through to the built-in router's invalid-route 400, so the same call is
 * answered 400 cold and 401 warm and a client debugging a missing token is told
 * its URL is wrong.
 *
 * Built here beside {@link runPluginRoute} so a plugin route's error body still
 * has one author. `authRequired` rather than a hand-written body for the same
 * reason: it is the error `toNextlyAuthError` produces from a 401, which is
 * what this request meets once the app is warm.
 */
export function pluginRouteAuthRequired(
  req: Request,
  route: PluginRoute
): Response {
  return markPluginResponse(
    buildErrorResponse(
      NextlyError.authRequired({
        logContext: {
          reason: "plugin-route-auth-required-before-boot",
          path: route.path,
        },
      }),
      {
        requestId: readOrGenerateRequestId(req),
        flattened: currentFlattenedErrors(),
      }
    ),
    route
  );
}

/**
 * The `general` allowance one method spends from, per the configured budgets.
 *
 * Chosen by METHOD, through the core limiter's own split: an install
 * configured for a hundred reads but ten writes per window meant the ten for
 * its mutations, not a hundred of them through each plugin's bucket.
 * `isReadOperation` is imported from the limiter so the split has one list,
 * not two that drift — and the FALLBACKS come from the limiter's own exported
 * defaults for the same reason: an install that configured no limits runs
 * core's REST surface on those defaults, and a plugin route beside it must
 * answer to the same numbers, not to a second set kept here.
 */
function generalAllowance(
  rateLimit: { readLimit?: number; writeLimit?: number } | undefined,
  method: string
): number {
  return isReadOperation(method)
    ? (rateLimit?.readLimit ?? RATE_LIMIT_DEFAULTS.readLimit)
    : (rateLimit?.writeLimit ?? RATE_LIMIT_DEFAULTS.writeLimit);
}

/**
 * The ordinary-traffic allowance, taken from the app's own rate-limit config.
 *
 * Read from configuration rather than fixed here so a plugin route declaring
 * `general` is held to the same budget the app chose for its REST surface,
 * and so turning rate limiting off turns this off too. A config with no
 * limits at all is NOT an off switch on the sanitized path — `enabled`
 * defaults to true there and the core limiter runs on its defaults, so this
 * answers with those same defaults rather than enabling or inventing policy.
 */
async function generalRouteBudget(method: string): Promise<{
  limit: number;
  windowMs: number;
} | null> {
  const { getService } = await import("../../di/service-access");
  const config = getService("config") as
    | {
        rateLimit?: {
          enabled?: boolean;
          readLimit?: number;
          writeLimit?: number;
          windowMs?: number;
        };
      }
    | undefined;
  const rateLimit = config?.rateLimit;
  // Disabled app-wide means NOT LIMITED here, answered as `null` rather than
  // as an enormous number. A huge limit is still a limit: the check ran on
  // every request, calling a configured remote store and, with the in-memory
  // one, keeping an entry alive for every distinct bucket — work the install
  // explicitly turned off, that could never refuse anything.
  if (rateLimit?.enabled === false) return null;
  return {
    limit: generalAllowance(rateLimit, method),
    windowMs: rateLimit?.windowMs ?? RATE_LIMIT_DEFAULTS.windowMs,
  };
}

/** When the refusing window slides, in ms since the epoch, or `null` on admission. */
async function admitByAddress(
  key: string,
  budget: { limit: number; windowMs: number },
  store: RateLimitStore | undefined
): Promise<number | null> {
  const { authRateLimiter } = await import(
    "../../auth/middleware/rate-limiter"
  );
  const verdict = await authRateLimiter(store).check(
    key,
    budget.limit,
    budget.windowMs
  );
  return verdict.allowed ? null : verdict.resetAt.getTime();
}

/**
 * An auth route's admission for a client whose address cannot be resolved:
 * one bucket for every such client let any of them close the route to all
 * (see `route-unknown-source`).
 */
async function admitUnresolvedAuthRoute(
  req: Request,
  matched: RouteMatch,
  configured: {
    requestsPerHour: number;
    windowMs: number;
    counts?: RateLimitStore;
  }
): Promise<number | null> {
  const { noteUnresolvedAuthRequest } = await import(
    "../../auth/handlers/proxy-posture"
  );
  const { admitRouteUnknownSource } = await import("./route-unknown-source");
  const { env } = await import("../../lib/env");
  noteUnresolvedAuthRequest(req);
  const verdict = await admitRouteUnknownSource(req, {
    pluginName: matched.pluginName,
    route: matched.route,
    budget: configured.requestsPerHour,
    windowMs: configured.windowMs,
    ...(configured.counts === undefined ? {} : { store: configured.counts }),
    secret: env.NEXTLY_SECRET || "",
  });
  return verdict.allowed ? null : verdict.resetAt;
}

/**
 * Which BUDGET, decided by what the route declared. `auth` takes core's auth
 * allowance so guessing stays expensive; `general` takes the ordinary API
 * read allowance, which is far larger and is the point of declaring it. Both
 * spend from this plugin's own bucket. A route's own `{ max, windowMs }` is
 * its budget as declared.
 *
 * The counter is shared with the auth limiter deliberately: it is a plain
 * fixed-window counter over a key, and a second implementation of that is a
 * second thing to keep correct.
 */
async function declaredBudget(
  declared: NonNullable<PluginRoute["rateLimit"]>,
  configured: { requestsPerHour: number; windowMs: number },
  method: string
): Promise<{ limit: number; windowMs: number } | null> {
  if (declared === "auth") {
    return { limit: configured.requestsPerHour, windowMs: configured.windowMs };
  }
  if (declared === "general") return generalRouteBudget(method);
  return { limit: declared.max, windowMs: declared.windowMs };
}

/**
 * Apply the route's rate limit, returning the refusal when it trips.
 *
 * The bucket is the plugin's own: sharing core's `/auth/*` bucket would let a
 * plugin's traffic exhaust the budget that protects core's login, and the
 * reverse.
 */
/**
 * Admit or refuse one request to a limited route: `null` admitted, the time
 * its window resets when refused, or the answer while the limit's store is
 * away. A route on the auth budget is refused then, as core's sign-in is; one
 * on the general or its own budget is let through, as the REST limit is (see
 * `core-limit-outage`).
 */
async function admitRouteRequest(
  req: Request,
  matched: RouteMatch,
  limit: {
    declared: NonNullable<PluginRoute["rateLimit"]>;
    resolved: string | null;
    key: string;
    budget: { limit: number; windowMs: number };
    configured: {
      requestsPerHour: number;
      windowMs: number;
      counts?: RateLimitStore;
    };
  }
): Promise<number | null | Response> {
  const { isLimitStoreDown, openWhileStoreIsDown, signInLimitUnavailable } =
    await import("../../domains/limits/core-limit-outage");
  const { declared, configured } = limit;
  const counts =
    declared === "auth" || configured.counts === undefined
      ? configured.counts
      : openWhileStoreIsDown(configured.counts);
  try {
    return declared === "auth" && limit.resolved === null
      ? await admitUnresolvedAuthRoute(req, matched, configured)
      : await admitByAddress(limit.key, limit.budget, counts);
  } catch (error) {
    if (!isLimitStoreDown(error)) throw error;
    return buildErrorResponse(signInLimitUnavailable(error), {
      requestId: readOrGenerateRequestId(req),
      flattened: currentFlattenedErrors(),
    });
  }
}

async function applyRouteRateLimit(
  req: Request,
  matched: RouteMatch
): Promise<Response | null> {
  const declared = matched.route.rateLimit;
  if (declared === undefined) return null;

  const { getTrustedClientIp } = await import(
    "../../utils/get-trusted-client-ip"
  );
  const { readProxyTrustSettings } = await import("../../utils/proxy-trust");
  const { getService } = await import("../../di/service-access");

  const trust = readProxyTrustSettings(() => getService("config"));
  const resolved = getTrustedClientIp(req, trust);
  const ip = resolved ?? "unknown";
  const key = rateLimitKey(matched.route, matched.pluginName, ip);
  if (!key) return null;

  const { readAuthRateLimit } = await import("../../auth/handlers/deps-bridge");
  const configured = readAuthRateLimit(getService as (n: string) => unknown);
  const budget = await declaredBudget(declared, configured, req.method);

  // `null` is rate limiting switched off app-wide; a non-positive limit means
  // the same thing for the auth budget, exactly as it does for the core auth
  // router (`checkAuthIpRateLimit`). Copying the number into a `check`
  // instead made `requestsPerHour: 0` mean "refuse everything": no request
  // can be within a limit of zero, so plugin auth routes answered 429 to
  // everyone while the core routes the setting was written for ran unlimited.
  if (!budget || budget.limit <= 0) return null;

  const resetAt = await admitRouteRequest(req, matched, {
    declared,
    resolved,
    key,
    budget,
    configured,
  });
  if (resetAt instanceof Response) return resetAt;
  if (resetAt === null) return null;

  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

  // The CANONICAL error boundary, for the reason every other refusal here
  // uses it: this is the one plugin-route error no later wrapper decorates,
  // so a hand-built body left these refusals without `requestId`, without
  // `x-request-id`, and outside the development diagnostics — the 429s a
  // client can correlate least, because they are the ones it must wait out.
  return buildErrorResponse(
    NextlyError.rateLimited({
      retryAfterSeconds: retryAfter,
      logContext: {
        reason: "plugin-route-rate-limited",
        plugin: matched.pluginName,
        path: matched.route.path,
      },
    }),
    {
      requestId: readOrGenerateRequestId(req),
      flattened: currentFlattenedErrors(),
    }
  );
}

/** Check the route's cross-site rule, returning the refusal when it fails. */
async function applyRouteCsrf(
  req: Request,
  matched: RouteMatch,
  credential: CallerCredential
): Promise<Response | null> {
  const mode = routeCsrfMode(matched.route, req, credential);
  if (mode === "none") return null;

  // The body is read only when a token may be in it. The origin check needs
  // nothing from the body, so an ordinary write pays no second read.
  const { body, tooLarge } =
    mode === "token"
      ? await readCsrfBody(req)
      : { body: undefined, tooLarge: false };

  const { env } = await import("../../lib/env");
  const result = checkRouteCsrf(
    matched.route,
    req,
    body,
    env.NEXTLY_ALLOWED_ORIGINS_PARSED ?? [],
    credential
  );
  if (result.valid) return null;

  await auditRouteCsrfFailure(req, matched);

  // The CANONICAL error boundary, like the rate-limit refusal beside it: this
  // is one of the errors no later wrapper decorates, so a hand-built body left
  // it without `requestId`, without `x-request-id`, and outside the
  // development diagnostics. `CSRF_FAILED`, as core's own refusals answer, so
  // a client can tell a stale page from missing permissions. `no-store` is set
  // on the built response because the builder does not know a CSRF refusal
  // must never be cached.
  const refusal = buildErrorResponse(
    NextlyError.csrfFailed({
      ...(result.error !== undefined ? { logMessage: result.error } : {}),
      logContext: {
        reason: "plugin-route-csrf-failed",
        plugin: matched.pluginName,
        path: matched.route.path,
        mode,
        ...(tooLarge ? { bodyUnreadable: "too-large" } : {}),
      },
    }),
    {
      requestId: readOrGenerateRequestId(req),
      flattened: currentFlattenedErrors(),
    }
  );
  refusal.headers.set("Cache-Control", "no-store");
  return refusal;
}

/**
 * Record a refused cross-site write as the same `csrf-failed` event core's
 * auth routes record, naming the route by its declared pattern rather than
 * the concrete URL, so no identifier in a path segment reaches the trail.
 */
async function auditRouteCsrfFailure(
  req: Request,
  matched: RouteMatch
): Promise<void> {
  const { getService } = await import("../../di/service-access");
  const { buildAuditLogWriter } = await import(
    "../../domains/audit/audit-log-writer"
  );
  const { getTrustedClientIp } = await import(
    "../../utils/get-trusted-client-ip"
  );
  const { readProxyTrustSettings } = await import("../../utils/proxy-trust");
  const trust = readProxyTrustSettings(() => getService("config"));
  try {
    await buildAuditLogWriter(getService as (n: string) => unknown).write({
      kind: "csrf-failed",
      ipAddress: getTrustedClientIp(req, trust),
      userAgent: req.headers.get("user-agent"),
      metadata: {
        path: `plugins/${matched.pluginName}${matched.route.path}`,
        method: req.method.toUpperCase(),
      },
    });
  } catch {
    // An audit write that fails must not turn a refusal into a 500: the
    // refusal is the protection, the row is the record of it.
  }
}

/**
 * Force `Cache-Control: no-store` when the route asked for it.
 *
 * REPLACES whatever the handler set, rather than deferring to it. Treating an
 * existing header as authoritative meant a handler answering an auth route
 * with `public, max-age=300` kept that value, and a public plugin route gets
 * no later session-cache override — so a shared proxy was free to cache
 * authentication responses and redirects that the route option promises are
 * never cacheable. The option is a guarantee, so it is the one that wins.
 */
function withNoStore(response: Response, route: PluginRoute): Response {
  if (!shouldNotStore(route)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Which REST limit a plugin route's requests are judged by: a route with an
 * auth budget of its own is kept out of the unresolved sources' ceiling, as
 * core's auth routes are, so spending the ceiling cannot deny its sign-in.
 */
export function restLimitTargetOf(route: PluginRoute): RestLimitTarget {
  return route.rateLimit === "auth" ? "auth" : "core";
}

/**
 * Route auth, within the REST limit.
 *
 * A route asking for a kind of person is counted by that person, never by a
 * staff session or key the request also carries, and the kind's resolver is
 * the auth below, called once. A request whose person does not resolve spends
 * a bound of the plugin's own, checked before the resolver runs. Any other
 * route's limit was decided before this.
 */
async function routeAuthWithinLimit(
  req: Request,
  matched: RouteMatch,
  gate: RestLimitGate | undefined
): Promise<
  { refused: Response } | { resolved: RouteAuth | { error: NextlyError } }
> {
  const resolve = () =>
    resolvePluginRouteAuth(req, matched.route, matched.baseCtx.self);
  if (!gate || matched.route.principal === undefined) {
    return { resolved: await resolve() };
  }
  return gate.settlePerson(matched.pluginName, {
    resolve,
    personOf: auth => ("error" in auth ? null : auth.principal),
  });
}

/**
 * Run a matched plugin route. Enforces secure-by-default auth,
 * builds the per-request {@link PluginRouteContext} (the plugin's boot context
 * plus `user`/`params`), and invokes the handler, isolating any thrown error
 * into a Response.
 */
export async function runPluginRoute(
  incoming: Request,
  matched: RouteMatch
): Promise<Response> {
  // The REST limit, before any work the request costs. A route asking for a
  // person settles it around that person's resolution instead, below.
  const gate = currentRestLimitGate(incoming);
  if (matched.route.principal === undefined) {
    const refused = await gate?.settle(restLimitTargetOf(matched.route));
    if (refused) {
      return markPluginResponse(
        withNoStore(refused, matched.route),
        matched.route
      );
    }
  }

  // A root route may sit under `/auth`, where the refresh cookie is sent;
  // nothing past this point is core's refresh or logout handler.
  //
  // Stripping the cookie copies the body, and the copy refuses a body past
  // the CSRF cap with `VALIDATION_ERROR`. Answered here, through the same
  // builder as every refusal below: the catch-all above this maps no thrown
  // error to a response, so a throw would leave the request with none.
  let req: Request;
  try {
    req = await withoutRefreshCookie(incoming);
  } catch (error) {
    return markPluginResponse(
      withNoStore(toErrorResponse(incoming, error), matched.route),
      matched.route
    );
  }
  const settled = await routeAuthWithinLimit(req, matched, gate);
  if ("refused" in settled) {
    return markPluginResponse(
      withNoStore(settled.refused, matched.route),
      matched.route
    );
  }
  const auth = settled.resolved;
  if ("error" in auth) {
    const requestId = readOrGenerateRequestId(req);
    // A server fault here, such as a permission the route cannot work out, is
    // the plugin's to fix, so it is logged with what caused it. A refusal of
    // the caller is not: it is the gate working.
    if (auth.error.statusCode >= 500) {
      getNextlyLogger().error({
        kind: "plugin-route-error",
        ...auth.error.toLogJSON(requestId),
        plugin: matched.pluginName,
        path: matched.route.path,
      });
    }
    return markPluginResponse(
      buildErrorResponse(auth.error, {
        requestId,
        flattened: currentFlattenedErrors(),
      }),
      matched.route
    );
  }

  // Before the handler: a rate limit that runs after the work it is limiting
  // has already paid for the request it meant to refuse. Through
  // `withNoStore` for the same reason handler responses go through it: an
  // auth route's refusal is as much a statement about an authentication
  // attempt as its successes, and this early return is the one path the
  // wrapper below never sees — without it a shared proxy could cache the 429
  // and replay it to later callers.
  const limited = await applyRouteRateLimit(req, matched);
  if (limited) {
    return markPluginResponse(
      withNoStore(limited, matched.route),
      matched.route
    );
  }

  const csrf = await applyRouteCsrf(req, matched, auth.credential);
  if (csrf) return markPluginResponse(csrf, matched.route);

  const ctx: PluginRouteContext = {
    ...matched.baseCtx,
    user: auth.user,
    authenticatedScope: auth.authenticatedScope,
    caller: auth.caller,
    principal: auth.principal,
    params: matched.params,
  };

  const run = composeMiddleware(
    matched.route.middleware ?? [],
    matched.route.handler
  );

  // Declared OUTSIDE the try, so the failure path can read it too: a handler
  // that read a session and then threw produced a personal error response,
  // and a refusal a shared cache holds for one caller is the same defect as
  // an answer it holds.
  // A route asking for a kind hides the staff session from the handler too:
  // `ctx.auth.currentUser` there answers no user, so the handler sees the
  // person or nobody however it asks.
  const session = beginSessionConsultation({
    staffHidden: matched.route.principal !== undefined,
  });
  // A public route's handler that asked for the user of a write another site
  // posted with a session cookie got "no user" from `ctx.auth.currentUser`.
  // Recorded here, once and on either path out, as the refusal above records
  // it for a declared-authenticated route: the same event, naming the route
  // by its declared pattern.
  const recordCrossSiteRead = async (): Promise<void> => {
    if (session.crossSiteRefused()) await auditRouteCsrfFailure(req, matched);
  };

  try {
    // Both scopes pinned for the length of the handler, so a service call
    // inside it inherits the key's grants and the request without the handler
    // having to remember either. Every route written before these fields
    // existed composes `{ as: "user", user }` by hand: an opt-in field leaves
    // all of them authorizing the key as its owner, and leaves every read and
    // write they make looking like background work to a hook.
    //
    // The request's answers about plugin-defined people are pinned as well,
    // so a handler asking for a person through a copy of its request gets the
    // answer the route already has rather than a second resolver call.
    const response = await session.run(() =>
      runWithRequestScope(req, () =>
        runWithPrincipalAnswers(req, () =>
          runWithCallerScope(auth.authenticatedScope, () => run(req, ctx))
        )
      )
    );
    await recordCrossSiteRead();
    return markPluginResponse(
      withNoStore(response, matched.route),
      matched.route,
      session.consulted()
    );
  } catch (err) {
    // The SAME cache directive as the success path. A route declaring
    // `noStore` — or taking the auth budget, which implies it — promises the
    // answer is never stored, and a thrown `NextlyError.notFound()` is a
    // cacheable status: a shared cache could hold it and go on serving a
    // refusal the route never repeated.
    await recordCrossSiteRead();
    return markPluginResponse(
      withNoStore(toErrorResponse(req, err), matched.route),
      matched.route,
      // An error response is personal too when the handler read a session
      // before it failed.
      session.consulted()
    );
  }
}
