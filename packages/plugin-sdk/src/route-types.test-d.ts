import type {
  Middleware,
  PluginRoute,
  PluginRouteContext,
  PluginRouteLimitKey,
  RouteMethod,
} from "@nextlyhq/plugin-sdk";

// PluginRoute: method + path + handler, with optional security + middleware.
const route: PluginRoute = {
  method: "GET",
  path: "/export",
  requiredPermission: "export-submissions",
  handler: (_req, ctx: PluginRouteContext) =>
    Response.json({ who: ctx.self.name, user: ctx.user, id: ctx.params.id }),
};

// A public route opts out of auth.
const publicRoute: PluginRoute = {
  method: "POST",
  path: "/webhook",
  public: true,
  handler: () => new Response(null, { status: 204 }),
};

// An auth-limited route names the identity a request targets, answering as
// an auth strategy's `limitKey` does, so clients whose address cannot be read
// are limited per identity, not as one.
const byEmail: PluginRouteLimitKey = ({ body }) =>
  typeof body.email === "string"
    ? { handles: true, key: body.email.toLowerCase() }
    : { handles: false };
const signInRoute: PluginRoute = {
  method: "POST",
  path: "/sign-in",
  public: true,
  rateLimit: "auth",
  limitKey: byEmail,
  handler: () => new Response(null, { status: 204 }),
};

// Middleware is a (req, ctx, next) => Promise<Response> function.
const mw: Middleware = (_req, _ctx, next) => next();

const method: RouteMethod = "PATCH";

// Exported so eslint does not flag the assertions as unused.
export const __routeTypeCheck = { route, publicRoute, signInRoute, mw, method };
