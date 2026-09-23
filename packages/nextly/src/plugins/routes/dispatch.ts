import { buildErrorResponse } from "../../api/error-response";
import { readOrGenerateRequestId } from "../../api/request-id";
import { applySessionCacheHeaders } from "../../api/response-shapes";
import {
  apiKeyScopeFrom,
  type AuthenticatedScope,
} from "../../auth/authenticated-scope";
import { runWithCallerScope } from "../../auth/caller-scope";
import {
  isErrorResponse,
  requireAuthentication,
  requirePermission,
} from "../../auth/middleware";
import { toNextlyAuthError } from "../../auth/middleware/to-nextly-error";
import { wasSessionConsulted } from "../../auth/plugin-auth-api";
import { NextlyError } from "../../errors/nextly-error";
import { runWithRequestScope } from "../../hooks/request-scope";
import { currentFlattenedErrors } from "../../hooks/side-effect-warnings";
import {
  isReadOperation,
  RATE_LIMIT_DEFAULTS,
} from "../../middleware/rate-limit";
import { SKIP_TIMEZONE_FORMAT_HEADER } from "../../shared/lib/date-formatting";
import type { AuthUser } from "../../types/auth";
import type { PluginSelf } from "../self";

import { composeMiddleware } from "./middleware";
import { parsePermissionSlug } from "./permission-slug";
import { buildPluginRouteCaller } from "./route-caller";
import {
  callerCredential,
  checkRouteCsrf,
  csrfApplies,
  rateLimitKey,
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

/**
 * Resolve secure-by-default auth for a route. `public: true` skips auth
 * (`user` is `null`). Otherwise the request must be authenticated; if the route
 * declares `requiredPermission`, that permission is enforced too. Returns either
 * the resolved `user` or the failure (401/403) for the caller to serialize.
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
): Promise<
  | {
      user: AuthUser | null;
      authenticatedScope?: AuthenticatedScope;
      caller: PluginRouteCaller | null;
      /** How the caller actually authenticated, for the CSRF decision. */
      credential: "cookie" | "bearer";
    }
  | { error: NextlyError }
