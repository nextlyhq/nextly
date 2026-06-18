import { readOrGenerateRequestId } from "../../api/request-id";
import { NextlyError } from "../../errors/nextly-error";

import type { RouteMatch } from "./route-registry";
import type { PluginRouteContext } from "./route-types";

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
 * Run a matched plugin route (D25/D26). Builds the per-request
 * {@link PluginRouteContext} (the plugin's boot context plus `user`/`params`)
 * and invokes the handler, isolating any thrown error into a Response.
 *
 * Secure-by-default auth (D28) is layered on in {@link resolvePluginRouteAuth}.
 */
export async function runPluginRoute(
  req: Request,
  matched: RouteMatch
): Promise<Response> {
  const ctx: PluginRouteContext = {
    ...matched.baseCtx,
    user: null,
    params: matched.params,
  };

  try {
    return await matched.route.handler(req, ctx);
  } catch (err) {
    return toErrorResponse(req, err);
  }
}
