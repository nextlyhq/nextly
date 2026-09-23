/**
 * A public route whose handler read the caller's session must answer
 * uncacheably.
 *
 * The response differs between an anonymous and a signed-in caller, and a
 * shared proxy holding the signed-in answer would serve one caller's data to
 * another. currentUser flags the request on its way through; the plugin-route
 * wrapper turns the flag into Cache-Control: no-store, so no plugin can
 * forget it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

vi.mock("../../../auth/middleware/rate-limiter", () => ({
  authRateLimiter: () => ({ check: vi.fn(async () => ({ allowed: true })) }),
}));

vi.mock("../../../auth/handlers/deps-bridge", () => ({
  readAuthRateLimit: () => ({
    requestsPerHour: 1000,
    windowMs: 3_600_000,
    store: undefined,
  }),
}));

vi.mock("../../../di/register", () => ({ getService: () => ({}) }));
vi.mock("../../../utils/proxy-trust", () => ({
  readProxyTrustSettings: () => ({ trustProxy: false, trustedProxyIps: [] }),
}));
vi.mock("../../../utils/get-trusted-client-ip", () => ({
  getTrustedClientIp: () => "1.2.3.4",
}));

import type { PluginContext } from "../../plugin-context";
import { markSessionConsulted } from "../../../auth/plugin-auth-api";

import { runPluginRoute } from "../dispatch";
import type { RouteMatch } from "../route-registry";
import type { PluginRoute } from "../route-types";

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

function publicRoute(handler: (req: Request) => Response): RouteMatch {
  return {
    pluginName: "@a/x",
    route: {
      method: "GET",
      path: "/r",
      public: true,
      handler,
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

describe("a public route that consults the session", () => {
  it("answers with Cache-Control: no-store", async () => {
    const req = new Request("http://localhost/admin/api/plugins/@a/x/r");
    const res = await runPluginRoute(
      req,
      publicRoute(request => {
        // What currentUser does internally: record the consultation.
        markSessionConsulted(request);
        return Response.json({ personalized: true });
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves a session-blind public response alone", async () => {
    const res = await runPluginRoute(
      new Request("http://localhost/admin/api/plugins/@a/x/r"),
      publicRoute(() => Response.json({ same: "for everyone" }))
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
