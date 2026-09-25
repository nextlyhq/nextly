import { describe, expect, it } from "vitest";

import {
  migrateDownCore,
  recordPluginSchemaVersionFromLedger,
  selectAppliedTargets,
} from "../migrate-down";
import type { SchemaEventRow } from "../../../domains/schema/events/schema-events-repository";
import type { OwnerRecord } from "../../../domains/schema/ownership/owner-registry";
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
      ): Promise<{ ran: true; value: T }> => ({ ran: true, value: await fn() }),
      ...overrides,
    },
  };
}

describe("migrateDownCore", () => {
  it("refuses when the DOWN section is empty", async () => {
    const { deps } = baseDeps({ readDownSql: async () => "   " });
    await expect(migrateDownCore(deps)).rejects.toThrow(/irreversible/i);
  });

  it("refuses when the DOWN section holds only a comment", async () => {
    // `formatMigrationFile` writes an explanatory comment rather than nothing
    // when a migration has no inverse, and a baseline never has one. Measuring
    // the section's LENGTH reads that comment as rollback SQL: the run then
    // executes zero statements, records the file rolled back, and the next
    // `migrate` treats it as pending and re-applies its CREATE TABLEs against
    // the tables that are still standing.
    const { deps, executed } = baseDeps({
      readDownSql: async () =>
        "-- (no automatic down — this migration is not reversible. Hand-write rollback SQL here)",
    });
    await expect(migrateDownCore(deps)).rejects.toThrow(/irreversible/i);
    expect(executed).toEqual([]);
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

  describe("ledger scoping (plugin rows)", () => {
    it("never selects a plugin's row by default", async () => {
      // The newest applied row of ANY kind would be the plugin's, so without
      // scoping `migrate:down` reverts a plugin's migration while reporting
      // an app rollback.
      const { deps, executed, recorded } = baseDeps({
        options: { step: 1, allowDataLoss: true, yes: false, dryRun: false },
        listFileApplies: async () => [
          row("a.sql", "applied", 1000),
          row("plugin:auth/001_init.sql", "applied", 9000),
        ],
      });
      const res = await migrateDownCore(deps);
      expect(res.rolledBack).toEqual(["a.sql"]);
      expect(recorded).toEqual(["a.sql"]);
      expect(executed.length).toBe(1);
    });

    it("selects only the named plugin's rows under --plugin", async () => {
      const { deps, recorded } = baseDeps({
        options: {
          step: 1,
          allowDataLoss: true,
          yes: false,
          dryRun: false,
          plugin: "auth",
        },
        listFileApplies: async () => [
          row("a.sql", "applied", 1000),
          row("plugin:auth/001_init.sql", "applied", 2000),
          row("plugin:billing/001_init.sql", "applied", 3000),
        ],
      });
      const res = await migrateDownCore(deps);
      expect(res.rolledBack).toEqual(["plugin:auth/001_init.sql"]);
      expect(recorded).toEqual(["plugin:auth/001_init.sql"]);
    });

    it("never returns the union under --plugin", async () => {
      // A run scoped to a plugin must not touch the app's rows even when the
      // step budget would allow more targets.
      const { deps, recorded } = baseDeps({
        options: {
          step: 5,
          allowDataLoss: true,
          yes: false,
          dryRun: false,
          plugin: "auth",
        },
        listFileApplies: async () => [
          row("a.sql", "applied", 1000),
          row("plugin:auth/001_init.sql", "applied", 2000),
          row("plugin:billing/001_init.sql", "applied", 3000),
        ],
      });
      const res = await migrateDownCore(deps);
      expect(res.rolledBack).toEqual(["plugin:auth/001_init.sql"]);
      expect(recorded).toEqual(["plugin:auth/001_init.sql"]);
    });

    it("reports nothing to roll back for a plugin with no rows", async () => {
      const { deps, executed } = baseDeps({
        options: {
          step: 1,
          allowDataLoss: true,
          yes: false,
          dryRun: false,
          plugin: "nobody",
        },
        listFileApplies: async () => [row("a.sql", "applied", 1000)],
      });
      const res = await migrateDownCore(deps);
      expect(res.rolledBack).toEqual([]);
      expect(executed).toEqual([]);
    });
  });
});

describe("plugin schema version after a rollback", () => {
  // `auth` shipped two modules; both are applied and its owner rows say 2.
  const migrations = [
    { name: "001_init", schemaVersion: 1 },
    { name: "002_more", schemaVersion: 2 },
  ];
  const ownerRow: OwnerRecord = {
    tableName: "auth__identities",
    ownerKind: "plugin",
    ownerId: "auth",
    migratedBy: "plugin:auth",
    ownerVersion: "1.0.0",
    schemaVersion: 2,
    state: "active",
  };

  it("recomputes the version from the modules still applied", async () => {
    // One ledger shared by the rollback and the recompute, the way the real
    // command shares the repository: `recordRolledBack` INSERTS a
    // `rolled_back` event after the `applied` one, and the recompute reads it
    // back. A recompute that filtered for `applied` rows would still see
    // `002_more` and leave the rows claiming version 2.
    const ledger: SchemaEventRow[] = [
      row("plugin:auth/001_init", "applied", 1000),
      row("plugin:auth/002_more", "applied", 2000),
    ];
    let clock = 3000;
    let owners: OwnerRecord[] = [ownerRow];

    const { deps } = baseDeps({
      options: {
        step: 1,
        allowDataLoss: true,
        yes: false,
        dryRun: false,
        plugin: "auth",
      },
      listFileApplies: async () => [...ledger],
      recordRolledBack: async (filename: string) => {
        ledger.push(row(filename, "rolled_back", clock++));
      },
      recordPluginSchemaVersion: () =>
        recordPluginSchemaVersionFromLedger({
          plugin: "auth",
          migrations,
          listFileApplies: async () => [...ledger],
          owners: {
            read: async () => owners,
            upsert: async rows => {
              owners = [...rows];
            },
          },
        }),
    });

    const result = await migrateDownCore(deps);

    expect(result.rolledBack).toEqual(["plugin:auth/002_more"]);
    expect(owners.map(o => o.schemaVersion)).toEqual([1]);
  });

  it("records null once no module of the plugin remains applied", async () => {
    let owners: OwnerRecord[] = [ownerRow];
    await recordPluginSchemaVersionFromLedger({
      plugin: "auth",
      migrations,
      listFileApplies: async () => [
        row("plugin:auth/001_init", "applied", 1000),
        row("plugin:auth/001_init", "rolled_back", 2000),
      ],
      owners: {
        read: async () => owners,
        upsert: async rows => {
          owners = [...rows];
        },
      },
    });
    expect(owners.map(o => o.schemaVersion)).toEqual([null]);
  });
});
