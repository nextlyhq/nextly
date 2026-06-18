import { readOrGenerateRequestId } from "../../api/request-id";
import {
  createJsonErrorResponse,
  isErrorResponse,
  requireAuthentication,
  requirePermission,
} from "../../auth/middleware";
import { NextlyError } from "../../errors/nextly-error";
import type { AuthUser } from "../../types/auth";

import { parsePermissionSlug } from "./permission-slug";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute, PluginRouteContext } from "./route-types";

/**
 * Map an error thrown by a plugin route handler to a JSON error Response,
 * reusing the dispatcher's `{ error: ... }` / problem+json convention. A
 * non-NextlyError becomes a generic 500 — a handler failure must never crash
 * the server (D28-adjacent robustness).
 */
function toErrorResponse(req: Request, err: unknown): Response {
  const requestId = readOrGenerateRequestId(req);
  const nextlyErr = NextlyError.is(err) ? err : NextlyError.internal();
  return new Response(
    JSON.stringify({ error: nextlyErr.toResponseJSON(requestId) }),
    {
      status: nextlyErr.statusCode,
      headers: {
        "content-type": "application/problem+json",
        "x-request-id": requestId,
      },
    }
  );
}

/**
 * Resolve secure-by-default auth for a route (D28). `public: true` skips auth
 * (`user` is `null`). Otherwise the request must be authenticated; if the route
 * declares `requiredPermission`, that permission is enforced too. Returns either
 * the resolved `user` or a ready-to-return error Response (401/403).
 */
async function resolvePluginRouteAuth(
  req: Request,
  route: PluginRoute
): Promise<{ user: AuthUser | null } | { errorResponse: Response }> {
  if (route.public === true) return { user: null };

  // requirePermission already enforces authentication, so the permission-gated
  // path needs a single call (avoids verifying the session twice).
  const authResult = route.requiredPermission
    ? await requirePermission(req, ...permissionArgs(route.requiredPermission))
    : await requireAuthentication(req);

  if (isErrorResponse(authResult)) {
    return { errorResponse: createJsonErrorResponse(authResult) };
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
 * Run a matched plugin route (D25/D26). Enforces secure-by-default auth (D28),
 * builds the per-request {@link PluginRouteContext} (the plugin's boot context
 * plus `user`/`params`), and invokes the handler, isolating any thrown error
 * into a Response.
 */
export async function runPluginRoute(
  req: Request,
  matched: RouteMatch
): Promise<Response> {
  const auth = await resolvePluginRouteAuth(req, matched.route);
  if ("errorResponse" in auth) return auth.errorResponse;

  const ctx: PluginRouteContext = {
    ...matched.baseCtx,
    user: auth.user,
    params: matched.params,
  };

  try {
    return await matched.route.handler(req, ctx);
  } catch (err) {
    return toErrorResponse(req, err);
  }
}
