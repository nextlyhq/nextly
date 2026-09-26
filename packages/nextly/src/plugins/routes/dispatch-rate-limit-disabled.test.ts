/**
 * What `requestsPerHour: 0` means on a plugin route.
 *
 * It DISABLES the core auth limiter — `checkAuthIpRateLimit` returns early on
 * `limit <= 0`. A plugin route declaring `rateLimit: "auth"` copies that same
 * number into its own budget, and copying it into a `check` call inverts the
 * setting: no request can be within a limit of zero, so every such route
 * answered 429 to everybody while the core routes the setting was written for
 * ran unlimited.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

const check = vi.hoisted(() => vi.fn());
vi.mock("../../auth/middleware/rate-limiter", () => ({
  authRateLimiter: () => ({ check }),
}));

const requestsPerHour = vi.hoisted(() => ({ value: 0 }));
vi.mock("../../auth/handlers/deps-bridge", () => ({
  readAuthRateLimit: () => ({
    requestsPerHour: requestsPerHour.value,
    windowMs: 3_600_000,
    store: undefined,
  }),
}));

vi.mock("../../di/register", () => ({ getService: () => ({}) }));
vi.mock("../../utils/proxy-trust", () => ({
  readProxyTrustSettings: () => ({ trustProxy: false, trustedProxyIps: [] }),
}));
vi.mock("../../utils/get-trusted-client-ip", () => ({
  getTrustedClientIp: () => "1.2.3.4",
}));

import type { PluginContext } from "../plugin-context";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute } from "./route-types";

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

function match(): RouteMatch {
  return {
    pluginName: "@a/x",
    route: {
      method: "GET",
      path: "/r",
      public: true,
      rateLimit: "auth",
      handler: () => Response.json({ ok: true }),
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

function req(): Request {
  return new Request("http://localhost/admin/api/plugins/@a/x/r");
}

beforeEach(() => {
  check.mockReset();
  check.mockResolvedValue({ allowed: true, resetAt: new Date() });
});

describe("a plugin auth route when the limiter is disabled", () => {
  it("does not consult the limiter, and answers the request", async () => {
    requestsPerHour.value = 0;

    const res = await runPluginRoute(req(), match());

    // Asserting what was CONSUMED, not only the status: a 200 could also come
    // from a limiter that was asked and happened to allow, which is a
    // different behaviour from the setting being honoured.
    expect(check).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("still consults it when a positive limit is configured", async () => {
    // The control. Skipping the limiter unconditionally would satisfy the
    // test above while removing the rate limit from every plugin auth route.
    requestsPerHour.value = 5;

    const res = await runPluginRoute(req(), match());

    expect(check).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it("still refuses when that positive limit is exceeded", async () => {
    requestsPerHour.value = 5;
    check.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 60_000),
    });

    const res = await runPluginRoute(req(), match());

    expect(res.status).toBe(429);
  });
});
