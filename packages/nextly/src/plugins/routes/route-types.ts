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
 * hooks/filters/actions/self/config) plus the per-request `user`, `caller` and
 * path `params`. On an API-key request `services.collections` is additionally
 * bound to that key's own scope, so the managed data path authorizes against
 * the key rather than against whoever minted it.
 */
export interface PluginRouteContext extends PluginContext {
  /**
   * The authenticated user, or `null` for a `public` route reached without a
   * session. Pass it to secure-by-default services as `{ as: 'user', user }`.
   */
  user: AuthUser | null;
  /**
   * What the caller may DO, as opposed to who they are. `null` on a `public`
   * route reached without a session, exactly like `user`.
   *
   * Separate from `user` rather than folded into it because {@link AuthUser} is
   * the identity every auth path constructs — the session issuer, the password
   * strategy, registration, refresh — and none of those has a scope to put on
   * it. Widening it would make the security-relevant half optional at every one
   * of those sites, which is the shape that goes missing without failing.
   */
  caller: PluginRouteCaller | null;
  /** Path parameters captured from `:param` segments in the route's path. */
  params: Record<string, string>;
}

/**
 * @public What the authenticated caller of a plugin route may do.
 *
 * Deliberately NOT a permission array. A session caller's permissions are
 * resolved on demand from the database and its list would be empty, so a route
 * reading one directly would refuse every session user while appearing to check
 * something. The question is asked instead, and answered by the same machinery
 * that decides a route's own `requiredPermission`.
 */
export interface PluginRouteCaller {
  /**
   * How the caller authenticated. An `api-key` caller is judged on the key's
   * OWN stamped scope, which is narrower than its owner's grants by design.
   */
  authMethod: "session" | "api-key";
  /**
   * The authenticating API key's own id, present only for an `api-key` caller.
   * Carried so a write can be attributed to the specific key rather than only
   * to the user that owns it.
   */
  apiKeyId?: string;
  /**
   * Verified non-canonical claims from the caller's token — a tenant, a plan,
   * an entitlement. Present when the token carried any.
   */
  claims?: Record<string, unknown>;
  /**
   * May this caller perform `action` on `resource`?
   *
   * `action`/`resource` are the two halves of a permission slug (`create` +
   * `posts`), composed here rather than by the caller so the convention lives
   * in one place. Answers `false` rather than throwing when access cannot be
   * established.
   *
   * A UX and routing aid, not the enforcement point: the write itself is still
   * authorized independently, and a route that only asks this has authorized
   * nothing.
   */
  can(action: string, resource: string): Promise<boolean>;
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
