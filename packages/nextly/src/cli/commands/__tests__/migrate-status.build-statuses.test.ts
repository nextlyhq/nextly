import { describe, it, expect } from "vitest";

import type { SchemaEventRow } from "../../../domains/schema/events/schema-events-repository";
import {
  migrationChecksum,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import {
  NO_TRANSACTION_ROLLBACK_NOTE,
  PARTIAL_ROLLBACK_NOTE,
} from "../plugin-module-rollback";
import {
  buildMigrationStatuses,
  failedRollbacksSinceApply,
  ledgerRecords,
  pluginModuleEntries,
} from "../migrate-status";

describe("buildMigrationStatuses", () => {
  it("reconciles a ledger filename (.sql) with the discovered file name (no ext)", () => {
    const files = [
      {
        name: "20260101_000000_000_init",
        filePath: "/x/20260101_000000_000_init.sql",
        checksum: "abc",
        collections: [],
        timestamp: "20260101_000000",
      },
    ];
    const applied = [
      {
        id: "e1",
        filename: "20260101_000000_000_init.sql", // ledger stores WITH .sql
        sha256: "abc",
        status: "applied" as const,
        appliedBy: null,
        durationMs: 5,
        errorJson: null,
        appliedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    const statuses = buildMigrationStatuses(files, applied);

    // Exactly ONE row, applied — not a "pending" + "applied (file missing)" pair.
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe("applied");
    expect(statuses.some(s => s.status === "applied (file missing)")).toBe(
      false
    );
    expect(statuses.some(s => s.status === "pending")).toBe(false);
  });
});

describe("the order statuses are listed in", () => {
  it("lists a plugin's modules in the order they run, after the app's files", () => {
    // `10_more` runs before `1_init`: modules run in `compareModuleNames`
    // order, where `0` (0x30) is before `_` (0x5f). A whole-filename
    // collation lists them the other way round.
    const entry = (name: string) => ({ name, checksum: "x" });
    const statuses = buildMigrationStatuses(
      [
        entry("plugin:@acme/p/1_init"),
        entry("plugin:@acme/p/10_more"),
        entry("20260101_000000_000_app"),
      ],
      []
    );
    expect(statuses.map(status => status.filename)).toEqual([
      "20260101_000000_000_app",
      "plugin:@acme/p/10_more",
      "plugin:@acme/p/1_init",
    ]);
  });
});

describe("a plugin's status (--plugin)", () => {
  function sealed(name: string, transaction?: false): PluginMigration {
    const statements = { up: ["SELECT 1"], down: [] };
    const tables = { tables: [] };
    const content = {
      name,
      schemaVersion: 1,
      ...(transaction === false ? { transaction } : {}),
      dialects: {
        postgresql: statements,
        mysql: statements,
        sqlite: statements,
      },
      snapshot: { postgresql: tables, mysql: tables, sqlite: tables },
      before: { postgresql: tables, mysql: tables, sqlite: tables },
    };
    return { ...content, checksum: migrationChecksum(content) };
  }

  const init = sealed("001_init");
  const addCol = sealed("002_add_col");
  const reindex = sealed("003_reindex", false);
  const auth = {
    name: "auth",
    version: "1.0.0",
    nextly: "*",
    // Shipped out of order: the status lists them in the order they run.
    contributes: { schema: { migrations: [reindex, init, addCol] } },
  };

  const record = (
    filename: string,
    status: "applied" | "failed",
    sha256: string
  ) => ({
    id: `e-${filename}`,
    filename,
    sha256,
    status,
    appliedBy: null,
    durationMs: 7,
    errorJson: null,
    appliedAt: new Date("2026-09-23T00:00:00Z"),
  });

  function statuses(applied: ReturnType<typeof record>[]) {
    return buildMigrationStatuses(
      pluginModuleEntries([auth], "auth"),
      applied
    ).map(s => [s.filename, s.status, s.outsideTransaction ?? false]);
  }

  it("lists a module no run has applied yet as pending", () => {
    // Only the first module has a ledger row; the two after it are work
    // `nextly migrate` still has to do.
    expect(
      statuses([record("plugin:auth/001_init", "applied", init.checksum)])
    ).toEqual([
      ["plugin:auth/001_init", "applied", false],
      ["plugin:auth/002_add_col", "pending", false],
      ["plugin:auth/003_reindex", "pending", true],
    ]);
  });

  it("lists every shipped module as pending before the first run", () => {
    expect(statuses([]).map(([, status]) => status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("carries a failed attempt and an applied module's timing", () => {
    const [applied] = buildMigrationStatuses(
      pluginModuleEntries([auth], "auth"),
      [record("plugin:auth/001_init", "applied", init.checksum)]
    );
    expect(applied.appliedAt).toEqual(new Date("2026-09-23T00:00:00Z"));
    expect(applied.durationMs).toBe(7);
    expect(applied.checksumMismatch).toBe(false);
    expect(
      statuses([record("plugin:auth/002_add_col", "failed", addCol.checksum)])
    ).toContainEqual(["plugin:auth/002_add_col", "failed", false]);
  });

  it("reads a module changed since it ran as modified", () => {
    expect(
      statuses([record("plugin:auth/001_init", "applied", "other")])
    ).toContainEqual(["plugin:auth/001_init", "applied (modified)", false]);
  });

  it("reads a recorded module the plugin no longer ships as missing", () => {
    expect(
      statuses([record("plugin:auth/000_gone", "applied", "x")])
    ).toContainEqual(["plugin:auth/000_gone", "applied (file missing)", false]);
  });

  it("finds no modules for a plugin the config does not list", () => {
    expect(pluginModuleEntries([auth], "billing")).toEqual([]);
  });
});

describe("ledgerRecords", () => {
  function event(
    filename: string,
    status: SchemaEventRow["status"],
    at: number
  ): SchemaEventRow {
    return {
      id: `${filename}-${status}-${at}`,
      eventType: "file_apply",
      status,
      source: "cli-migrate",
      filename,
      sha256: null,
      scopeKind: null,
      scopeSlug: null,
      startedAt: new Date(at),
      endedAt: new Date(at),
      durationMs: null,
      note: null,
      statementsExecuted: null,
      supersededEventIds: null,
      supersededBy: null,
    };
  }

  it("reports each migration by its NEWEST event, so a rolled-back one is not applied", () => {
    // A rollback inserts a `rolled_back` event after the `applied` one; the
    // older row is still in the ledger.
    const rows = [
      event("plugin:@acme/fx/0001_init", "applied", 1000),
      event("plugin:@acme/fx/0002_more", "applied", 2000),
      event("plugin:@acme/fx/0002_more", "rolled_back", 3000),
      event("plugin:@acme/fx/0003_last", "applied", 4000),
      event("plugin:@acme/fx/0003_last", "failed", 5000),
    ];
    expect(
      ledgerRecords(rows, "@acme/fx").map(r => [r.filename, r.status])
    ).toEqual([
      ["plugin:@acme/fx/0001_init", "applied"],
      ["plugin:@acme/fx/0003_last", "failed"],
    ]);
  });

  it("names an applied migration whose rollback failed since, and flags MySQL's", () => {
    const applied = ledgerRecords([
      event("0001_a.sql", "applied", 1000),
      event("0002_b.sql", "applied", 2000),
      event("0003_c.sql", "applied", 5000),
    ]);
    const rollback = (filename: string, at: number, note: string) => ({
      ...event(filename, "failed", at),
      eventType: "file_rollback" as const,
      note,
    });
    const failures = failedRollbacksSinceApply(applied, [
      rollback("0001_a.sql", 3000, "migrate:down failed: x"),
      rollback(
        "0002_b.sql",
        3000,
        `${PARTIAL_ROLLBACK_NOTE} migrate:down failed: y`
      ),
      // Before the migration's latest apply: an old attempt, not its state now.
      rollback("0003_c.sql", 4000, "migrate:down failed: z"),
    ]);
    expect(failures.map(f => [f.filename, f.possiblyPartial])).toEqual([
      ["0001_a.sql", false],
      ["0002_b.sql", true],
    ]);
  });

  it("flags a rollback that failed outside a transaction as partial", () => {
    const applied = ledgerRecords([event("0001_a.sql", "applied", 1000)]);
    const failures = failedRollbacksSinceApply(applied, [
      {
        ...event("0001_a.sql", "failed", 2000),
        eventType: "file_rollback" as const,
        note: `${NO_TRANSACTION_ROLLBACK_NOTE} migrate:down failed: x`,
      },
    ]);
    expect(
      failures.map(f => [f.filename, f.possiblyPartial, f.outsideTransaction])
    ).toEqual([["0001_a.sql", true, true]]);
  });

  it("marks a file that runs outside a transaction, applied or pending", () => {
    const file = (name: string, transaction?: boolean) => ({
      name,
      filePath: `/x/${name}.sql`,
      checksum: "abc",
      collections: [],
      timestamp: "20260101_000000",
      ...(transaction === undefined ? {} : { transaction }),
    });
    const statuses = buildMigrationStatuses(
      [
        file("0001_plain"),
        file("0002_marked", false),
        file("0003_pending_marked", false),
      ],
      ledgerRecords([
        event("0001_plain.sql", "applied", 1000),
        event("0002_marked.sql", "applied", 2000),
      ]).map(record => ({ ...record, sha256: "abc" }))
    );
    expect(
      statuses.map(s => [s.filename, s.status, s.outsideTransaction ?? false])
    ).toEqual([
      ["0001_plain", "applied", false],
      ["0002_marked", "applied", true],
      ["0003_pending_marked", "pending", true],
    ]);
  });

  it("applies the same rule to the app's own files", () => {
    const rows = [
      event("0001_init.sql", "applied", 1000),
      event("0001_init.sql", "rolled_back", 2000),
      event("0001_init.sql", "applied", 3000),
      event("plugin:@acme/fx/0001_init", "applied", 1000),
    ];
    expect(ledgerRecords(rows).map(r => [r.filename, r.status])).toEqual([
      ["0001_init.sql", "applied"],
    ]);
  });
});
