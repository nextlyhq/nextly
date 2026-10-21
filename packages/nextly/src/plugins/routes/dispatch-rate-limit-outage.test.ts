/**
 * A plugin route's limit while the store core's limits count in is away: a
 * route on the auth budget is refused with an answer to try again shortly, as
 * core's sign-in is, and one on the general or its own budget is let through,
 * as the REST limit lets requests through.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

const away = vi.hoisted(() => ({ store: undefined as unknown }));
vi.mock("../../auth/handlers/deps-bridge", () => ({
  readAuthRateLimit: () => ({
    requestsPerHour: 30,
    windowMs: 3_600_000,
    counts: away.store,
  }),
}));
vi.mock("../../di/register", () => ({
  getService: () => ({ rateLimit: { enabled: true } }),
}));
vi.mock("../../utils/proxy-trust", () => ({
  readProxyTrustSettings: () => ({ trustProxy: true, trustedProxyIps: [] }),
}));
vi.mock("../../utils/get-trusted-client-ip", () => ({
  getTrustedClientIp: () => "203.0.113.7",
}));

import { limitStoreUnavailable } from "../../domains/limits/limit-store";
import type { RateLimitStore } from "../../middleware/rate-limit";
import type { PluginContext } from "../plugin-context";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute } from "./route-types";

const store: RateLimitStore = {
  increment: () => Promise.reject(limitStoreUnavailable("unreachable")),
  reset: () => Promise.reject(limitStoreUnavailable("unreachable")),
  consume: () => Promise.reject(limitStoreUnavailable("unreachable")),
};
away.store = store;

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

function match(rateLimit: PluginRoute["rateLimit"]): RouteMatch {
  return {
    pluginName: "@a/x",
    route: {
      method: "GET",
      path: "/r",
      public: true,
      rateLimit,
      handler: () => Response.json({ ok: true }),
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

const req = () =>
  new Request("http://localhost/admin/api/plugins/@a/x/r", { method: "GET" });

describe("a plugin route's limit while its store is away", () => {
  it("refuses a route on the auth budget with an answer to try again shortly", async () => {
    const res = await runPluginRoute(req(), match("auth"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Please try again shortly.");
  });

  it.each([
    ["the general budget", "general" as const],
    ["a budget of its own", { max: 5, windowMs: 60_000 }],
  ])("lets a route on %s through", async (_case, rateLimit) => {
    const res = await runPluginRoute(req(), match(rateLimit));
    expect(res.status).toBe(200);
  });
});
