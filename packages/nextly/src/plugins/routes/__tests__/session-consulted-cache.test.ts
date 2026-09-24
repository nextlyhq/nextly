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
      publicRoute(() => {
        // What currentUser does internally: record the consultation. It takes
        // no request — the answer being built is what becomes personal,
        // whichever object the handler happened to read from.
        markSessionConsulted();
        return Response.json({ personalized: true });
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers no-store when the session was read through a CLONE", async () => {
    // The case object identity could not see. A handler that wants to read the
    // body as well as the session clones its request — an ordinary thing to
    // do — and the clone is a different object. Keyed on the request, the flag
    // landed on something the dispatcher never looks at: the personalised
    // answer stayed cacheable, and a shared cache could serve one caller's
    // data to another.
    const req = new Request("http://localhost/admin/api/plugins/@a/x/r");
    const res = await runPluginRoute(
      req,
      publicRoute(request => {
        // The clone is the point: a handler that wants the body AND the
        // session reads one through a copy, and the copy is a different
        // object from the one the dispatcher holds.
        const copy = request.clone();
        void copy.text();
        markSessionConsulted();
        return Response.json({ personalized: true });
      })
    );

    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers no-store when the handler read a session and THREW", async () => {
    // An error response is personal too. A refusal a shared cache holds for
    // one caller is the same defect as an answer it holds, so the failure
    // path carries the flag as well.
    const res = await runPluginRoute(
      new Request("http://localhost/admin/api/plugins/@a/x/r"),
      publicRoute(() => {
        markSessionConsulted();
        throw new Error("handler blew up");
      })
    );

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
