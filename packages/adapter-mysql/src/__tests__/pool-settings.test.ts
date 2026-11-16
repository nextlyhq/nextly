/**
 * The pool the adapter builds, on a server and inside a Vercel function: the
 * options it gives mysql2, which idle connections it closes and when, and the
 * pool handed to `@vercel/functions` on Vercel.
 *
 * `mysql2/promise` is mocked so each case reads the exact options the adapter
 * gave `createPool`, and holds the idle connections the case puts in the
 * callback pool's queues. `@vercel/functions/db-connections` is mocked per
 * case, present or failing to load, and the adapter module is loaded afresh
 * after it, as an app's first connect would load it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MySqlAdapterConfig } from "../index";

/** A pooled connection, as far as closing an idle one reads it. */
interface IdleConnection {
  lastActiveTime: number;
  destroy: ReturnType<typeof vi.fn>;
}

/** A mysql2 queue (a Denque) over an array, as far as the pool reads one. */
function queueOf<T>(items: T[]) {
  return {
    items,
    get length() {
      return items.length;
    },
    get: (index: number) => items[index],
  };
}

const state = vi.hoisted(() => {
  const connection = {
    query: vi.fn(),
    release: vi.fn(),
    destroy: vi.fn(),
    connection: { config: {} },
  };
  // The callback pool under the promise wrapper, as mysql2 gives it.
  const corePool: Record<string, unknown> & {
    on: ReturnType<typeof vi.fn>;
  } = {
    _allConnections: { length: 0 },
    _freeConnections: { length: 0 },
    _connectionQueue: { length: 0 },
    _closed: false,
    config: {},
    getConnection: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const pool = {
    getConnection: vi.fn(),
    query: vi.fn(),
    end: vi.fn(async () => {
      corePool._closed = true;
    }),
    pool: corePool,
  };
  const createPool = vi.fn((_options: Record<string, unknown>) => pool);
  return { connection, corePool, pool, createPool };
});

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: state.createPool,
    createConnection: vi.fn(),
  },
  createPool: state.createPool,
  createConnection: vi.fn(),
}));

/** What `createPool` was given by the last connect. */
function lastPoolOptions(): Record<string, unknown> {
  const options = state.createPool.mock.calls.at(-1)?.[0];
  if (!options) throw new Error("the adapter built no pool");
  return options;
}

type VercelModule = { attachDatabasePool: (pool: unknown) => void };

/**
 * The adapter module, loaded after `@vercel/functions/db-connections` is
 * mocked as present with this `attachDatabasePool`, or as failing to load.
 */
async function loadAdapter(vercel: VercelModule | "missing") {
  vi.resetModules();
  vi.doMock("@vercel/functions/db-connections", () => {
    if (vercel === "missing") {
      throw new Error("Cannot find package '@vercel/functions'");
    }
    return vercel;
  });
  return import("../index");
}

async function connected(
  config: MySqlAdapterConfig,
  vercel: VercelModule | "missing" = { attachDatabasePool: vi.fn() }
) {
  const { MySqlAdapter } = await loadAdapter(vercel);
  const adapter = new MySqlAdapter(config);
  await adapter.connect();
  return adapter;
}

const url = "mysql://user:pass@localhost:3306/app";

/**
 * Puts `count` connections in the callback pool, every one idle since now,
 * and `busy` more checked out. Closing an idle one takes it out of both
 * queues, as mysql2's `destroy` does.
 */
function idleConnections(count: number, busy = 0): IdleConnection[] {
  const all: unknown[] = [];
  const free: IdleConnection[] = [];
  for (let at = 0; at < count; at++) {
    const connection: IdleConnection = {
      lastActiveTime: Date.now(),
      destroy: vi.fn(() => {
        free.splice(free.indexOf(connection), 1);
        all.splice(all.indexOf(connection), 1);
      }),
    };
    free.push(connection);
    all.push(connection);
  }
  for (let at = 0; at < busy; at++) all.push({});
  state.corePool._freeConnections = queueOf(free);
  state.corePool._allConnections = queueOf(all);
  return free.slice();
}

/** How many of `connections` have been closed. */
const closed = (connections: IdleConnection[]) =>
  connections.filter(connection => connection.destroy.mock.calls.length > 0)
    .length;

