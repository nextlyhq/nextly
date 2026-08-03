import { buildErrorResponse } from "../../api/error-response";
import { readOrGenerateRequestId } from "../../api/request-id";
import {
  isErrorResponse,
  requireAuthentication,
  requirePermission,
} from "../../auth/middleware";
import { toNextlyAuthError } from "../../auth/middleware/to-nextly-error";
import { NextlyError } from "../../errors/nextly-error";
import { currentFlattenedErrors } from "../../hooks/side-effect-warnings";
import type { AuthUser } from "../../types/auth";

import { composeMiddleware } from "./middleware";
import { parsePermissionSlug } from "./permission-slug";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute, PluginRouteContext } from "./route-types";

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
): Promise<{ user: AuthUser | null } | { error: NextlyError }> {
  if (route.public === true) return { user: null };

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
  return { user };
}

function permissionArgs(slug: string): [string, string] {
  const { action, resource } = parsePermissionSlug(slug);
  return [action, resource];
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
    return buildErrorResponse(auth.error, {
      requestId: readOrGenerateRequestId(req),
      flattened: currentFlattenedErrors(),
    });
  }

  const ctx: PluginRouteContext = {
    ...matched.baseCtx,
    user: auth.user,
    params: matched.params,
  };

  const run = composeMiddleware(
    matched.route.middleware ?? [],
    matched.route.handler
  );

  try {
    return await run(req, ctx);
  } catch (err) {
    return toErrorResponse(req, err);
  }
}
