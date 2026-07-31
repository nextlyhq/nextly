import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { FIELD_GROUP_MIGRATION_PHASE } from "../../domains/field-groups/migration/run";
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

  // A failed FILE migration is survivable: each applies in its own transaction,
  // so the database is at a clean boundary and the app can serve while an
  // operator looks.
  it("continues booting when a file migration fails", async () => {
    const a = args({
      migrateCore: vi.fn(async () => {
        throw new Error("file apply failed");
      }),
    });
    await expect(
      runProdMigrationsIfEnabled(a as never)
    ).resolves.toBeUndefined();
    expect(a.logger.error).toHaveBeenCalled();
  });

  // 🔴 A failed STORAGE migration is not survivable. MySQL commits DDL as it is
  // issued and the ledger rewrites commit per batch, so a failure can leave
  // tables half-renamed. Serving against that is worse than not booting: the
  // read path treats a missing data table as EMPTY CONTENT rather than an
  // error, so it would surface as silently absent content, not a stopped deploy.
  it("refuses to boot when the storage migration fails", async () => {
    const a = args({
      migrateCore: vi.fn(async () => {
        throw NextlyError.serviceUnavailable({
          logMessage: "storage half-renamed",
          logContext: { phase: FIELD_GROUP_MIGRATION_PHASE, reason: "x" },
        });
      }),
    });
    // Asserted on logContext, not on the message: NextlyError's public message
    // is deliberately generic and carries none of the detail.
    await expect(runProdMigrationsIfEnabled(a as never)).rejects.toMatchObject({
      logContext: { phase: FIELD_GROUP_MIGRATION_PHASE },
    });
  });

  // Matched on the stamped phase, not on message text, so a reworded message
  // cannot quietly turn a fatal failure back into a tolerated one.
  it("does not treat an unrelated NextlyError as a storage failure", async () => {
    const a = args({
      migrateCore: vi.fn(async () => {
        throw NextlyError.serviceUnavailable({
          logMessage: "something else",
          logContext: { reason: "unrelated" },
        });
      }),
    });
    await expect(
      runProdMigrationsIfEnabled(a as never)
    ).resolves.toBeUndefined();
  });
});
