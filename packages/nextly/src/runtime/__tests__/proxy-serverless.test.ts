/**
 * The Proxy in a serverless function of its own: the pool it starts Nextly
 * with, and closing that pool's connections before the function is
 * suspended.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type { PluginContext } from "../../plugins/plugin-context";
import {
  clearProxyHandlers,
  markProxyHandlersReady,
  registerProxyHandler,
} from "../../plugins/proxy/proxy-registry";

const getNextly = vi.fn();
vi.mock("../../init", () => ({ getNextly }));

const { createNextlyProxy, PROXY_DATABASE_POOL } = await import("../proxy");
type Deps = import("../proxy").NextlyProxyDeps;

const config = {} as SanitizedNextlyConfig;
const ctx = { logger: { error: vi.fn() } } as unknown as PluginContext;

/** A started instance whose pool holds `pool.total` connections. */
function instanceWith(pool: { total: number }) {
  return {
    adapter: {
      getPoolStats: () => ({
        total: pool.total,
        idle: pool.total,
        waiting: 0,
        active: 0,
      }),
    },
  };
}

/** A start that registers a handler reading the database, and is ready. */
function startingWith(instance: unknown) {
  return vi.fn(async () => {
    registerProxyHandler(
      {
        pluginName: "p",
        handler: { name: "h", handle: () => ({ headers: { "x-a": "1" } }) },
      },
      ctx
    );
    markProxyHandlersReady();
    return instance;
  });
}

/** A turn of the event loop, so a wait can look again. */
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Whether `promise` has settled after a few turns of the event loop. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  for (let turn = 0; turn < 5; turn++) await tick();
  return done;
}

const request = () => new Request("https://example.com/blog/hello");

beforeEach(() => {
  getNextly.mockReset();
});

afterEach(() => {
  clearProxyHandlers();
  vi.unstubAllEnvs();
});

describe("the Proxy in a serverless function", () => {
  it("starts Nextly with one connection on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    getNextly.mockResolvedValue({});

    await createNextlyProxy(config)(request());

    // The start is begun, not waited for: it loads the start-up graph first.
    await vi.waitFor(() => expect(getNextly).toHaveBeenCalled());
    expect(getNextly).toHaveBeenCalledWith({
      config,
      databasePool: PROXY_DATABASE_POOL,
    });
    expect(PROXY_DATABASE_POOL.max).toBe(1);
  });

  it("starts Nextly with the app's own pool anywhere else", async () => {
    vi.stubEnv("VERCEL", "");
    getNextly.mockResolvedValue({});

    await createNextlyProxy(config)(request());

    await vi.waitFor(() => expect(getNextly).toHaveBeenCalled());
    expect(getNextly).toHaveBeenCalledWith({ config });
  });

  it("keeps the function running after an answer until its connections have closed", async () => {
    const pool = { total: 1 };
    const deps: Deps = {
      next: () => () => new Response(null),
      start: startingWith(instanceWith(pool)),
      serverless: () => true,
      sleep: tick,
    };
    const proxy = createNextlyProxy(config, deps);
    // The first request begins the start; the second is answered by the
    // handlers it registered.
    await proxy(request(), { waitUntil: vi.fn() });
    const waitUntil = vi.fn();

    await proxy(request(), { waitUntil });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    const kept = waitUntil.mock.calls[0]?.[0] as Promise<unknown>;
    // Still open: the function is not let go.
    expect(await settled(kept)).toBe(false);
    pool.total = 0;
    // Closed by the pool's idle timeout: it is.
    expect(await settled(kept)).toBe(true);
  });

  it("keeps the start running until the connections it opened have closed", async () => {
    const pool = { total: 1 };
    const deps: Deps = {
      next: () => () => new Response(null),
      start: startingWith(instanceWith(pool)),
      serverless: () => true,
      sleep: tick,
    };
    const waitUntil = vi.fn();

    await createNextlyProxy(config, deps)(request(), { waitUntil });

    const kept = waitUntil.mock.calls[0]?.[0] as Promise<unknown>;
    expect(await settled(kept)).toBe(false);
    pool.total = 0;
    expect(await settled(kept)).toBe(true);
  });

  it("keeps nothing running for its connections outside a serverless function", async () => {
    const deps: Deps = {
      next: () => () => new Response(null),
      start: startingWith(instanceWith({ total: 1 })),
      serverless: () => false,
      sleep: tick,
    };
    const proxy = createNextlyProxy(config, deps);
    await proxy(request(), { waitUntil: vi.fn() });
    const waitUntil = vi.fn();

    await proxy(request(), { waitUntil });

    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("keeps nothing running where the pool holds no connection", async () => {
    const deps: Deps = {
      next: () => () => new Response(null),
      start: startingWith(instanceWith({ total: 0 })),
      serverless: () => true,
      sleep: tick,
    };
    const proxy = createNextlyProxy(config, deps);
    await proxy(request(), { waitUntil: vi.fn() });
    const waitUntil = vi.fn();

    await proxy(request(), { waitUntil });

    expect(waitUntil).not.toHaveBeenCalled();
  });
});
