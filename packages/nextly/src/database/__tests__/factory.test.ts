import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("createAdapter — env-driven pool config", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    // Wipe any stray DB_POOL_* values from the host env that the env.ts
    // zod schema would otherwise pick up. The zod schema applies defaults
    // when keys are absent, so deleting is the right way to test "user
    // hasn't set them".
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_POOL_MIN;
    delete process.env.DB_POOL_IDLE_TIMEOUT;
    delete process.env.DB_QUERY_TIMEOUT;
    delete process.env.DB_DIALECT;
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("forwards DB_POOL_MAX/DB_POOL_MIN/DB_POOL_IDLE_TIMEOUT/DB_QUERY_TIMEOUT to adapter config", async () => {
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    process.env.DB_POOL_MAX = "17";
    process.env.DB_POOL_MIN = "3";
    process.env.DB_POOL_IDLE_TIMEOUT = "12345";
    process.env.DB_QUERY_TIMEOUT = "6789";

    const createPostgresAdapter = vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
    });
    vi.doMock("@nextlyhq/adapter-postgres", () => ({ createPostgresAdapter }));

    const { createAdapterFromEnv } = await import("../factory");
    await createAdapterFromEnv();

    expect(createPostgresAdapter).toHaveBeenCalledTimes(1);
    const cfg = createPostgresAdapter.mock.calls[0][0];
    expect(cfg.pool).toMatchObject({
      max: 17,
      min: 3,
      idleTimeoutMs: 12345,
    });
    expect(cfg.queryTimeout).toBe(6789);
  });

  it("explicit config.pool overrides env vars", async () => {
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    process.env.DB_POOL_MAX = "17";

    const createPostgresAdapter = vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
    });
    vi.doMock("@nextlyhq/adapter-postgres", () => ({ createPostgresAdapter }));

    const { createAdapter } = await import("../factory");
    await createAdapter({ type: "postgresql", pool: { max: 99 } });
    expect(createPostgresAdapter.mock.calls[0][0].pool.max).toBe(99);
  });

  it("falls through to undefined when env vars are unset, letting adapter defaults apply", async () => {
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    // No DB_POOL_* env vars set — they're optional schemas now.

    const createPostgresAdapter = vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
    });
    vi.doMock("@nextlyhq/adapter-postgres", () => ({ createPostgresAdapter }));

    const { createAdapterFromEnv } = await import("../factory");
    await createAdapterFromEnv();

    expect(createPostgresAdapter).toHaveBeenCalledTimes(1);
    const cfg = createPostgresAdapter.mock.calls[0][0];
    // The factory should pass `pool: { max: undefined, min: undefined, idleTimeoutMs: undefined }`
    // so the Postgres adapter's `??` cascade falls through to its own
    // provider defaults (min: 0 for Neon cold-start, etc.).
    expect(cfg.pool.max).toBeUndefined();
    expect(cfg.pool.min).toBeUndefined();
    expect(cfg.pool.idleTimeoutMs).toBeUndefined();
    expect(cfg.queryTimeout).toBeUndefined();
  });

  it("preserves caller-supplied pool fields not covered by env vars (e.g. connectionTimeoutMs)", async () => {
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";

    const createPostgresAdapter = vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
    });
    vi.doMock("@nextlyhq/adapter-postgres", () => ({ createPostgresAdapter }));

    const { createAdapter } = await import("../factory");
    await createAdapter({
      type: "postgresql",
      pool: { connectionTimeoutMs: 12345 },
    });

    expect(createPostgresAdapter).toHaveBeenCalledTimes(1);
    expect(
      createPostgresAdapter.mock.calls[0][0].pool.connectionTimeoutMs
    ).toBe(12345);
  });
});
