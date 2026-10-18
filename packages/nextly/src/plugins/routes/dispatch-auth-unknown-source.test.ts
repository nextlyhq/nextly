/**
 * A plugin's `rateLimit: "auth"` route, for clients whose address cannot be
 * resolved, driven through the dispatcher with real counters.
 *
 * Keyed on the address, every such client shared one bucket per route, so
 * one visitor spending the auth budget closed the route to everyone. Now each
 * request counts against the identity the route's `limitKey` names, under a
 * ceiling of a hundred times the budget that the plugin's auth routes share
 * and nothing else spends. Only the limiter answers 429 here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

const limits = vi.hoisted(() => ({
  value: {
    requestsPerHour: 1,
    windowMs: 3_600_000,
    store: undefined as unknown,
  },
}));
vi.mock("../../auth/handlers/deps-bridge", () => ({
  readAuthRateLimit: () => limits.value,
}));
vi.mock("../../di/register", () => ({ getService: () => ({}) }));
vi.mock("../../utils/proxy-trust", () => ({
  readProxyTrustSettings: () => ({ trustProxy: false, trustedProxyIps: [] }),
}));
const clientIp = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("../../utils/get-trusted-client-ip", async original => ({
  ...(await original<typeof import("../../utils/get-trusted-client-ip")>()),
  getTrustedClientIp: () => clientIp.value,
}));
vi.mock("../../lib/env", () => ({
  env: { NEXTLY_SECRET: "test-secret-that-is-at-least-32-characters-long!" },
}));
const warn = vi.hoisted(() => vi.fn());
vi.mock("../../observability/logger", () => ({
  getNextlyLogger: () => ({ warn, info: vi.fn(), error: vi.fn() }),
}));

import type { PluginContext } from "../plugin-context";

import { authRateLimiter } from "../../auth/middleware/rate-limiter";
import { SlidingWindowMemoryStore } from "../../auth/middleware/sliding-window-store";
import {
  memoryUnknownSourceCounter,
  StoreUnknownSourceCounter,
  type UnknownSourceCounter,
} from "../../auth/middleware/unknown-source-counter";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute, PluginRouteLimitKey } from "./route-types";

const W = 3_600_000;
/** The ceiling at a budget of one: a hundred admissions per plugin. */
const CEILING = 100;

/** A plugin name of its own per test: the memory counters live per process. */
let plugins = 0;
function pluginName(): string {
  plugins += 1;
  return `@a/p${plugins}`;
}

const byEmail: PluginRouteLimitKey = ({ body }) =>
  typeof body.email === "string"
    ? { handles: true, key: body.email }
    : { handles: false };

