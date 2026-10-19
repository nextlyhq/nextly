import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { AuthLimitAnswer } from "../../auth/pipeline/types";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import type { AuthUser } from "../../types/auth";
import type { PermissionSlug } from "../contributions";
import type { PluginContext } from "../plugin-context";
import type { Principal, PluginRoutePrincipal } from "../principals/types";

import type { PluginRoutePermissionResolver } from "./route-permission";

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
   * session and for a route that asks for a `principal`, which reads no staff
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
   * route reached without a session and on a route that asks for a
   * `principal`, exactly like `user`.
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
  /**
   * @experimental The signed-in person of the kind the route asks for in
   * `principal`, or `null`: on a route that asks for none, and on one whose
   * `principal` is not `required` when nobody of that kind is signed in.
   */
  principal: Principal | null;
  /** Path parameters captured from `:param` segments in the route's path. */
  params: Record<string, string>;
}

/**
 * @public Who a plugin route's caller is to an enforced read.
 *
 * `user` is the `UserContext` every stored access rule is evaluated against;
 * `authenticatedScope` is present only for an `api-key` caller and narrows
 * the read to the key's own grants.
 */
export type PluginRouteIdentity = ReadCaller;

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
   * The caller as an ENFORCED Direct API read takes them: the canonical
   * identity with the roles a stored rule reads, the verified claims a custom
   * rule may decide on, and — for an `api-key` caller — the key's own scope.
   *
   * A route reading "as the user" passes these to `find` / `findByID` with
   * `overrideAccess: false`. Built from `user` alone, a context carries no
   * roles, and a role-based rule on the collection then refuses a caller the
   * route's own gate admitted — with nothing in the route to say why. The
   * roles are resolved from the account once per request, on first use, by
   * the same reader {@link can} judges by.
   */
  identity(): Promise<PluginRouteIdentity>;
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
 * @public Where a plugin route answers.
 *
 * Named rather than spelled inline, because the server contract and the admin
 * clients that call it have to agree. Two copies of the union compile happily
 * while disagreeing, so a plugin could declare a mount the client rejects and
 * nothing would connect the two definitions.
 */
export type PluginRouteMount = "plugin" | "root";

/**
 * @experimental A plugin auth route's `limitKey`, answering as an
 * `AuthStrategy`'s does: `{ handles: true, key }` for the identity a request
 * names, `{ handles: false }` or a `null` key for none.
 */
export type PluginRouteLimitKey = (input: {
  request: Request;
  body: Record<string, unknown>;
}) => AuthLimitAnswer | Promise<AuthLimitAnswer>;

/** @experimental A plugin route's own rate-limit allowance. */
export interface PluginRouteRateLimit {
  /** Requests one client may make in a window, a positive integer. */
  max: number;
  /** The window, in milliseconds, a positive integer. */
  windowMs: number;
}

/**
 * @public A single HTTP route contributed by a plugin. Answers at
 * `/plugins/<plugin-name><path>` under the existing catch-all, so its full URL
 * depends on where the app mounts that handler: a scaffolded project serves it
 * from `/admin/api`. Secure by default (auth + RBAC) unless `public: true`.
 */
