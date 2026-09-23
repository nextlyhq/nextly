/**
 * Which configured allowance a `rateLimit: "general"` plugin route spends from.
 *
 * The app configures reads and writes separately (`readLimit` /
 * `writeLimit`), and its core REST limiter picks the budget by method. A
 * plugin route that always took `readLimit` let an install configured for a
 * hundred reads and ten writes make a hundred mutations through each
 * plugin's bucket — the stricter number is the one the operator wrote for
 * exactly that traffic.
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

vi.mock("../../auth/handlers/deps-bridge", () => ({
  readAuthRateLimit: () => ({
    requestsPerHour: 1_000,
    windowMs: 3_600_000,
    store: undefined,
  }),
}));

const config = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock("../../di/register", () => ({ getService: () => config.value }));
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

function match(method: string): RouteMatch {
  return {
    pluginName: "@a/x",
    route: {
      method,
      path: "/r",
      public: true,
      rateLimit: "general",
      handler: () => Response.json({ ok: true }),
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

function req(method: string): Request {
  return new Request("http://localhost/admin/api/plugins/@a/x/r", { method });
}

beforeEach(() => {
  check.mockReset();
  check.mockResolvedValue({ allowed: true, resetAt: new Date() });
  config.value = {
    rateLimit: { enabled: true, readLimit: 100, writeLimit: 7 },
  };
});

describe("a general-limited plugin route picks its budget by method", () => {
  it("spends the WRITE allowance on a mutating method", async () => {
    const res = await runPluginRoute(req("POST"), match("POST"));

    expect(check).toHaveBeenCalledWith(
      expect.any(String),
      7,
      expect.any(Number)
    );
    expect(res.status).toBe(200);
  });

  it.each(["PUT", "PATCH", "DELETE"])(
    "spends the write allowance on %s too",
    async method => {
      await runPluginRoute(req(method), match(method));

      expect(check).toHaveBeenCalledWith(
        expect.any(String),
        7,
        expect.any(Number)
      );
    }
  );

  it("spends the READ allowance on a GET", async () => {
    // The control: routing every method to the write budget would satisfy
    // the tests above while tightening reads the operator left loose.
    await runPluginRoute(req("GET"), match("GET"));

    expect(check).toHaveBeenCalledWith(
      expect.any(String),
      100,
      expect.any(Number)
    );
  });
});

describe("a plugin rate-limit refusal answers through the canonical boundary", () => {
  it("carries the request id, the envelope, and the retry hint", async () => {
    // This is the one plugin-route error no later wrapper decorates, so a
    // hand-built body left it without `requestId`, without `x-request-id`,
    // and outside the development diagnostics — the 429 a client can
    // correlate least, because it is the one it must wait out.
    check.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 90_000),
    });

    const res = await runPluginRoute(req("GET"), match("GET"));

    expect(res.status).toBe(429);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.headers.get("retry-after")).toBe("90");

    const body = (await res.json()) as {
      error: { code: string; requestId: string };
    };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });
});
