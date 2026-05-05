// Unit tests for DrizzleStatementExecutor.executeSqlite.
//
// PRAGMA foreign_keys = OFF/ON wrapping happens in PushSchemaPipeline
// (BEFORE/AFTER db.transaction()) — see pipeline test for that. This
// file covers what the executor itself owns:
//   - The recreate-pattern INSERT rewrite (NULL-substitute missing cols)
//   - The skip-on-already-exists / skip-on-duplicate-column-name branch
//   - The post-loop PRAGMA foreign_key_check (works inside a tx)
//   - The aggregated FK-violation error message
//
// PG and MySQL paths are exercised by the integration tests in PR-5
// (against real DBs via docker-compose).

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";

import { DrizzleStatementExecutor } from "./drizzle-statement-executor";

// Spin up an in-memory better-sqlite3 db wrapped with drizzle().
// Production callers pass adapter.getDrizzle() which is the same shape.
function makeTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  return { sqlite, db };
}

describe("DrizzleStatementExecutor.executeSqlite", () => {
  it("runs DDL and creates the table", async () => {
    const { sqlite, db } = makeTestDb();

    const executor = new DrizzleStatementExecutor("sqlite", db);
    await executor.executeStatements({}, [
      "CREATE TABLE dc_post (id integer PRIMARY KEY, title text)",
    ]);

    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dc_post'"
      )
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    sqlite.close();
  });

  it("preserves the recreate-pattern INSERT rewrite (column substitution)", async () => {
    const { sqlite, db } = makeTestDb();

    // Existing source table with one column. drizzle-kit's recreate
    // pattern emits an INSERT that references columns the source
    // doesn't have yet. The rewrite substitutes NULL for missing cols.
    sqlite.exec(`CREATE TABLE dc_x (id integer PRIMARY KEY)`);

    // Disable FK so the recreate pattern works (in production the
    // pipeline does this before calling us; we mirror that here).
    sqlite.pragma("foreign_keys = OFF");

    const executor = new DrizzleStatementExecutor("sqlite", db);
    await executor.executeStatements({}, [
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

    // Disable FK so the DELETE below is allowed to orphan rows
    // (mimics what the pipeline does in production).
    sqlite.pragma("foreign_keys = OFF");

    const executor = new DrizzleStatementExecutor("sqlite", db);

    // Apply a statement that orphans dc_child. After the loop, the
    // executor's foreign_key_check detects the orphan and throws.
    await expect(
      executor.executeStatements({}, ["DELETE FROM dc_parent WHERE id = 1"])
    ).rejects.toThrow(/foreign_key_check found 1 FK violation/);

    sqlite.close();
  });

  it("skips duplicate-index errors from raw SQLite (already exists)", async () => {
    const { sqlite, db } = makeTestDb();

    sqlite.exec(
      "CREATE TABLE dc_x (id integer PRIMARY KEY); CREATE INDEX idx_dc_x_id ON dc_x(id)"
    );

    const executor = new DrizzleStatementExecutor("sqlite", db);
    // Index already exists — should be a no-op, not a throw.
    await expect(
      executor.executeStatements({}, [
        "CREATE INDEX idx_dc_x_id ON dc_x(id)",
      ])
    ).resolves.toBeUndefined();

    sqlite.close();
  });

  it("skips duplicate-index errors wrapped in DrizzleError (.cause chain)", async () => {
    const { sqlite, db } = makeTestDb();

    sqlite.exec(
      "CREATE TABLE dc_x (id integer PRIMARY KEY); CREATE INDEX idx_dc_x_id ON dc_x(id)"
    );

    // The drizzle-orm session.run() wraps better-sqlite3 errors in a
    // DrizzleError whose .message is "Failed to run the query '...'".
    // The real SQLite "already exists" error lives in .cause.
    // Simulate that wrapping to verify the guard catches it.
    const executor = new DrizzleStatementExecutor("sqlite", db);

    // Run the duplicate CREATE INDEX through the drizzle db handle, which
    // will go through the drizzle-orm session and produce the wrapped error.
    await expect(
      executor.executeStatements({}, [
        "CREATE INDEX `idx_dc_x_id` ON `dc_x`(`id`)",
      ])
    ).resolves.toBeUndefined();

    sqlite.close();
  });

  it("does nothing when statement list is empty (early return)", async () => {
    const { sqlite, db } = makeTestDb();

    const executor = new DrizzleStatementExecutor("sqlite", db);
    await executor.executeStatements({}, []);

    // No tables created, no errors thrown.
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(0);

    sqlite.close();
  });

  it("aggregates FK violation error message by table", async () => {
    const { sqlite, db } = makeTestDb();

    sqlite.exec(`
      CREATE TABLE dc_parent (id integer PRIMARY KEY);
      CREATE TABLE dc_child_a (
        id integer PRIMARY KEY,
        parent_id integer REFERENCES dc_parent(id)
      );
      CREATE TABLE dc_child_b (
        id integer PRIMARY KEY,
        parent_id integer REFERENCES dc_parent(id)
      );
      INSERT INTO dc_parent (id) VALUES (1);
      INSERT INTO dc_child_a (id, parent_id) VALUES (1, 1), (2, 1);
      INSERT INTO dc_child_b (id, parent_id) VALUES (1, 1);
    `);

    sqlite.pragma("foreign_keys = OFF");

    const executor = new DrizzleStatementExecutor("sqlite", db);

    // Orphans 3 rows total (2 in child_a, 1 in child_b). The summary
    // is order-insensitive (PRAGMA foreign_key_check returns rows in
    // an implementation-defined order).
    await expect(
      executor.executeStatements({}, ["DELETE FROM dc_parent WHERE id = 1"])
    ).rejects.toThrow(/3 FK violation\(s\)/);

    try {
      await executor.executeStatements({}, [
        "DELETE FROM dc_parent WHERE id = 1",
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain("dc_child_a: 2 orphan(s)");
      expect(msg).toContain("dc_child_b: 1 orphan(s)");
    }

    sqlite.close();
  });
});
