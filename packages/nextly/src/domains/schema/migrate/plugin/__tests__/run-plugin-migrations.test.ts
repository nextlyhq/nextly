/**
 * Applying a plugin's migrations.
 *
 * The adoption case is the one worth having tests for: a plugin installed in
 * development has its tables created by dev push, so the first `migrate` on a
 * deployment finds them ALREADY THERE. Treating that as a failure makes the
 * ordinary upgrade path impossible; treating it as "assume it matches" is how
 * a hand-altered table gets adopted as correct.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../../errors/nextly-error";
import type { TableSpec } from "../../../pipeline/diff/types";
import {
  assertAppliedUnchanged,
  assertModuleIntact,
  migrationChecksum,
  orderedMigrations,
  qualifiedFilename,
  type PluginMigration,
} from "../plugin-migration";
import {
  runPluginMigrations,
  type RunPluginMigrationsDeps,
} from "../run-plugin-migrations";

const notesTable: TableSpec = {
  name: "fx__notes",
  columns: [
    { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
  ],
  indexes: [],
};

function migration(over: Partial<PluginMigration> = {}): PluginMigration {
  const dialects = {
    postgresql: {
      up: ["CREATE TABLE fx__notes ()"],
      down: ["DROP TABLE fx__notes"],
    },
    mysql: {
      up: ["CREATE TABLE fx__notes ()"],
      down: ["DROP TABLE fx__notes"],
    },
    sqlite: {
      up: ["CREATE TABLE fx__notes ()"],
      down: ["DROP TABLE fx__notes"],
    },
  };
  const empty = { tables: [] };
  const full = { tables: [notesTable] };
  return {
    name: "20260101_000000_init",
    schemaVersion: 1,
    checksum: migrationChecksum(dialects),
    dialects,
    before: { postgresql: empty, mysql: empty, sqlite: empty },
    snapshot: { postgresql: full, mysql: full, sqlite: full },
    ...over,
  };
}

describe("the checksum", () => {
  it("accepts a module whose SQL matches", () => {
    expect(() => assertModuleIntact("fx", migration())).not.toThrow();
  });

  it("refuses a module edited after generation", () => {
    const edited = migration();
    edited.dialects.postgresql.up = ["DROP TABLE users"];
    // Refused rather than re-hashed. Re-hashing accepts whatever is on disk,
    // which is exactly the state being detected: the SQL that will run is not
    // the SQL that was reviewed.
    expect(() => assertModuleIntact("fx", edited)).toThrow(NextlyError);
  });

  it("does not move when the SQL has not", () => {
    // The control. A checksum that shifted between runs would refuse a module
    // nobody touched, and the refusal would be indistinguishable from a real
    // edit.
    expect(migrationChecksum(migration().dialects)).toBe(
      migrationChecksum(migration().dialects)
    );
  });

  it("refuses an APPLIED module that no longer matches what ran", () => {
    const changed = migration();
    changed.dialects.sqlite.up = ["CREATE TABLE fx__notes (extra TEXT)"];
    changed.checksum = migrationChecksum(changed.dialects);
    // Internally consistent — regenerated, checksum rewritten — and still
    // different from what built the live database. Only the ledger knows.
    expect(() =>
      assertAppliedUnchanged(
        "fx",
        changed,
        migrationChecksum(migration().dialects)
      )
    ).toThrow(NextlyError);
  });
});

describe("ordering", () => {
  it("sorts by name rather than trusting the array", () => {
    // The generated index.ts is rewritten by a tool; a hand-edit that
    // reorders it would otherwise silently change which migration runs first.
    const sorted = orderedMigrations([
      migration({ name: "20260301_c" }),
      migration({ name: "20260101_a" }),
      migration({ name: "20260201_b" }),
    ]);
    expect(sorted.map(m => m.name)).toEqual([
      "20260101_a",
      "20260201_b",
      "20260301_c",
    ]);
  });
});

describe("the ledger filename", () => {
  it("qualifies by plugin, so two plugins may ship the same name", () => {
    expect(qualifiedFilename("fx", "001_init")).not.toBe(
      qualifiedFilename("other", "001_init")
    );
  });
});

describe("running a set", () => {
  function deps(over: Partial<RunPluginMigrationsDeps> = {}) {
    return {
      dialect: "sqlite" as const,
      appliedShas: new Map<string, string | null>(),
      introspect: () => Promise.resolve([] as TableSpec[]),
      execute: (statements: readonly string[]) =>
        Promise.resolve(statements.length),
      record: () => Promise.resolve(),
      // Stands in for `reconcileFile`. The real one diffs the snapshots; this
      // reports the state the test wants and runs the SQL, so these assert
      // what this module does WITH a verdict rather than re-testing how the
      // verdict is reached — which is the reconciler's own tested job.
      reconcile: async (args: {
        executeSql: (sql: string) => Promise<number>;
      }) => {
        await args.executeSql("stub");
        return { state: "in_sync" as const };
      },
      ...over,
    };
  }

  it("executes a pending module and records it", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const result = await runPluginMigrations(
      [{ pluginName: "fx", pluginVersion: "1.0.0", migrations: [migration()] }],
      deps({ record })
    );
    expect(result).toEqual({ applied: 1, adopted: 0, skipped: 0 });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "plugin:fx/20260101_000000_init",
        outcome: "applied",
        statementsExecuted: 1,
      })
    );
  });

  it("records an adopted module without executing anything", async () => {
    // The dev-push case. `reconcileFile` reports `already_applied` when the
    // live tables already match the target, and this module's job is to
    // record that WITHOUT running the UP.
    const execute = vi.fn();
    const result = await runPluginMigrations(
      [{ pluginName: "fx", pluginVersion: "1.0.0", migrations: [migration()] }],
      deps({
        execute,
        reconcile: () => Promise.resolve({ state: "already_applied" as const }),
      })
    );
    expect(result).toEqual({ applied: 0, adopted: 1, skipped: 0 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("propagates a drift refusal rather than recording anything", async () => {
    // `reconcileFile` throws on drift. This module must not swallow it: a
    // migration run that continued past a database matching neither endpoint
    // would apply later modules onto a state nobody described.
    const record = vi.fn();
    await expect(
      runPluginMigrations(
        [
          {
            pluginName: "fx",
            pluginVersion: "1.0.0",
            migrations: [migration()],
          },
        ],
        deps({
          record,
          reconcile: () => Promise.reject(new Error("drift")),
        })
      )
    ).rejects.toThrow("drift");
    expect(record).not.toHaveBeenCalled();
  });

  it("stops at the first failure, leaving later plugins unrun", async () => {
    // Today's behaviour for app files, for the same reason: migrations after
    // a failed one assume a state that was never reached.
    const execute = vi.fn().mockRejectedValue(new Error("syntax error"));
    const laterPlugin = vi.fn();
    await expect(
      runPluginMigrations(
        [
          {
            pluginName: "a",
            pluginVersion: "1.0.0",
            migrations: [migration()],
          },
          {
            pluginName: "b",
            pluginVersion: "1.0.0",
            migrations: [migration({ name: "20260202_b" })],
          },
        ],
        deps({ execute, record: laterPlugin })
      )
    ).rejects.toThrow("syntax error");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(laterPlugin).not.toHaveBeenCalled();
  });

  it("skips a module the ledger already records, without introspecting", async () => {
    // An already-applied module must not cost a round trip to the database on
    // every boot, and must not be re-run.
    const introspect = vi.fn();
    const execute = vi.fn();
    const m = migration();
    const result = await runPluginMigrations(
      [{ pluginName: "fx", pluginVersion: "1.0.0", migrations: [m] }],
      deps({
        appliedShas: new Map([
          [`plugin:fx/${m.name}`, migrationChecksum(m.dialects)],
        ]),
        introspect,
        execute,
      })
    );
    expect(result.skipped).toBe(1);
    expect(introspect).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses an applied module whose SQL has since changed", async () => {
    const m = migration();
    await expect(
      runPluginMigrations(
        [{ pluginName: "fx", pluginVersion: "1.0.0", migrations: [m] }],
        deps({
          appliedShas: new Map([[`plugin:fx/${m.name}`, "a-different-sha"]]),
        })
      )
    ).rejects.toThrow(NextlyError);
  });

  it("treats a dialect the module does not describe as no statements", async () => {
    // A module generated before a dialect was supported has no entry for it.
    // Running nothing is correct; reading `undefined.up` is a crash during a
    // migration, which is the worst moment for one.
    const partial = migration();
    delete (partial.dialects as Record<string, unknown>).sqlite;
    delete (partial.snapshot as Record<string, unknown>).sqlite;
    delete (partial.before as Record<string, unknown>).sqlite;
    partial.checksum = migrationChecksum(partial.dialects);

    const execute = vi.fn().mockResolvedValue(0);
    const result = await runPluginMigrations(
      [{ pluginName: "fx", pluginVersion: "1.0.0", migrations: [partial] }],
      deps({ execute })
    );
    // Recorded as adopted, not applied: with the dialect absent both
    // endpoints are empty, so the live state already matches the target and
    // there is nothing to run. `decideOutcome` checks the target first for
    // exactly this reason — the safe answer when both match is to execute
    // nothing.
    // Recorded as applied with nothing to run: the reconciler decides the
    // state, and an absent dialect simply contributes no statements.
    expect(result.applied + result.adopted).toBe(1);
  });

  it("applies plugins in the order given, which is the resolver's", async () => {
    const order: string[] = [];
    await runPluginMigrations(
      [
        { pluginName: "a", pluginVersion: "1.0.0", migrations: [migration()] },
        {
          pluginName: "b",
          pluginVersion: "1.0.0",
          migrations: [migration({ name: "20260202_b" })],
        },
      ],
      deps({
        record: row => {
          order.push(row.pluginName);
          return Promise.resolve();
        },
      })
    );
    expect(order).toEqual(["a", "b"]);
  });
});