beforeEach(() => {
  state.createPool.mockClear();
  state.corePool.on.mockReset();
  state.corePool._closed = false;
  state.corePool._allConnections = { length: 0 };
  state.corePool._freeConnections = { length: 0 };
  state.pool.getConnection.mockReset();
  state.pool.getConnection.mockResolvedValue(state.connection);
  state.pool.end.mockClear();
  state.connection.query.mockReset();
  // The smoke test, then the version check.
  state.connection.query.mockImplementation((sql: string) =>
    Promise.resolve(
      typeof sql === "string" && sql.toLowerCase().includes("version()")
        ? [[{ version: "8.0.36" }], []]
        : [[], []]
    )
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock("@vercel/functions/db-connections");
});

describe("MySQL pool outside Vercel", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "");
  });

  it("keeps the standard pool and attaches nothing", async () => {
    const attachDatabasePool = vi.fn();

    await connected({ url }, { attachDatabasePool });

    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 10,
      idleTimeout: 30000,
      // mysql2 never closes an idle connection by itself: the adapter does,
      // and keeps `min` of them.
      maxIdle: 10,
    });
    expect(attachDatabasePool).not.toHaveBeenCalled();
  });

  it("closes every connection idle past 30 s when nothing is set", async () => {
    vi.useFakeTimers();
    const idle = idleConnections(3);

    await connected({ url });

    await vi.advanceTimersByTimeAsync(29_000);
    expect(closed(idle)).toBe(0);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(closed(idle)).toBe(3);
  });

  it("closes idle connections above min after the idle timeout, and keeps min", async () => {
    vi.useFakeTimers();
    const idle = idleConnections(3);

    await connected({ url, pool: { min: 1, idleTimeoutMs: 2000 } });

    // Not before the timeout: a connection above min is kept as long as it.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(closed(idle)).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(closed(idle)).toBe(2);
    // The least recently used go first; the one kept is the newest.
    expect(idle[2]?.destroy).not.toHaveBeenCalled();
    // min is kept however long it stays idle.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(closed(idle)).toBe(2);
  });

  it("counts connections in use toward min, and never closes them", async () => {
    vi.useFakeTimers();
    // Two checked out, two idle: min 3 leaves one idle connection to close.
    const idle = idleConnections(2, 2);

    await connected({ url, pool: { min: 3, idleTimeoutMs: 1000 } });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(closed(idle)).toBe(1);
  });

  it("takes the DB_POOL_* settings as the factory hands them over, set or unset", async () => {
    // Unset, the factory hands every field over as undefined.
    await connected({
      url,
      pool: { max: undefined, min: undefined, idleTimeoutMs: undefined },
    });
    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 10,
      idleTimeout: 30000,
      maxIdle: 10,
    });

    // DB_POOL_MAX=17, DB_POOL_MIN=3, DB_POOL_IDLE_TIMEOUT=12345.
    vi.useFakeTimers();
    const idle = idleConnections(5);
    await connected({
      url,
      pool: { max: 17, min: 3, idleTimeoutMs: 12345 },
    });
    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 17,
      idleTimeout: 12345,
      maxIdle: 17,
    });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(closed(idle)).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(closed(idle)).toBe(2);
  });

  it("keeps idle connections open with an idle timeout of 0, as pg-pool does", async () => {
    vi.useFakeTimers();
    const idle = idleConnections(3);

    await connected({ url, pool: { idleTimeoutMs: 0 } });

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(closed(idle)).toBe(0);
  });

  it("stops closing connections once the adapter disconnects", async () => {
    vi.useFakeTimers();
    const idle = idleConnections(2);
    const adapter = await connected({ url, pool: { idleTimeoutMs: 1000 } });

    await adapter.disconnect();
    // The pool's own end closes what it holds; the sweep must not race it.
    state.corePool._closed = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(closed(idle)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("MySQL pool on Vercel", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
  });

  it("defaults to three connections, idle ones closed after 5 s", async () => {
    vi.useFakeTimers();
    const idle = idleConnections(3);

    await connected({ url });

    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 3,
      idleTimeout: 5000,
      maxIdle: 3,
    });
    // None kept open: min is 0 on Vercel.
    await vi.advanceTimersByTimeAsync(4_500);
    expect(closed(idle)).toBe(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(closed(idle)).toBe(3);
  });

  it("keeps the min an app gives on Vercel too", async () => {
    vi.useFakeTimers();
    const idle = idleConnections(3);

    await connected({ url, pool: { min: 1 } });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(closed(idle)).toBe(2);
  });

  it("lets each pool setting the app gives replace only its own field", async () => {
    await connected({ url, pool: { max: 8 } });
    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 8,
      idleTimeout: 5000,
      maxIdle: 8,
    });

    await connected({ url, pool: { idleTimeoutMs: 15000 } });
    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 3,
      idleTimeout: 15000,
      maxIdle: 3,
    });
  });

  it("attaches the pool before the smoke test, telling it how long idle connections live", async () => {
    const attachDatabasePool = vi.fn();

    await connected({ url }, { attachDatabasePool });

    expect(attachDatabasePool).toHaveBeenCalledTimes(1);
    const attached = attachDatabasePool.mock.calls[0]?.[0] as {
      config: { idleTimeout: number };
      on: (event: string, listener: () => void) => void;
    };
    // The idle timeout, and the second the adapter's idle sweep can take to
    // notice a connection past it.
    expect(attached.config.idleTimeout).toBe(6000);
    // Its release events are the callback pool's, where mysql2 emits them.
    const listener = () => {};
    attached.on("release", listener);
    expect(state.corePool.on).toHaveBeenCalledWith("release", listener);

    const attachedAt = attachDatabasePool.mock.invocationCallOrder[0] ?? 0;
    const smokeTestAt =
      state.pool.getConnection.mock.invocationCallOrder[0] ?? 0;
    expect(attachedAt).toBeGreaterThan(0);
    expect(attachedAt).toBeLessThan(smokeTestAt);
  });

  it("connects and warns once when @vercel/functions is not installed", async () => {
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };

    // A UTC driver zone, so the adapter's own zone warning stays silent.
    const adapter = await connected({ url, logger, timezone: "Z" }, "missing");

    expect(adapter.isConnected()).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("@vercel/functions");
  });
});
