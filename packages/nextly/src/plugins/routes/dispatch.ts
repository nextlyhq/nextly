import { buildErrorResponse } from "../../api/error-response";
import { readOrGenerateRequestId } from "../../api/request-id";
import { applySessionCacheHeaders } from "../../api/response-shapes";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import {
  isErrorResponse,
  requireAuthentication,
  requirePermission,
} from "../../auth/middleware";
import { toNextlyAuthError } from "../../auth/middleware/to-nextly-error";
import { NextlyError } from "../../errors/nextly-error";
import { currentFlattenedErrors } from "../../hooks/side-effect-warnings";
import { SKIP_TIMEZONE_FORMAT_HEADER } from "../../shared/lib/date-formatting";
import type { AuthUser } from "../../types/auth";

import { runWithCallerScope } from "./caller-scope";
import { composeMiddleware } from "./middleware";
import { parsePermissionSlug } from "./permission-slug";
import { buildPluginRouteCaller } from "./route-caller";
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
  route: PluginRoute
): Promise<
  | {
      user: AuthUser | null;
      authenticatedScope?: AuthenticatedScope;
      caller: PluginRouteCaller | null;
    }
  | { error: NextlyError }
> {
  if (route.public === true) return { user: null, caller: null };

  // requirePermission already enforces authentication, so the permission-gated
  // path needs a single call (avoids verifying the session twice).
  const authResult = route.requiredPermission
    ? await requirePermission(req, ...permissionArgs(route.requiredPermission))
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
      ? {
          actorType: "apiKey" as const,
          permissions: authResult.permissions,
          roles: authResult.roles,
        }
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
 * Run a matched plugin route. Enforces secure-by-default auth,
 * builds the per-request {@link PluginRouteContext} (the plugin's boot context
 * plus `user`/`params`), and invokes the handler, isolating any thrown error
 * into a Response.
 */
export async function runPluginRoute(
  req: Request,
  matched: RouteMatch
): Promise<Response> {
  const auth = await resolvePluginRouteAuth(req, matched.route);
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
    // Pinned for the length of the handler so a service call inside it inherits
    // the key's grants without the handler having to remember. Every route
    // written before this field existed composes `{ as: "user", user }` by
    // hand, and an opt-in field leaves all of them authorizing the key as its
    // owner.
    return markPluginResponse(
      await runWithCallerScope(auth.authenticatedScope, () => run(req, ctx)),
      matched.route
    );
  } catch (err) {
    return markPluginResponse(toErrorResponse(req, err), matched.route);
  }
}
