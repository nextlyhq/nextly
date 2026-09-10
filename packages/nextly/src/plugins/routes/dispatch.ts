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
import { NextlyError } from "../../errors/nextly-error";
import { runWithRequestScope } from "../../hooks/request-scope";
import { currentFlattenedErrors } from "../../hooks/side-effect-warnings";
import { SKIP_TIMEZONE_FORMAT_HEADER } from "../../shared/lib/date-formatting";
import type { AuthUser } from "../../types/auth";
import type { PluginSelf } from "../self";

import { composeMiddleware } from "./middleware";
import { parsePermissionSlug } from "./permission-slug";
import { buildPluginRouteCaller } from "./route-caller";
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
    }
  | { error: NextlyError }
> {
  if (route.public === true) return { user: null, caller: null };

  // The permission this route requires ON THIS INSTALL. A route gating on one
  // of the plugin's own collections gives a function, because the host may have
  // renamed it and a fixed slug would name a grant nobody was seeded.
  let required: string | undefined;
  try {
    required = resolveRoutePermission(route.requiredPermission, self);
  } catch (cause) {
    // A gate that cannot be computed refuses. Falling through to
    // `requireAuthentication` would drop the permission check entirely and
    // admit any signed-in caller — a thrown resolver silently OPENING the route
    // it was written to close.
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

  // requirePermission already enforces authentication, so the permission-gated
  // path needs a single call (avoids verifying the session twice).
  const authResult = required
    ? await requirePermission(req, ...permissionArgs(required))
    : await requireAuthentication(req);

  if (isErrorResponse(authResult)) {
    return { error: toNextlyAuthError(authResult) };
  }

  const user: AuthUser = {
    id: authResult.userId as AuthUser["id"],
    email: authResult.userEmail ?? "",
    name: authResult.userName ?? null,
  };
  // An API key's own grants travel beside the owner it names. `user` carries
  // the owner, so a service that resolves permissions from `user.id` reaches
  // the owner's roles — which is how a viewer-scoped key minted by a
  // super-admin came to be judged as a super-admin on this path. A session
  // caller carries no scope and keeps resolving the normal way.
  const authenticatedScope =
    authResult.authMethod === "api-key"
      ? apiKeyScopeFrom(authResult)
      : undefined;
  // Built from the same `authResult` the scope above is derived from, so the
  // raw grant and the question asked of it cannot disagree about who is asking.
  return {
    user,
    authenticatedScope,
    caller: buildPluginRouteCaller(authResult),
  };
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
 * Headers are REBUILT rather than set in place. A handler may return a
 * response whose headers are immutable — one that came from `fetch`, say —
 * and setting a header on that throws, turning a marking step into a 500.
 */
function markPluginResponse(response: Response, route: PluginRoute): Response {
  const headers = new Headers(response.headers);
  headers.set(SKIP_TIMEZONE_FORMAT_HEADER, "1");
  if (route.public !== true) applySessionCacheHeaders(headers);
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
    return markPluginResponse(
      await runWithRequestScope(req, () =>
        runWithCallerScope(auth.authenticatedScope, () => run(req, ctx))
      ),
      matched.route
    );
  } catch (err) {
    return markPluginResponse(toErrorResponse(req, err), matched.route);
  }
}
