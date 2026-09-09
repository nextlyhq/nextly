import { expectTypeOf } from "vitest";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
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

// `authenticatedScope` is what keeps a scoped API key judged on its own grants
// rather than its owner's roles. Two properties are asserted here because
// `plugin-surface.test.ts` cannot see either: it extracts export NAMES and
// KINDS from `export {}` blocks, so ADDING a field to a `@public` type passes
// its snapshot unchanged, in both directions.

// REACHABLE, and typed — not widened to `unknown`, which is what a plugin
// would get if the type stopped being exported from the SDK.
expectTypeOf<PluginRouteContext>().toHaveProperty("authenticatedScope");
expectTypeOf<PluginRouteContext["authenticatedScope"]>().toEqualTypeOf<
  AuthenticatedScope | undefined
>();
expectTypeOf<
  NonNullable<PluginRouteContext["authenticatedScope"]>["permissions"]
>().toEqualTypeOf<string[]>();

// ADDITIVE. A route written before this field existed still type-checks, so
// the change cannot have made it required. `toEqualTypeOf` above would pass on
// a required field too — this is the half that fails if the optionality goes.
const routeWrittenBeforeTheField: PluginRoute = {
  method: "GET",
  path: "/legacy",
  handler: (_req, ctx) => Response.json({ id: ctx.user?.id ?? null }),
};
expectTypeOf(routeWrittenBeforeTheField).toMatchTypeOf<PluginRoute>();

// OPTIONAL, asserted directly. This is the one that goes red if
// `authenticatedScope` is ever made required — the breaking change the
// `@public` tag on this type promises not to make.
//
// `{} extends Pick<T, K>` is true only when K is optional: a required key
// leaves `Pick` demanding it, and the empty object stops being assignable.
type KeyIsOptional<T, K extends keyof T> =
  Record<string, never> extends Pick<T, K> ? true : false;

expectTypeOf<
  KeyIsOptional<PluginRouteContext, "authenticatedScope">
>().toEqualTypeOf<true>();

// The control for the line above: `user` is REQUIRED on this context (it is
// `AuthUser | null`, never absent), so the helper must say so. Without this,
// a helper that returned `true` for everything would satisfy the assertion.
expectTypeOf<
  KeyIsOptional<PluginRouteContext, "user">
>().toEqualTypeOf<false>();
