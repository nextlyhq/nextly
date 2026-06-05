import { describe, expect, it } from "vitest";

import { migrateDownCore, selectAppliedTargets } from "../migrate-down";
import type { SchemaEventRow } from "../../../domains/schema/events/schema-events-repository";
import { createLogger } from "../../utils/logger";

function row(
  filename: string,
  status: SchemaEventRow["status"],
  startedAtMs: number
): SchemaEventRow {
  return {
    id: `${filename}-${status}-${startedAtMs}`,
    eventType: "file_apply",
    status,
    source: "cli-migrate",
    filename,
    sha256: null,
    scopeKind: null,
    scopeSlug: null,
    startedAt: new Date(startedAtMs),
    endedAt: new Date(startedAtMs),
    durationMs: null,
    note: null,
    statementsExecuted: null,
    supersededEventIds: null,
    supersededBy: null,
  };
}

describe("selectAppliedTargets", () => {
  it("returns newest-applied-first, limited by step, skipping rolled-back files", () => {
    const rows = [
      row("a.sql", "applied", 1000),
      row("b.sql", "applied", 2000),
      row("b.sql", "rolled_back", 3000), // b is no longer applied
      row("c.sql", "applied", 4000),
    ];
    expect(selectAppliedTargets(rows, 2)).toEqual(["c.sql", "a.sql"]);
  });

  it("returns [] when nothing is applied", () => {
    expect(selectAppliedTargets([row("a.sql", "failed", 1)], 1)).toEqual([]);
  });
});

function baseDeps(overrides: Record<string, unknown> = {}) {
  const recorded: string[] = [];
  const executed: string[] = [];
  const failures: string[] = [];
  return {
    recorded,
    executed,
    failures,
    deps: {
      dialect: "postgresql" as const,
      db: {},
      nodeEnv: "development",
      logger: createLogger({ quiet: true }),
      options: { step: 1, allowDataLoss: false, yes: false, dryRun: false },
      listFileApplies: async () => [row("a.sql", "applied", 1000)],
      fileExists: async () => true,
      readDownSql: async () => 'ALTER TABLE "t" DROP COLUMN "c";',
      execDown: async (sql: string) => {
        executed.push(sql);
        return 1;
      },
      recordRolledBack: async (filename: string) => {
        recorded.push(filename);
      },
      recordFailed: async (filename: string) => {
        failures.push(filename);
      },
      withLock: async <T>(
        _db: unknown,
        _d: unknown,
        fn: () => Promise<T>
      ): Promise<T> => fn(),
      ...overrides,
    },
  };
}

describe("migrateDownCore", () => {
  it("refuses when the DOWN section is empty", async () => {
    const { deps } = baseDeps({ readDownSql: async () => "   " });
    await expect(migrateDownCore(deps)).rejects.toThrow(/irreversible/i);
  });

  it("requires --allow-data-loss when DOWN drops a column", async () => {
    const { deps } = baseDeps();
    await expect(migrateDownCore(deps)).rejects.toThrow(/allow-data-loss/);
  });

  it("requires --yes in production", async () => {
    const { deps } = baseDeps({
      nodeEnv: "production",
      options: { step: 1, allowDataLoss: true, yes: false, dryRun: false },
    });
    await expect(migrateDownCore(deps)).rejects.toThrow(/--yes/);
  });

  it("dry-run prints targets but executes/records nothing", async () => {
    const { deps, executed, recorded } = baseDeps({
      options: { step: 1, allowDataLoss: true, yes: false, dryRun: true },
    });
    const res = await migrateDownCore(deps);
    expect(executed).toEqual([]);
    expect(recorded).toEqual([]);
    expect(res.rolledBack).toEqual([]);
  });

  it("dry-run previews a destructive DOWN even WITHOUT --allow-data-loss", async () => {
    // dry-run is a non-destructive preview: it must not be blocked by the
    // data-loss guard (so operators can read the SQL before deciding).
    const { deps, executed } = baseDeps({
      options: { step: 1, allowDataLoss: false, yes: false, dryRun: true },
    });
    const res = await migrateDownCore(deps);
    expect(res.rolledBack).toEqual([]);
    expect(executed).toEqual([]);
  });

  it("executes DOWN and records a rolled_back event on success", async () => {
    const { deps, executed, recorded } = baseDeps({
      options: { step: 1, allowDataLoss: true, yes: false, dryRun: false },
    });
    const res = await migrateDownCore(deps);
    expect(executed.length).toBe(1);
    expect(recorded).toEqual(["a.sql"]);
    expect(res.rolledBack).toEqual(["a.sql"]);
  });

  it("returns nothing-to-roll-back when no applied migrations exist", async () => {
    const { deps, executed } = baseDeps({ listFileApplies: async () => [] });
    const res = await migrateDownCore(deps);
    expect(res.rolledBack).toEqual([]);
    expect(executed).toEqual([]);
  });

  it("records a failed event and rethrows when a DOWN statement fails", async () => {
    const { deps, failures } = baseDeps({
      options: { step: 1, allowDataLoss: true, yes: false, dryRun: false },
      execDown: async () => {
        throw new Error("boom");
      },
    });
    await expect(migrateDownCore(deps)).rejects.toThrow(/boom/);
    expect(failures).toEqual(["a.sql"]);
  });
});
