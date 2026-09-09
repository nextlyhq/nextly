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
  /**
   * What the caller may DO, as opposed to who they are. `null` on a `public`
   * route reached without a session, exactly like `user`.
   *
   * Distinct from `authenticatedScope` above, which is the raw grant an API key
   * arrived with and is `undefined` for a session — correctly, since a session's
   * grants are resolved on demand and it holds no stamped scope. A route reading
   * the scope alone can therefore answer for a key and not for a signed-in
   * person, and "may this author create here" is asked about people.
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
 * resolved on demand from the database and its list is empty by design, so a
 * route reading one directly would refuse every session user while appearing to
 * check something.
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
  /**
   * Where this route answers.
   *
   * `"plugin"` (the default) serves it under `/plugins/<plugin-name><path>`,
   * which keeps one plugin's routes from colliding with another's by
   * construction.
   *
   * `"root"` serves it at `<path>` itself, so a plugin can own an address its
   * callers already know. A root route is matched only AFTER the built-in REST
   * router has declined the path, so it can never shadow a core route: a plugin
   * claiming `/collections` gets the collections API, not control of it. What it
   * CAN claim is anything core does not serve, which is what lets a plugin take
   * over an endpoint core has stopped shipping without the URL changing.
   */
  mount?: "plugin" | "root";
}
