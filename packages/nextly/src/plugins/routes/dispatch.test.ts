import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { PluginContext } from "../plugin-context";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute } from "./route-types";

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

function match(
  route: PluginRoute,
  params: Record<string, string> = {}
): RouteMatch {
  return { pluginName: "@a/x", route, baseCtx, params };
}

describe("runPluginRoute", () => {
  it("invokes the handler with a per-request ctx (user + params) and returns its Response", async () => {
    const route: PluginRoute = {
      method: "GET",
      path: "/i/:id",
      public: true,
      handler: (_req, ctx) =>
        Response.json({
          id: ctx.params.id,
          who: ctx.self.name,
          user: ctx.user,
        }),
    };
    const res = await runPluginRoute(
      new Request("http://x/api/plugins/@a/x/i/7"),
      match(route, { id: "7" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "7", who: "@a/x", user: null });
  });

  it("maps a handler-thrown NextlyError to an error Response with its status", async () => {
    const route: PluginRoute = {
      method: "GET",
      path: "/boom",
      public: true,
      handler: () => {
        throw new NextlyError({
          code: "NOT_FOUND",
          statusCode: 404,
          publicMessage: "nope",
        });
      },
    };
    const res = await runPluginRoute(
      new Request("http://x/api/plugins/@a/x/boom"),
      match(route)
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("maps an unknown thrown error to a 500 (never crashes the dispatcher)", async () => {
    const route: PluginRoute = {
      method: "GET",
      path: "/explode",
      public: true,
      handler: () => {
        throw new Error("kaboom");
      },
    };
    const res = await runPluginRoute(
      new Request("http://x/api/plugins/@a/x/explode"),
      match(route)
    );
    expect(res.status).toBe(500);
  });
});
