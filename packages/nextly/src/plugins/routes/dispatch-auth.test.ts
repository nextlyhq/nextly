import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth middleware so we drive the secure-by-default branches without a
// real session. `isErrorResponse` keeps its real shape.
//
// The conversion from a legacy auth result to the canonical error is NOT
// mocked: it lives in its own module, and the point of the body assertions
// below is what a caller actually receives, which a stubbed converter would
// decide instead of the code.
vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
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
    // The canonical envelope, not the legacy auth one. A rejected request and
    // a failing handler on the SAME route answered in two different shapes,
    // because each was built by a different owner; a status-only assertion is
    // what let that stand.
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({
      error: expect.objectContaining({
        code: "AUTH_REQUIRED",
        requestId: expect.any(String),
      }),
    });
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
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({
      error: expect.objectContaining({ code: "FORBIDDEN" }),
    });
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

/**
 * `ctx.user` names the ACCOUNT, which for an API-key request is the key's
 * OWNER. A service asked to judge `user.id` therefore resolves the owner's
 * roles, so a viewer-scoped key minted by a super-admin was authorized as a
 * super-admin. The key's own grants have to arrive alongside the account, and
 * this is the seam that either carries them or drops them.
 */
describe("plugin route dispatch — the caller's own scope", () => {
  /** Returns the scope rather than the user, so the assertion is about it. */
  function scopeRoute(): PluginRoute {
    return route({
      handler: (_req, ctx) => {
        handlerCalls++;
        return Response.json({ scope: ctx.authenticatedScope ?? null });
      },
    });
  }

  it("carries an API key's own grants into the route context", async () => {
    reqAuth.mockResolvedValue({
      ...okAuth,
      authMethod: "api-key",
      apiKeyId: "key-1",
      // The KEY's resolved scope. Narrower than its owner's, which is the
      // whole point: `read-posts` alone must not authorize a write.
      permissions: ["read-posts"],
      roles: ["viewer"],
    } as never);

    const res = await runPluginRoute(req(), match(scopeRoute()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scope: { actorType: "apiKey", permissions: ["read-posts"] },
    });
  });

  it("gives a session caller no key scope, so it resolves the normal way", async () => {
    // The control. Without it a field hardcoded to a constant satisfies the
    // assertion above, and the session path — which must keep its super-admin
    // bypass — would be silently reclassified as a scoped key.
    reqAuth.mockResolvedValue({
      ...okAuth,
      authMethod: "session",
      permissions: ["read-posts"],
      roles: ["viewer"],
    } as never);

    const res = await runPluginRoute(req(), match(scopeRoute()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scope: null });
  });

  it("gives a public route no scope, having never authenticated", async () => {
    const res = await runPluginRoute(
      req(),
      match(
        route({
          public: true,
          handler: (_r, ctx) =>
            Response.json({ scope: ctx.authenticatedScope ?? null }),
        })
      )
    );
    expect(await res.json()).toEqual({ scope: null });
    expect(reqAuth).not.toHaveBeenCalled();
  });
});
