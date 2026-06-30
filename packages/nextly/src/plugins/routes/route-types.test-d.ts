import { expectTypeOf } from "vitest";

import { definePlugin } from "../plugin-context";

import type {
  PluginRoute,
  PluginRouteContext,
  Middleware,
} from "./route-types";

// PluginRouteContext extends PluginContext with per-request user + params.
expectTypeOf<PluginRouteContext>().toHaveProperty("services");
expectTypeOf<PluginRouteContext>().toHaveProperty("db");
expectTypeOf<PluginRouteContext>().toHaveProperty("self");
expectTypeOf<PluginRouteContext>().toHaveProperty("user");
expectTypeOf<PluginRouteContext>().toHaveProperty("params");

// A plugin can declare contributes.routes via definePlugin.
definePlugin({
  name: "@acme/x",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/ping",
        public: true,
        handler: (_req, ctx) => Response.json({ ok: ctx.self.name }),
      },
      {
        method: "POST",
        path: "/export",
        requiredPermission: "export-submissions",
        handler: () => new Response(null, { status: 204 }),
      },
    ] satisfies PluginRoute[],
  },
});

// Middleware is a (req, ctx, next) => Promise<Response> function.
const mw: Middleware = (_req, _ctx, next) => next();
expectTypeOf(mw).toBeFunction();
