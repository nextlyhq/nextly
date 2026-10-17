/**
 * What the auth limiter says about a deployment's proxy settings.
 *
 * At startup, on an edge known to report the client, an unset
 * `security.trustProxy` is named. At request time, the first request that came
 * through a proxy yet still resolved no client address is reported, once per
 * process; a request that resolves, or that carries no proxy header at all,
 * is never reported.
 *
 * "Once per process" is a module-level latch, so each request-time test loads
 * the router and the logger afresh: one test's report must not silence the
 * next test's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthRouterDeps } from "../router";
import { edgeProxyWarning } from "../proxy-posture";

describe("edgeProxyWarning", () => {
  it("names security.trustProxy on Vercel when it is unset", () => {
    const warning = edgeProxyWarning({}, { VERCEL: "1" });
    expect(warning).toContain("Vercel");
    expect(warning).toContain("security.trustProxy: true");
    // Trusting the edge's header is right only when nothing sits in front.
    expect(warning).toContain(
      "If another proxy or CDN sits in front of Vercel"
    );
  });

  it("is silent on Vercel once security.trustProxy is set", () => {
    expect(
      edgeProxyWarning({ security: { trustProxy: true } }, { VERCEL: "1" })
    ).toBeNull();
  });

  it("is silent on Vercel when the auth limiter is off", () => {
    expect(
      edgeProxyWarning(
        { security: { authRateLimit: { requestsPerHour: 0 } } },
        { VERCEL: "1" }
      )
    ).toBeNull();
  });

  it("is silent off a known rewriting edge", () => {
    expect(edgeProxyWarning({}, {})).toBeNull();
    expect(edgeProxyWarning({}, { VERCEL: "0" })).toBeNull();
  });
});

const KIND = "auth-rate-limit-unresolved-client";

interface Loaded {
  warnings: object[];
  post: (headers: Record<string, string>) => Promise<number>;
}

/** The router and logger loaded afresh, with the settings under test. */
async function load(settings: {
  trustProxy: boolean;
  trustedProxyIps?: string[];
  budget?: number;
}): Promise<Loaded> {
  vi.resetModules();
  const warnings: object[] = [];
  const { setNextlyLogger } = await import("../../../observability/logger");
  setNextlyLogger({
    error: () => undefined,
    warn: payload => warnings.push(payload),
    info: () => undefined,
    debug: () => undefined,
  });
  const { routeAuthRequest } = await import("../router");
  const { buildAuthRouterDeps } = await import("../deps-bridge");
  const { MemoryUnknownSourceCounter } = await import(
    "../../middleware/unknown-source-counter"
  );
  const { SlidingWindowMemoryStore } = await import(
    "../../middleware/sliding-window-store"
  );

  // Stand-in services: building the deps asks for an adapter, and nothing
  // here queries it. The limiter decides before any handler would.
  const services: Record<string, unknown> = {
    adapter: { getDrizzle: () => ({}) },
  };
  const deps: AuthRouterDeps = {
    ...buildAuthRouterDeps(name => services[name] ?? {}),
    allowedOrigins: [],
    loginStallTimeMs: 0,
    trustProxy: settings.trustProxy,
    trustedProxyIps: settings.trustedProxyIps ?? [],
    authRateLimit: {
      requestsPerHour: settings.budget ?? 30,
      windowMs: 3_600_000,
      store: new SlidingWindowMemoryStore(),
      unknownSourceCounter: new MemoryUnknownSourceCounter(),
    },
    findUserByEmail: async () => null,
  };

  return {
    warnings,
    post: async headers => {
      const request = new Request(
        "http://localhost:3000/admin/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            ...headers,
          },
          body: JSON.stringify({ email: "a@example.com", password: "pw" }),
        }
      );
      return (await routeAuthRequest(request, "login", deps))?.status ?? 0;
    },
  };
}

const reports = (loaded: Loaded) =>
  loaded.warnings.filter(w => (w as { kind?: string }).kind === KIND);

describe("the request-time fallback warning", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("is logged once per process for proxied requests with security.trustProxy unset", async () => {
    const loaded = await load({ trustProxy: false });
    for (let i = 0; i < 5; i++) {
      await loaded.post({ "x-forwarded-for": `203.0.113.${i}` });
    }
    expect(reports(loaded)).toHaveLength(1);
    expect(JSON.stringify(reports(loaded)[0])).toContain("security.trustProxy");
    expect(JSON.stringify(reports(loaded)[0])).toContain("TRUSTED_PROXY_IPS");
    // The header proves no proxy: the advice says so, and when to leave
    // trustProxy off.
    expect(JSON.stringify(reports(loaded)[0])).toContain(
      "A client can send these headers itself"
    );
    expect(JSON.stringify(reports(loaded)[0])).toContain(
      "Otherwise leave it off"
    );
  });

  it("is logged once when the proxy's own hops are all that the header names", async () => {
    // Every hop is a trusted proxy, so no client address is left to resolve.
    const loaded = await load({
      trustProxy: true,
      trustedProxyIps: ["10.0.0.0/8"],
    });
    for (let i = 0; i < 3; i++) {
      await loaded.post({ "x-forwarded-for": "10.0.0.5, 10.0.0.6" });
    }
    expect(reports(loaded)).toHaveLength(1);
  });

  it("is not logged when the limiter is off", async () => {
    const loaded = await load({ trustProxy: false, budget: 0 });
    for (let i = 0; i < 3; i++) {
      await loaded.post({ "x-forwarded-for": "203.0.113.7" });
    }
    expect(reports(loaded)).toEqual([]);
  });

  it("is not logged for a request whose address resolves", async () => {
    const loaded = await load({ trustProxy: true });
    for (let i = 0; i < 3; i++) {
      await loaded.post({ "x-forwarded-for": "203.0.113.7" });
    }
    expect(reports(loaded)).toEqual([]);
  });

  it("is not logged for a request that carries no proxy header", async () => {
    const loaded = await load({ trustProxy: true });
    for (let i = 0; i < 3; i++) await loaded.post({});
    expect(reports(loaded)).toEqual([]);
  });
});