function match(
  plugin: string,
  over: Partial<PluginRoute> = {},
  path = "/sign-in"
): RouteMatch {
  return {
    pluginName: plugin,
    route: {
      method: "POST",
      path,
      public: true,
      rateLimit: "auth",
      handler: async (request: Request) =>
        Response.json({ echoed: await request.json() }),
      ...over,
    } as PluginRoute,
    baseCtx: {
      self: { name: plugin, collections: {}, singles: {} },
      logger: { info() {}, warn() {}, error() {} },
    } as unknown as PluginContext,
    params: {},
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/admin/api/plugins/x/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function status(m: RouteMatch, body: unknown): Promise<number> {
  return (await runPluginRoute(post(body), m)).status;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 0, 1));
  clientIp.value = null;
  limits.value = { requestsPerHour: 1, windowMs: W, store: undefined };
  warn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ["the process's own counters", () => undefined],
  ["an app's store", () => new SlidingWindowMemoryStore()],
])("an unresolved client on a plugin auth route, over %s", (_, makeStore) => {
  beforeEach(() => {
    limits.value = { ...limits.value, store: makeStore() };
  });

  /** Core's sign-in counter, over the same store the plugin routes use. */
  function coreCounter(): UnknownSourceCounter {
    const store = limits.value.store as SlidingWindowMemoryStore | undefined;
    return store === undefined
      ? memoryUnknownSourceCounter
      : new StoreUnknownSourceCounter(authRateLimiter(store));
  }

  it("refuses one identity past its budget and still admits another", async () => {
    const m = match(pluginName(), { limitKey: byEmail });

    expect(await status(m, { email: "a@example.com" })).toBe(200);
    expect(await status(m, { email: "a@example.com" })).toBe(429);
    expect(await status(m, { email: "b@example.com" })).toBe(200);
  });

  it("counts an identity across the plugin's auth routes", async () => {
    const plugin = pluginName();
    const start = match(plugin, { limitKey: byEmail }, "/start");
    const finish = match(plugin, { limitKey: byEmail }, "/finish");

    expect(await status(start, { email: "a@example.com" })).toBe(200);
    expect(await status(finish, { email: "a@example.com" })).toBe(429);
  });

  it("gives the same identity a budget of its own in each plugin", async () => {
    const one = match(pluginName(), { limitKey: byEmail });
    const two = match(pluginName(), { limitKey: byEmail });

    expect(await status(one, { email: "a@example.com" })).toBe(200);
    expect(await status(two, { email: "a@example.com" })).toBe(200);
  });

  it.each([
    ["does not handle it", byEmail],
    [
      "throws",
      (({ body }) => {
        if (typeof body.email !== "string") throw new Error("no email");
        return { handles: true, key: body.email };
      }) satisfies PluginRouteLimitKey,
    ],
    [
      "answers no key",
      (({ body }) => ({
        handles: true,
        key: typeof body.email === "string" ? body.email : null,
      })) satisfies PluginRouteLimitKey,
    ],
  ])(
    "counts a request whose limitKey %s apart from every identity",
    async (_, limitKey) => {
      const m = match(pluginName(), { limitKey });

      expect(await status(m, {})).toBe(200);
      expect(await status(m, {})).toBe(429);
      expect(await status(m, { email: "a@example.com" })).toBe(200);
    }
  );

  it("refuses a flood of invented identities at the plugin's ceiling", async () => {
    const m = match(pluginName(), { limitKey: byEmail });

    for (let i = 0; i < CEILING; i++) {
      expect(await status(m, { email: `u${i}@example.com` })).toBe(200);
    }
    expect(await status(m, { email: "fresh@example.com" })).toBe(429);
  });

  it("admits a route without a limitKey up to the plugin's ceiling, and only that plugin's routes are refused past it", async () => {
    const plugin = pluginName();
    const unkeyed = match(plugin);
    const second = match(plugin, { limitKey: byEmail }, "/finish");
    const other = match(pluginName());

    // At a budget of one, the old shared bucket refused the second request.
    for (let i = 0; i < CEILING; i++) {
      expect(await status(unkeyed, { email: "a@example.com" })).toBe(200);
    }
    expect(await status(unkeyed, { email: "a@example.com" })).toBe(429);
    expect(await status(second, { email: "b@example.com" })).toBe(429);

    // Another plugin's auth route, and core's sign-in, keep their own ceilings.
    expect(await status(other, {})).toBe(200);
    expect(
      await coreCounter().admit("auth-unknown:no-account", {
        budget: 1,
        ceiling: 1,
        windowMs: W,
      })
    ).toEqual({ allowed: true });
  });
});

describe("what the limiter leaves of the request", () => {
  it("hands the handler the whole body and the route only a copy", async () => {
    const seen: unknown[] = [];
    const m = match(pluginName(), {
      limitKey: ({ request, body }) => {
        seen.push(body, request.headers.get("cookie"));
        return { handles: true, key: "k" };
      },
    });

    const res = await runPluginRoute(
      post(
        { email: "a@example.com", code: "123" },
        { cookie: "nextly_refresh=secret; other=1" }
      ),
      m
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      echoed: { email: "a@example.com", code: "123" },
    });
    expect(seen[0]).toEqual({ email: "a@example.com", code: "123" });
    expect(String(seen[1])).not.toContain("nextly_refresh");
  });
});

describe("when the client address resolves", () => {
  it("keeps the per-address bucket", async () => {
    clientIp.value = "1.2.3.4";
    const m = match(pluginName(), { limitKey: byEmail });

    expect(await status(m, { email: "a@example.com" })).toBe(200);
    expect(await status(m, { email: "b@example.com" })).toBe(429);
  });
});

describe("the warning that proxy headers could not be used", () => {
  /**
   * A fresh dispatcher each time: the warning is logged once per process, so
   * each case needs a process of its own.
   */
  async function freshDispatch(): Promise<typeof runPluginRoute> {
    vi.resetModules();
    return (await import("./dispatch")).runPluginRoute;
  }

  const proxied = () =>
    post({ email: "a@example.com" }, { "x-forwarded-for": "203.0.113.9" });

  function warned(): number {
    return warn.mock.calls.filter(
      ([entry]) =>
        (entry as { kind?: string }).kind ===
        "auth-rate-limit-unresolved-client"
    ).length;
  }

  it("is logged once for a plugin auth route", async () => {
    const run = await freshDispatch();
    const m = match(pluginName(), { limitKey: byEmail });

    await run(proxied(), m);
    await run(proxied(), m);

    expect(warned()).toBe(1);
  });

  it("is not logged when the address resolves", async () => {
    clientIp.value = "203.0.113.9";
    const run = await freshDispatch();

    await run(proxied(), match(pluginName(), { limitKey: byEmail }));

    expect(warned()).toBe(0);
  });

  it("is not logged with an auth budget of zero, which counts nothing", async () => {
    limits.value = { ...limits.value, requestsPerHour: 0 };
    const run = await freshDispatch();
    const m = match(pluginName(), { limitKey: byEmail });

    for (let i = 0; i < 3; i++) {
      expect((await run(proxied(), m)).status).toBe(200);
    }
    expect(warned()).toBe(0);
  });
});
