// Unit tests for DrizzleStatementExecutor.executeSqlite — specifically
// the PR-4 PRAGMA foreign_keys = OFF / foreign_key_check / ON wrapping.
// Runs against an in-memory better-sqlite3 instance (always available
// in test env). Uses functional state checks (introspect the live DB
// after the call) rather than call-sequence tracking — better-sqlite3's
// API doesn't lend itself to clean spies.
//
// PG and MySQL paths are exercised by the integration tests in PR-5
// (against real DBs via docker-compose).

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";

import { DrizzleStatementExecutor } from "./drizzle-statement-executor.js";

// Spin up an in-memory better-sqlite3 db and wrap it with drizzle().
// The executor expects the drizzle-wrapped client (which exposes .run
// and .all the way the production callers do via adapter.getDrizzle()).
function makeTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  // The executor uses (this.db as any).run / .all — the drizzle
  // better-sqlite3 wrapper exposes both as the right shape.
  const db = drizzle(sqlite);
  return { sqlite, db };
}

// Read the current PRAGMA foreign_keys setting via the raw sqlite handle
// (drizzle's wrapper has a different surface for pragma reads).
function getForeignKeys(sqlite: Database.Database): boolean {
  const row = sqlite.prepare("PRAGMA foreign_keys").get() as {
    foreign_keys: number;
  };
  return row.foreign_keys === 1;
}

describe("DrizzleStatementExecutor.executeSqlite — PRAGMA wrapping", () => {
  it("re-enables PRAGMA foreign_keys = ON after a successful apply", async () => {
    const { sqlite, db } = makeTestDb();

    const executor = new DrizzleStatementExecutor("sqlite", db);
    await executor.executeStatements({}, [
      "CREATE TABLE dc_post (id integer PRIMARY KEY, title text)",
    ]);

    // PRAGMA toggled OFF inside the executor and ON in the finally block.
    expect(getForeignKeys(sqlite)).toBe(true);

    // Sanity check: the DDL actually ran.
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dc_post'"
      )
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    sqlite.close();
  });

  it("re-enables PRAGMA foreign_keys = ON even when a statement fails", async () => {
    const { sqlite, db } = makeTestDb();

    const executor = new DrizzleStatementExecutor("sqlite", db);

    // Pre-create a table so the conflicting CREATE below fails with a
    // real SQLite error (not the "already exists" path that the executor
    // intentionally skips). Use a non-CREATE form to trigger the throw.
    sqlite.exec("CREATE TABLE existing_table (id integer PRIMARY KEY)");

    await expect(
      executor.executeStatements({}, [
        // ALTER on a non-existent column triggers a real SQLite error
        // that the executor's catch block doesn't swallow.
        "ALTER TABLE existing_table DROP COLUMN nonexistent_col",
      ])
    ).rejects.toThrow();

    // finally block must have re-enabled FK regardless of the throw.
    expect(getForeignKeys(sqlite)).toBe(true);

    sqlite.close();
  });

  it("throws when foreign_key_check finds violations after apply", async () => {
    const { sqlite, db } = makeTestDb();

    // Pre-create a parent + child with FK enforcement.
    sqlite.exec(`
      CREATE TABLE dc_parent (id integer PRIMARY KEY);
      CREATE TABLE dc_child (
        id integer PRIMARY KEY,
        parent_id integer REFERENCES dc_parent(id)
      );
      INSERT INTO dc_parent (id) VALUES (1);
      INSERT INTO dc_child (id, parent_id) VALUES (1, 1);
    `);

    const executor = new DrizzleStatementExecutor("sqlite", db);

    // Apply a statement that orphans dc_child. The executor turns FK
    // off, runs the DELETE, then PRAGMA foreign_key_check detects the
    // orphan and throws.
    await expect(
      executor.executeStatements({}, ["DELETE FROM dc_parent WHERE id = 1"])
    ).rejects.toThrow(/foreign_key_check found 1 violation/);

    // FK still re-enabled even after the throw.
    expect(getForeignKeys(sqlite)).toBe(true);

    sqlite.close();
  });

  it("does nothing when statement list is empty (early return; no PRAGMA toggling)", async () => {
    const { sqlite, db } = makeTestDb();
    sqlite.pragma("foreign_keys = OFF"); // start OFF to detect toggling

    const executor = new DrizzleStatementExecutor("sqlite", db);
    await executor.executeStatements({}, []);

    // Setting unchanged — early-return skipped the PRAGMA wrapping.
    expect(getForeignKeys(sqlite)).toBe(false);

    sqlite.close();
  });

  it("preserves the recreate-pattern INSERT rewrite (column substitution)", async () => {
    const { sqlite, db } = makeTestDb();

    // Existing source table with one column. drizzle-kit's recreate
    // pattern for SQLite emits an INSERT that references columns that
    // don't yet exist in the source. The rewrite substitutes NULL for
    // missing columns so the INSERT succeeds.
    sqlite.exec(`CREATE TABLE dc_x (id integer PRIMARY KEY)`);

    const executor = new DrizzleStatementExecutor("sqlite", db);
    await executor.executeStatements({}, [
      // Simulated drizzle-kit recreate-pattern statements.
      "CREATE TABLE `__new_dc_x` (id integer PRIMARY KEY, name text)",
      'INSERT INTO `__new_dc_x`("id", "name") SELECT "id", "name" FROM `dc_x`',
      "DROP TABLE dc_x",
      "ALTER TABLE `__new_dc_x` RENAME TO `dc_x`",
    ]);

    // Without the rewrite, the INSERT would fail with "no such column: name".
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dc_x'"
      )
      .all();
    expect(tables).toHaveLength(1);

    // FK setting restored.
    expect(getForeignKeys(sqlite)).toBe(true);

    sqlite.close();
  });
});
