import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth middleware so we drive the secure-by-default branches without a
// real session. isErrorResponse/createJsonErrorResponse keep their real shape.
vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
  createJsonErrorResponse: (e: { statusCode: number; error?: string }) =>
    new Response(JSON.stringify({ error: e }), { status: e.statusCode }),
}));

import {
  requireAuthentication,
  requirePermission,
} from "../../auth/middleware";
import type { PluginContext } from "../plugin-context";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute } from "./route-types";

const reqAuth = vi.mocked(requireAuthentication);
const reqPerm = vi.mocked(requirePermission);

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

let handlerCalls = 0;
function route(extra: Partial<PluginRoute>): PluginRoute {
  return {
    method: "GET",
    path: "/r",
    handler: (_req, ctx) => {
      handlerCalls++;
      return Response.json({ user: ctx.user });
    },
    ...extra,
  } as PluginRoute;
}
function match(r: PluginRoute): RouteMatch {
  return { pluginName: "@a/x", route: r, baseCtx, params: {} };
}
const req = () => new Request("http://x/api/plugins/@a/x/r");
const okAuth = { userId: "u1", userEmail: "u1@x.com", userName: "U" };

beforeEach(() => {
  handlerCalls = 0;
  reqAuth.mockReset();
  reqPerm.mockReset();
});

describe("secure-by-default plugin route dispatch", () => {
  it("public route runs the handler without calling auth; user is null", async () => {
    const res = await runPluginRoute(req(), match(route({ public: true })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
    expect(reqAuth).not.toHaveBeenCalled();
    expect(handlerCalls).toBe(1);
  });

  it("protected route returns 401 when unauthenticated; handler not called", async () => {
    reqAuth.mockResolvedValue({ statusCode: 401 } as never);
    const res = await runPluginRoute(req(), match(route({})));
    expect(res.status).toBe(401);
    expect(handlerCalls).toBe(0);
  });

  it("protected route runs with a mapped ctx.user when authenticated", async () => {
    reqAuth.mockResolvedValue(okAuth as never);
    const res = await runPluginRoute(req(), match(route({})));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: "u1", email: "u1@x.com", name: "U" },
    });
    expect(handlerCalls).toBe(1);
  });

  it("requiredPermission route returns 403 when denied; handler not called", async () => {
    reqPerm.mockResolvedValue({ statusCode: 403 } as never);
    const res = await runPluginRoute(
      req(),
      match(route({ requiredPermission: "export-submissions" }))
    );
    expect(res.status).toBe(403);
    expect(reqPerm).toHaveBeenCalledWith(
      expect.anything(),
      "export",
      "submissions"
    );
    expect(handlerCalls).toBe(0);
  });

  it("requiredPermission route runs when permission is granted", async () => {
    reqPerm.mockResolvedValue(okAuth as never);
    const res = await runPluginRoute(
      req(),
      match(route({ requiredPermission: "export-submissions" }))
    );
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(1);
    expect(reqAuth).not.toHaveBeenCalled(); // requirePermission covers auth
  });
});
