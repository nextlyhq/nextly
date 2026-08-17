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
  /**
   * Where the route is served. `"plugins"` (default) mounts it under the
   * plugin namespace (`/admin/api/plugins/<name><path>`); `"admin-api"` mounts
   * it directly at the admin API root (`/admin/api<path>`) — for surfaces that
   * read as first-party API (e.g. the docs plugin's `/docs`). Admin-api routes
   * are refused at boot when their first path segment collides with the system
   * REST surface, so a plugin cannot shadow built-in routes.
   */
  mount?: "plugins" | "admin-api";
  /**
   * Optional OpenAPI metadata for this route. Derivation stays zero-action by
   * default (path, method, and security come from the route itself); this only
   * enriches the generated operation with a summary/description/tags.
   */
  openapi?: PluginRouteOpenApi;
}

/**
 * @public Optional OpenAPI metadata a plugin attaches to a route.
 * Every field is optional and flows into the generated operation verbatim.
 */
export interface PluginRouteOpenApi {
  /** A short, human-readable operation summary. */
  summary?: string;
  /** A longer operation description. */
  description?: string;
  /** Extra OpenAPI tags for grouping, merged with the plugin's default tag. */
  tags?: string[];
}
