import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { AuthUser } from "../../types/auth";
import type { PermissionSlug } from "../contributions";
import type { PluginContext } from "../plugin-context";

/**
 * @public HTTP methods a plugin route may declare.
 */
export type RouteMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * @public Per-request context handed to a plugin route handler.
 *
 * It is the plugin's boot-built {@link PluginContext} (services/db/logger/events/
 * hooks/filters/actions/self/config) plus the per-request `user` and path `params`.
 */
export interface PluginRouteContext extends PluginContext {
  /**
   * The authenticated user, or `null` for a `public` route reached without a
   * session. Pass it to secure-by-default services as `{ as: 'user', user }`.
   */
  user: AuthUser | null;
  /**
   * The caller's own authorization scope when they arrived on an API key, and
   * `undefined` for a session or a `public` route.
   *
   * A key is authoritative on the grants stamped on IT, never on the roles of
   * whoever minted it. `user` alone cannot carry that: it names the owner, so a
   * service asked to judge `user.id` resolves the owner's database permissions
   * and a viewer-scoped key minted by an administrator inherits the
   * administrator's reach. Forwarding this alongside `user` — which
   * `ServiceOpts` does automatically for `ctx.services` — is what keeps the key
   * judged on its own grant.
   */
  authenticatedScope?: AuthenticatedScope;
  /** Path parameters captured from `:param` segments in the route's path. */
  params: Record<string, string>;
}

/**
 * @public A plugin route handler. Receives the raw web `Request` (body/
 * query/headers) plus the per-request {@link PluginRouteContext}.
 */
export type PluginRouteHandler = (
  req: Request,
  ctx: PluginRouteContext
) => Response | Promise<Response>;

/**
 * @public Typed, ordered route-level middleware (onion model, D27). Call
 * `next()` to continue the chain, or return a `Response` to short-circuit.
 */
export type Middleware = (
  req: Request,
  ctx: PluginRouteContext,
  next: () => Promise<Response>
) => Promise<Response>;

/**
 * @public A single HTTP route contributed by a plugin. Mounted at
 * `/api/plugins/<plugin-name><path>` under the existing catch-all and secure by
 * default (auth + RBAC) unless `public: true`.
 */
export interface PluginRoute {
  method: RouteMethod;
  /**
   * Path within the plugin namespace; MUST start with `"/"`. Supports `:param`
   * segments (e.g. `"/items/:id"`). Final URL: `/api/plugins/<plugin-name><path>`.
   */
  path: string;
  handler: PluginRouteHandler;
  /** Secure-by-default: the permission slug required to call this route. */
  requiredPermission?: PermissionSlug;
  /** Opt out of auth — the route is publicly callable. */
  public?: boolean;
  /** Ordered, typed route-level middleware chain. */
  middleware?: Middleware[];
}
