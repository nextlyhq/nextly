/**
 * The pool the adapter builds inside a Vercel function, and the pool handed to
 * `@vercel/functions` there.
 *
 * `pg` is replaced by a recording class so each case reads the exact options
 * the adapter gave `new Pool(...)`. `@vercel/functions/db-connections` is
 * mocked per case, present or failing to load, and the adapter module is
 * loaded afresh after it, as an app's first connect would load it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PostgresAdapterConfig } from "../index";

const state = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pools: Array<{ config: Record<string, unknown> }> = [];
  const connect = vi.fn();
  return { client, pools, connect };
});

vi.mock("pg", () => ({
  Pool: class RecordingPool {
    connect = state.connect;
    query = vi.fn();
    end = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
    constructor(public config: Record<string, unknown>) {
      state.pools.push(this);
    }
  },
}));

/** What `new Pool(...)` was given by the last connect. */
function lastPoolConfig(): Record<string, unknown> {
  const pool = state.pools.at(-1);
  if (!pool) throw new Error("the adapter built no pool");
  return pool.config;
}

/**
 * The adapter module, loaded after `@vercel/functions/db-connections` is
 * mocked as present with this `attachDatabasePool`, or as failing to load.
 */
async function loadAdapter(
  vercel: { attachDatabasePool: (pool: unknown) => void } | "missing"
) {
  vi.resetModules();
  vi.doMock("@vercel/functions/db-connections", () => {
    if (vercel === "missing") {
      throw new Error("Cannot find package '@vercel/functions'");
    }
    return vercel;
  });
  return import("../index");
}

function recordingLogger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
}

const standardUrl = "postgres://user:pass@localhost:5432/app";

beforeEach(() => {
  state.pools.length = 0;
  state.connect.mockReset();
  state.connect.mockResolvedValue(state.client);
  state.client.release.mockReset();
  state.client.query.mockReset();
  // The smoke test, then the version check.
  state.client.query.mockImplementation((sql: string) =>
    Promise.resolve(
      sql.toLowerCase().includes("version()")
        ? { rows: [{ version: "PostgreSQL 17.2 on x86_64-pc-linux-gnu" }] }
        : { rows: [{ result: 1 }] }
    )
  );
  vi.stubEnv("DB_PROVIDER", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@vercel/functions/db-connections");
});

async function connected(
  config: PostgresAdapterConfig,
  vercel: { attachDatabasePool: (pool: unknown) => void } | "missing" = {
    attachDatabasePool: vi.fn(),
  }
) {
  const { PostgresAdapter } = await loadAdapter(vercel);
  const adapter = new PostgresAdapter(config);
  await adapter.connect();
  return adapter;
}

describe("PostgreSQL pool outside Vercel", () => {
  it("keeps the standard pool and attaches nothing", async () => {
    vi.stubEnv("VERCEL", "");
    const attachDatabasePool = vi.fn();

    await connected({ url: standardUrl }, { attachDatabasePool });

    expect(lastPoolConfig()).toMatchObject({
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    });
    expect(attachDatabasePool).not.toHaveBeenCalled();
  });
});

describe("PostgreSQL pool on Vercel", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
  });

  it("defaults to three connections, none kept open, idle ones closed after 5 s", async () => {
    await connected({ url: standardUrl });

    expect(lastPoolConfig()).toMatchObject({
      max: 3,
      min: 0,
      idleTimeoutMillis: 5000,
    });
  });

  it("lets each pool setting the app gives replace only its own field", async () => {
    await connected({ url: standardUrl, pool: { max: 8 } });
    expect(lastPoolConfig()).toMatchObject({
      max: 8,
      min: 0,
      idleTimeoutMillis: 5000,
    });

    await connected({ url: standardUrl, pool: { idleTimeoutMs: 15000 } });
    expect(lastPoolConfig()).toMatchObject({
      max: 3,
      min: 0,
      idleTimeoutMillis: 15000,
    });

    await connected({ url: standardUrl, pool: { min: 1 } });
    expect(lastPoolConfig()).toMatchObject({
      max: 3,
      min: 1,
      idleTimeoutMillis: 5000,
    });
  });

  it("gives a Neon database the Vercel pool and keeps Neon's other settings", async () => {
    await connected({
      url: "postgres://user:pass@ep-quiet-sky-123.us-east-2.aws.neon.tech/app",
    });

    expect(lastPoolConfig()).toMatchObject({
      max: 3,
      min: 0,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 20000,
      statement_timeout: 30000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it("gives a Supabase database the Vercel pool and keeps Supabase's other settings", async () => {
    await connected({
      url: "postgres://postgres.ref:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    });

    expect(lastPoolConfig()).toMatchObject({
      max: 3,
      min: 0,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 15000,
      statement_timeout: 15000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it("attaches the pool it built, before the smoke test takes a connection", async () => {
    const attachDatabasePool = vi.fn();

    await connected({ url: standardUrl }, { attachDatabasePool });

    expect(attachDatabasePool).toHaveBeenCalledTimes(1);
    expect(attachDatabasePool.mock.calls[0]?.[0]).toBe(state.pools.at(-1));
    const attachedAt = attachDatabasePool.mock.invocationCallOrder[0] ?? 0;
    const smokeTestAt = state.connect.mock.invocationCallOrder[0] ?? 0;
    expect(attachedAt).toBeGreaterThan(0);
    expect(attachedAt).toBeLessThan(smokeTestAt);
  });

  it("connects and warns once when @vercel/functions is not installed", async () => {
    const logger = recordingLogger();

    const adapter = await connected({ url: standardUrl, logger }, "missing");

    expect(adapter.isConnected()).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("@vercel/functions");
  });
});

describe("PostgreSQL connection-limit errors", () => {
  it("reports too_many_connections (53300) as a connection error and does not retry it", async () => {
    vi.stubEnv("VERCEL", "");
    const tooMany = Object.assign(
      new Error("sorry, too many clients already"),
      { code: "53300", severity: "FATAL" }
    );
    state.connect.mockRejectedValue(tooMany);
    const { PostgresAdapter } = await loadAdapter({
      attachDatabasePool: vi.fn(),
    });

    const adapter = new PostgresAdapter({ url: standardUrl });

    await expect(adapter.connect()).rejects.toMatchObject({
      kind: "connection",
      code: "53300",
    });
    expect(state.pools).toHaveLength(1);
  });

  it("reports idle_session_timeout (57P05) as a connection error", async () => {
    vi.stubEnv("VERCEL", "");
    const adapter = await connected({ url: standardUrl });
    const pool = state.pools.at(-1) as unknown as {
      query: ReturnType<typeof vi.fn>;
    };
    pool.query.mockRejectedValueOnce(
      Object.assign(
        new Error("terminating connection due to idle-session timeout"),
        { code: "57P05", severity: "FATAL" }
      )
    );

    await expect(adapter.executeQuery("SELECT 1")).rejects.toMatchObject({
      kind: "connection",
      code: "57P05",
    });
  });
});
