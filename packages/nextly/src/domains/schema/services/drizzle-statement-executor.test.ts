// Unit tests for DrizzleStatementExecutor.executeSqlite.
//
// PRAGMA foreign_keys = OFF/ON wrapping happens in PushSchemaPipeline
// (BEFORE/AFTER db.transaction()) — see pipeline test for that. This
// file covers what the executor itself owns:
//   - The recreate-pattern INSERT rewrite (NULL-substitute missing cols)
//   - The skip-on-already-exists / skip-on-duplicate-column-name branch
//
// Dangling-reference refusal is not the executor's: the pipeline checks the
// whole SQLite apply once, covered in
// pipeline/__tests__/sqlite-dangling-references.test.ts and
// migrate/__tests__/migration-transaction.test.ts.
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
  // v1 constructor is object-form ONLY — the positional form silently
  // treats the client as config and opens a NEW :memory: database,
  // making every assertion against `sqlite` meaningless.
  const db = drizzle({ client: sqlite });
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

  it("executes v1's full rebuild block verbatim (inline PRAGMAs pass the piece filter)", async () => {
    const { sqlite, db } = makeTestDb();

    // Live table with a row. v1's recreate flow emits the whole rebuild
    // choreography — including PRAGMA foreign_keys toggles and an
    // INSERT..SELECT that lists only columns existing on the source —
    // as plain statements. The executor must run them all verbatim.
    sqlite.exec(
      "CREATE TABLE dc_x (id integer PRIMARY KEY); INSERT INTO dc_x VALUES (1);"
    );

    const executor = new DrizzleStatementExecutor("sqlite", db);
    await executor.executeStatements({}, [
      "PRAGMA foreign_keys=OFF;",
      "CREATE TABLE `__new_dc_x` (id integer PRIMARY KEY, name text)",
      'INSERT INTO `__new_dc_x`("id") SELECT "id" FROM `dc_x`',
      "DROP TABLE dc_x",
      "ALTER TABLE `__new_dc_x` RENAME TO `dc_x`",
      "PRAGMA foreign_keys=ON;",
    ]);

    const rows = sqlite.prepare("SELECT id, name FROM dc_x").all() as Array<{
      id: number;
      name: string | null;
    }>;
    expect(rows).toEqual([{ id: 1, name: null }]);

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
      executor.executeStatements({}, ["CREATE INDEX idx_dc_x_id ON dc_x(id)"])
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
});
