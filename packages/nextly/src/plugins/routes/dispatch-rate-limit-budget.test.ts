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
import { z } from "zod";

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

import { RATE_LIMIT_DEFAULTS } from "../../middleware/rate-limit";

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

describe("a plugin CSRF refusal answers through the canonical boundary", () => {
  it("carries the request id and the envelope", async () => {
    // Same reasoning as the rate-limit refusal: this is one of the errors no
    // later wrapper decorates, so a hand-built body was the one 403 a client
    // could not correlate.
    const res = await runPluginRoute(
      new Request("http://localhost/admin/api/plugins/@a/x/r", {
        method: "POST",
        // A cookie caller with no CSRF token: `csrf: true` + POST + cookie.
        headers: { cookie: "nextly_csrf=absent" },
      }),
      matchWithCsrf()
    );

    expect(res.status).toBe(403);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = (await res.json()) as {
      error: { code: string; requestId: string };
    };
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });
});

/** A cookie-caller POST route that declares CSRF, so the check runs. */
function matchWithCsrf(): RouteMatch {
  return {
    pluginName: "@a/x",
    route: {
      method: "POST",
      path: "/r",
      public: true,
      csrf: true,
      handler: () => Response.json({ ok: true }),
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

describe("a rate-limit refusal on an auth route", () => {
  it("carries no-store, like the route's other responses", async () => {
    // The refusal returns BEFORE the wrapper that stamps no-store on handler
    // responses, and a public route gets no session-cache headers either — so
    // without this, a shared proxy could cache the 429 and replay it to
    // later callers the limiter had not refused.
    check.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 60_000),
    });
    config.value = {};

    const res = await runPluginRoute(
      new Request("http://localhost/admin/api/plugins/@a/x/r"),
      matchAuth()
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the limiter's own defaults when no limits are configured", async () => {
    // A config with no limits runs core's REST surface on the limiter's
    // defaults; a plugin route beside it must answer to the same numbers,
    // not to a second set spelled here.
    config.value = { rateLimit: { enabled: true } };

    await runPluginRoute(
      new Request("http://localhost/admin/api/plugins/@a/x/r"),
      match("GET")
    );
    await runPluginRoute(
      new Request("http://localhost/admin/api/plugins/@a/x/r", {
        method: "POST",
      }),
      match("POST")
    );

    const limits = check.mock.calls.map(call => call[1]);
    expect(limits).toContain(RATE_LIMIT_DEFAULTS.readLimit);
    expect(limits).toContain(RATE_LIMIT_DEFAULTS.writeLimit);
  });
});

/** An auth-limited route, whose refusals and responses are never cacheable. */
function matchAuth(): RouteMatch {
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

describe("a settings update over REST", () => {
  it("answers with the canonical mutation envelope and the redacted item", async () => {
    // The PATCH is a resource update: the repository's mutation contract
    // is { message, item }, and a bare message left every client processing
    // updates the same way with nothing to read.
    const rows: Array<Record<string, unknown>> = [];
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(rows.map(r => ({ ...r }))),
        }),
      }),
      insert: () => ({
        values: (v: unknown) => ({
          onConflictDoUpdate: async () => {
            rows.length = 0;
            rows.push(v as Record<string, unknown>);
          },
        }),
      }),
      delete: () => ({ where: async () => undefined }),
    };
    const container = {
      adapter: {
        getDrizzle: () => fakeDb,
        dialect: "sqlite",
        transaction: async <T>(work: () => Promise<T>) => work(),
      },
    } as never;
    const config = {
      plugins: [
        {
          name: "acme-auth",
          contributes: {
            settings: z.object({ since: z.string().default("") }),
          },
        },
      ],
    } as never;
    const { dispatchPluginSettings } = await import(
      "../../dispatcher/handlers/plugin-settings-dispatcher"
    );
    const response = (await dispatchPluginSettings(
      container,
      config,
      "updatePluginSettings",
      { plugin: "acme-auth" },
      { since: "x" }
    )) as Response;

    const body = (await response.json()) as { message: string; item: unknown };
    expect(body.message).toBe("Settings updated.");
    expect(body.item).toEqual({ since: "x" });
  });
});