export interface PluginRoute {
  method: RouteMethod;
  /**
   * Path within the plugin namespace; MUST start with `"/"`. Supports `:param`
   * segments (e.g. `"/items/:id"`). Answers at
   * `<handler mount>/plugins/<plugin-name><path>`, which is
   * `/admin/api/plugins/...` in a scaffolded project.
   */
  path: string;
  handler: PluginRouteHandler;
  /**
   * Secure-by-default: the permission required to call this route.
   *
   * A fixed slug when the route gates on a name that cannot move —
   * `"export-submissions"`, or any permission the plugin declared itself.
   *
   * A FUNCTION when the permission names one of the plugin's own collections
   * or singles, because the host can rename those (`ctx.self`'s P2 remap) and a
   * fixed slug would then demand a grant seeded under a different name — a
   * route nobody on that install can call. The scope composes the slug, so the
   * route never spells one:
   *
   * ```ts
   * requiredPermission: ({ collection }) => collection(PATTERNS_SLUG, "create"),
   * ```
   *
   * The resolver runs on every request to the route, before the caller is
   * known, and must be pure and synchronous. A resolver that throws refuses the
   * request: a gate that cannot be computed must not fall through to the
   * ungated path.
   */
  requiredPermission?: PermissionSlug | PluginRoutePermissionResolver;
  /** Opt out of auth — the route is publicly callable. */
  public?: boolean;
  /**
   * @experimental Serve a plugin's kind of signed-in person instead of staff.
   *
   * The route reads neither the staff session nor an API key: its handler
   * receives the person as `ctx.principal`, with `user` and `caller` null,
   * however the browser is signed in to the admin. With `required` left at
   * its default, a request with no such person is refused as any route
   * refuses an unauthenticated one. A person's writes take the route's
   * `csrf` check as a session cookie's do, unless the request carries a
   * `Bearer` token.
   *
   * Cannot be combined with `public` or `requiredPermission`: a person holds
   * no permission, and a public route authenticates nobody. Either pair, or
   * a kind no plugin registers, stops the app from starting.
   */
  principal?: PluginRoutePrincipal;
  /**
   * @experimental Apply a per-IP rate limit, counted for THIS route alone.
   *
   * - `"auth"` uses the same limit and window as `/auth/*`, in its OWN key
   *   namespace — a plugin's sign-in route is as much a credential-stuffing
   *   target as core's, and sharing core's bucket would let either exhaust the
   *   other's budget.
   * - `"general"` uses the app's REST read or write allowance.
   * - `{ max, windowMs }` sets this route's own allowance: at most `max`
   *   requests per `windowMs` milliseconds.
   *
   * Each route path has its own bucket per client, so an SSO sign-in
   * spending `authorize` and `callback` costs one request from each route's
   * budget rather than two from one. `"general"` also counts reads and writes
   * apart, and `{ max, windowMs }` counts each method apart. IPv6 clients are
   * counted by their /64.
   *
   * The client address is read only when `security.trustProxy` is on. Off,
   * `"general"` and `{ max, windowMs }` routes share one bucket among every
   * client, and boot warns about each. An `"auth"` route is counted as core's
   * sign-in is instead: per identity its `limitKey` names, under a ceiling
   * of 100 times the budget shared by all of this plugin's auth routes, so
   * one visitor cannot close the route to everyone. Without a `limitKey` it
   * is bounded by that ceiling alone, and boot names it.
   */
  rateLimit?: "general" | "auth" | PluginRouteRateLimit;
  /**
   * @experimental Name the identity a request to a `rateLimit: "auth"` route
   * targets, for the clients whose address cannot be read.
   *
   * Answers as an `AuthStrategy`'s `limitKey` does, given the request's
   * headers and its JSON body (read up to 32 KB; larger or unparseable bodies
   * arrive empty). The key comes from the request alone, never from whether an account matches it, and is normalised as
   * the handler's own lookup normalises it: a known and an unknown identity
   * are then limited alike. For a credential that names no identity before
   * it is looked up, such as an OAuth code or a magic-link token, name the
   * credential itself. The key is stored only as an HMAC under the app's
   * secret, scoped to this plugin.
   *
   * Every identity has the auth budget of its own, spent across all of this
   * plugin's auth routes. `{ handles: false }`, a `null` or empty key, a
   * throw, a rejection or anything that is not an answer counts the request
   * against one budget shared by this plugin's requests that name no
   * identity. Ignored on other routes, and where the address resolves.
   */
  limitKey?: PluginRouteLimitKey;
  /**
   * @experimental Declare that the handler reads the request body as the
   * exact bytes sent.
   *
   * Every plugin handler is given the untouched `Request`, flag or not: core
   * never parses or re-serialises a plugin route's body before the handler
   * runs (a CSRF token check reads a clone), so a signed webhook can verify
   * its signature over `await request.arrayBuffer()` or `request.text()`. The
   * flag states that intent, and is validated: a `GET` route declaring it is
   * refused when the plugin's routes are collected, since that method carries
   * no body.
   */
  rawBody?: boolean;
  /**
   * @experimental The cross-site check for unsafe methods.
   *
   * The origin check means the request's `Origin` (or `Referer`) must be
   * this site or one in `NEXTLY_ALLOWED_ORIGINS`; a write naming no origin
   * is refused.
   *
   * - Left unset, an authenticated route checks the origin of a write the
   *   session cookie authenticates. A same-origin write passes it without a
   *   token. A `public` route checks no write here, though
   *   `ctx.auth.currentUser` answers no user to a cross-site one.
   * - `true` checks the origin and requires a valid double-submit CSRF
   *   token, in the `x-csrf-token` header or as `csrfToken` in a JSON body,
   *   from a caller the session cookie authenticates. It also checks the
   *   origin, with no token, of a write no session authenticates, such as an
   *   anonymous visitor's to a `public` route: a cookie the plugin keeps for
   *   such visitors, a guest cart's id say, travels on a cross-site post. A
   *   session cookie that is expired or malformed authenticates nobody.
   * - `false` refuses every unsafe-method request the session cookie
   *   authenticates, from any origin, so the route takes writes only from
   *   callers with another credential. It cannot be combined with
   *   `public: true`: the pair is refused when routes are collected, and
   *   the app does not boot.
   *
   * A person a route's `principal` recognises is checked as a caller the
   * session cookie authenticates is.
   *
   * A request that sends an `Authorization: Bearer` token (an API key) is not
   * checked, whatever the setting, unless the session cookie authenticates
   * it: a browser cannot attach the token cross-site, and the attack this
   * prevents needs the credential to travel automatically. On a `public`
   * route a session the cookie authenticates takes precedence over the
   * header, and the request is checked as a session-cookie caller's. On a
   * route that asks for a `principal`, the token exempts the request whether
   * or not anyone of the kind is recognised.
   * The scheme is matched in any case. Any other scheme, such
   * as the Basic, Digest, Negotiate or NTLM credentials a browser attaches
   * on its own, exempts nothing. A route for webhooks or other server
   * callers is `public: true` and leaves `csrf` unset; on `true`, such a
   * caller without a `Bearer` token must send `Origin`.
   *
   * The admin's `usePluginRouteMutation` sends the token on every write, so a
   * route the plugin's admin page writes to works with `csrf` unset or
   * `true`. A page that writes with its own `fetch` either leaves `csrf`
   * unset or fetches a token from `/auth/csrf` and sends it.
   *
   * A refusal answers 403 `CSRF_FAILED` and records a `csrf-failed` audit
   * event.
   */
  csrf?: boolean;
  /**
   * @experimental Add `Cache-Control: no-store` to every response. Always set
   * for `rateLimit: "auth"`, whose responses describe an authentication
   * attempt.
   */
  noStore?: boolean;
  /**
   * Convert stored timestamps to the installation's configured timezone, the
   * way every built-in collection read does.
   *
   * Off by default, and that default is the safe one: the response boundary
   * rewrites date-LOOKING strings by value, so a route returning descriptors,
   * identifiers or free text could have a field mangled that was never a
   * timestamp. A route answering with collection documents wants it on, and
   * before this flag existed such a route could not ask: a plugin taking over
   * an endpoint that used to be core's silently changed its timestamps on
   * every install with a non-UTC timezone.
   */
  formatTimestamps?: boolean;
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
  mount?: PluginRouteMount;
}