> {
  if (route.public === true) {
    return {
      user: null,
      caller: null,
      // No credential resolved anyone on a public route; the sniffed answer
      // feeds the CSRF decision the same way it always did.
      credential: callerCredential(req) === "cookie" ? "cookie" : "bearer",
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
): {
  user: AuthUser;
  authenticatedScope?: AuthenticatedScope;
  caller: PluginRouteCaller;
  credential: "cookie" | "bearer";
} {
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
    return {
      error: NextlyError.forbidden({
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
  req?: Request
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
  if (req && wasSessionConsulted(req)) {
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
  const { getService } = await import("../../di/register");
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

/**
 * Apply the route's rate limit, returning the refusal when it trips.
 *
 * The bucket is the plugin's own: sharing core's `/auth/*` bucket would let a
 * plugin's traffic exhaust the budget that protects core's login, and the
 * reverse.
 */
async function applyRouteRateLimit(
  req: Request,
  matched: RouteMatch
): Promise<Response | null> {
  const declared = matched.route.rateLimit;
  if (declared === undefined) return null;

  const { authRateLimiter } = await import(
    "../../auth/middleware/rate-limiter"
  );
  const { getTrustedClientIp } = await import(
    "../../utils/get-trusted-client-ip"
  );
  const { readProxyTrustSettings } = await import("../../utils/proxy-trust");
  const { getService } = await import("../../di/register");

  const trust = readProxyTrustSettings(() => getService("config"));
  const ip = getTrustedClientIp(req, trust) ?? "unknown";
  const key = rateLimitKey(matched.route, matched.pluginName, ip);
  if (!key) return null;

  const { readAuthRateLimit } = await import("../../auth/handlers/deps-bridge");
  const configured = readAuthRateLimit(getService as (n: string) => unknown);
  // Which BUDGET, decided by what the route declared. `auth` takes core's
  // auth allowance so guessing stays expensive; `general` takes the ordinary
  // API read allowance, which is far larger and is the point of declaring it.
  // Both spend from this plugin's own bucket, keyed above.
  //
  // The counter is shared with the auth limiter deliberately: it is a plain
  // fixed-window counter over a key, and a second implementation of that is a
  // second thing to keep correct.
  const budget =
    declared === "auth"
      ? { limit: configured.requestsPerHour, windowMs: configured.windowMs }
      : await generalRouteBudget(req.method);

  // `null` is rate limiting switched off app-wide; a non-positive limit means
  // the same thing for the auth budget, exactly as it does for the core auth
  // router (`checkAuthIpRateLimit`). Copying the number into a `check`
  // instead made `requestsPerHour: 0` mean "refuse everything": no request
  // can be within a limit of zero, so plugin auth routes answered 429 to
  // everyone while the core routes the setting was written for ran unlimited.
  if (!budget || budget.limit <= 0) return null;

  const limiter = authRateLimiter(configured.store);
  const verdict = await limiter.check(key, budget.limit, budget.windowMs);
  if (verdict.allowed) return null;

  const retryAfter = Math.max(
    1,
    Math.ceil((verdict.resetAt.getTime() - Date.now()) / 1000)
  );

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

/** Check the route's CSRF requirement, returning the refusal when it fails. */
async function applyRouteCsrf(
  req: Request,
  matched: RouteMatch,
  credential: CallerCredential
): Promise<Response | null> {
  if (!csrfApplies(matched.route, req, credential)) return null;

  // Read without consuming: the handler still needs the body. A clone is the
  // only way to look at it twice.
  let body: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = await req.clone().json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // A body that is not JSON carries no token; the header is still checked.
    body = undefined;
  }

  const { env } = await import("../../lib/env");
  const result = checkRouteCsrf(
    matched.route,
    req,
    body,
    env.NEXTLY_ALLOWED_ORIGINS_PARSED ?? [],
    credential
  );
  if (result.valid) return null;

  // The CANONICAL error boundary, like the rate-limit refusal beside it: this
  // is one of the errors no later wrapper decorates, so a hand-built body left
  // it without `requestId`, without `x-request-id`, and outside the
  // development diagnostics. `no-store` is set on the built response because
  // the builder does not know a CSRF refusal must never be cached.
  const refusal = buildErrorResponse(
    NextlyError.forbidden({
      ...(result.error !== undefined ? { logMessage: result.error } : {}),
      logContext: {
        reason: "plugin-route-csrf-failed",
        plugin: matched.pluginName,
        path: matched.route.path,
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
 * Run a matched plugin route. Enforces secure-by-default auth,
 * builds the per-request {@link PluginRouteContext} (the plugin's boot context
 * plus `user`/`params`), and invokes the handler, isolating any thrown error
 * into a Response.
 */
export async function runPluginRoute(
  req: Request,
  matched: RouteMatch
): Promise<Response> {
  const auth = await resolvePluginRouteAuth(
    req,
    matched.route,
    matched.baseCtx.self
  );
  if ("error" in auth) {
    return markPluginResponse(
      buildErrorResponse(auth.error, {
        requestId: readOrGenerateRequestId(req),
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
    params: matched.params,
  };

  const run = composeMiddleware(
    matched.route.middleware ?? [],
    matched.route.handler
  );

  try {
    // Both scopes pinned for the length of the handler, so a service call
    // inside it inherits the key's grants and the request without the handler
    // having to remember either. Every route written before these fields
    // existed composes `{ as: "user", user }` by hand: an opt-in field leaves
    // all of them authorizing the key as its owner, and leaves every read and
    // write they make looking like background work to a hook.
    const response = await runWithRequestScope(req, () =>
      runWithCallerScope(auth.authenticatedScope, () => run(req, ctx))
    );
    return markPluginResponse(
      withNoStore(response, matched.route),
      matched.route,
      req
    );
  } catch (err) {
    // The SAME cache directive as the success path. A route declaring
    // `noStore` — or taking the auth budget, which implies it — promises the
    // answer is never stored, and a thrown `NextlyError.notFound()` is a
    // cacheable status: a shared cache could hold it and go on serving a
    // refusal the route never repeated.
    return markPluginResponse(
      withNoStore(toErrorResponse(req, err), matched.route),
      matched.route,
      req
    );
  }
}
