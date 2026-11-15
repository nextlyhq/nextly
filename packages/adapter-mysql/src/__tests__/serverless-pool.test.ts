/**
 * The pool the adapter builds inside a Vercel function, and the pool handed to
 * `@vercel/functions` there.
 *
 * `mysql2/promise` is mocked so each case reads the exact options the adapter
 * gave `createPool`. `@vercel/functions/db-connections` is mocked per case,
 * present or failing to load, and the adapter module is loaded afresh after
 * it, as an app's first connect would load it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MySqlAdapterConfig } from "../index";

const state = vi.hoisted(() => {
  const connection = {
    query: vi.fn(),
    release: vi.fn(),
    destroy: vi.fn(),
    connection: { config: {} },
  };
  // The callback pool under the promise wrapper, as mysql2 gives it.
  const corePool = {
    _allConnections: { length: 0 },
    _freeConnections: { length: 0 },
    _connectionQueue: { length: 0 },
    config: {},
    getConnection: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const pool = {
    getConnection: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
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

beforeEach(() => {
  state.createPool.mockClear();
  state.corePool.on.mockReset();
  state.pool.getConnection.mockReset();
  state.pool.getConnection.mockResolvedValue(state.connection);
  state.pool.end.mockResolvedValue(undefined);
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
  vi.unstubAllEnvs();
  vi.doUnmock("@vercel/functions/db-connections");
});

describe("MySQL pool outside Vercel", () => {
  it("keeps the standard pool and attaches nothing", async () => {
    vi.stubEnv("VERCEL", "");
    const attachDatabasePool = vi.fn();

    await connected({ url }, { attachDatabasePool });

    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 10,
      idleTimeout: 30000,
    });
    expect(lastPoolOptions()).not.toHaveProperty("maxIdle");
    expect(attachDatabasePool).not.toHaveBeenCalled();
  });
});

describe("MySQL pool on Vercel", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
  });

  it("defaults to three connections, idle ones closed after 5 s", async () => {
    await connected({ url });

    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 3,
      idleTimeout: 5000,
      // mysql2 closes idle connections only while `maxIdle` is below
      // `connectionLimit`; at its default, equal to the limit, it never does.
      maxIdle: 2,
    });
  });

  it("lets each pool setting the app gives replace only its own field", async () => {
    await connected({ url, pool: { max: 8 } });
    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 8,
      idleTimeout: 5000,
      maxIdle: 7,
    });

    await connected({ url, pool: { idleTimeoutMs: 15000 } });
    expect(lastPoolOptions()).toMatchObject({
      connectionLimit: 3,
      idleTimeout: 15000,
      maxIdle: 2,
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
    // The idle timeout, and the second mysql2's idle sweep can take to
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
