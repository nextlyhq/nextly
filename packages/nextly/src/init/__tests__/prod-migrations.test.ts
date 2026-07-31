import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runProdMigrationsIfEnabled } from "../prod-migrations";

const ORIG = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = "production";
});
afterEach(() => {
  process.env.NODE_ENV = ORIG;
});

function args(over: Record<string, unknown> = {}) {
  return {
    config: {
      db: {
        runMigrationsOnBoot: true,
        migrationsDir: "./src/db/migrations",
        migrateLockTtlSeconds: 900,
      },
    },
    adapter: {
      dialect: "postgresql" as const,
      getDrizzle: () => ({}),
      tableExists: async () => true,
      executeQuery: async () => undefined,
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    migrateCore: vi.fn(async () => ({ applied: 1, coreChanged: false })),
    ...over,
  };
}

describe("runProdMigrationsIfEnabled", () => {
  it("skips unless NODE_ENV=production", async () => {
    process.env.NODE_ENV = "development";
    const a = args();
    await runProdMigrationsIfEnabled(a as never);
    expect(a.migrateCore).not.toHaveBeenCalled();
  });

  it("skips when runMigrationsOnBoot is false", async () => {
    const a = args({
      config: { db: { runMigrationsOnBoot: false, migrationsDir: "./m" } },
    });
    await runProdMigrationsIfEnabled(a as never);
    expect(a.migrateCore).not.toHaveBeenCalled();
  });

  it("runs migrateCore in wait mode when enabled in production", async () => {
    const a = args();
    await runProdMigrationsIfEnabled(a as never);
    expect(a.migrateCore).toHaveBeenCalledOnce();
    expect(a.migrateCore.mock.calls[0][0].lockMode).toBe("wait");
  });

  it("hands migrateCore a full logger (with .success) so runFileMigrations cannot crash on boot", async () => {
    // Regression: the boot callers (init.ts/auth-handler.ts) pass a minimal
    // logger without .success, but migrateCore -> runFileMigrations calls
    // logger.success("Applied ...") AFTER applying. Previously that threw
    // ("logger.success is not a function") and aborted remaining migrations.
    const a = args({
      migrateCore: vi.fn(async (deps: { logger: Record<string, unknown> }) => {
        // Simulate what runFileMigrations actually does.
        (deps.logger.success as (m: string) => void)("Applied x.sql");
        return { applied: 1, coreChanged: false };
      }),
    });
    await expect(
      runProdMigrationsIfEnabled(a as never)
    ).resolves.toBeUndefined();
    // The boot logger's .error must NOT have fired (no false "failed").
    expect(a.logger.error).not.toHaveBeenCalled();
    // success was routed to the boot logger's info.
    expect(a.logger.info).toHaveBeenCalledWith("Applied x.sql");
  });

  it("logs and returns (does NOT throw) when migrateCore throws", async () => {
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(
      runProdMigrationsIfEnabled(a as never)
    ).resolves.toBeUndefined();
    expect(a.logger.error).toHaveBeenCalled();
  });
});
