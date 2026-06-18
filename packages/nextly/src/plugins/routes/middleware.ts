import type { Middleware, PluginRouteContext } from "./route-types";

/** The terminal of a middleware chain — the plugin's route handler. */
type TerminalHandler = (
  req: Request,
  ctx: PluginRouteContext
) => Response | Promise<Response>;

/**
 * Compose an ordered, typed route-level middleware chain (D27, onion model).
 * Each middleware may transform the request/response, short-circuit by returning
 * a Response without calling `next`, or call `next()` to continue. Thrown errors
 * propagate to the caller ({@link runPluginRoute} maps them to a Response).
 */
export function composeMiddleware(
  middleware: Middleware[],
  handler: TerminalHandler
): (req: Request, ctx: PluginRouteContext) => Promise<Response> {
  return (req, ctx) => {
    const dispatch = (index: number): Promise<Response> => {
      const mw = middleware[index];
      if (!mw) return Promise.resolve(handler(req, ctx));
      return mw(req, ctx, () => dispatch(index + 1));
    };
    return dispatch(0);
  };
}
