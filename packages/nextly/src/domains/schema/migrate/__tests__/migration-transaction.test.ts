/**
 * The SQLite half of the migration transaction, on the real SQLite adapter
 * over a real better-sqlite3 database: a unit runs with foreign-key
 * enforcement off, is checked for dangling references before it commits, and
 * leaves the connection's setting as it found it.
 */
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  executeTransaction,
  runMigrationStatements,
} from "../migration-transaction";

let adapter: ReturnType<typeof createSqliteAdapter>;
let sqlite: Database.Database;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE parent (id TEXT PRIMARY KEY, label TEXT);
    CREATE TABLE child (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE
    );
    INSERT INTO parent VALUES ('p1', 'one');
    INSERT INTO child VALUES ('c1', 'p1');
  `);
});

/** Runs statements as one migration unit, the way the executors do. */
function runUnit(statements: string[]) {
  return executeTransaction(adapter, async tx => {
    for (const statement of statements) await tx.execute(statement);
  });
}

const count = (table: string) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number })
    .n;

describe("a SQLite migration unit", () => {
  it("rebuilds a parent table without cascading into its children's rows", async () => {
    // The lossless rebuild: new table, copy, drop the old, rename. With
    // enforcement on, dropping `parent` deletes every `child` row through
    // ON DELETE CASCADE.
    await runUnit([
      "CREATE TABLE __new_parent (id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '')",
      "INSERT INTO __new_parent (id, label) SELECT id, label FROM parent",
      "DROP TABLE parent",
      "ALTER TABLE __new_parent RENAME TO parent",
    ]);

    expect(count("child")).toBe(1);
    expect(count("parent")).toBe(1);
    // Enforcement is back on, and the child's reference still resolves.
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("rolls back a unit that would leave a dangling reference", async () => {
    await expect(
      runUnit([
        "CREATE TABLE marker (id TEXT)",
        "DELETE FROM parent WHERE id = 'p1'",
      ])
    ).rejects.toMatchObject({
      code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
      logContext: { reason: "dangling-reference" },
    });

    // Nothing the unit did survives, and enforcement is back on.
    expect(count("parent")).toBe(1);
    expect(count("child")).toBe(1);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE name = 'marker'")
        .all()
    ).toEqual([]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("refuses to run when enforcement could not be switched off, running nothing", async () => {
    // The pragma is silently ignored while another transaction is open on
    // the connection. The adapter's own transaction cannot be opened inside
    // one, so that state is produced at the session boundary: the real
    // adapter, with the switch-off statement not reaching the connection.
    const ignoresSwitchOff = Object.assign(Object.create(adapter) as object, {
      executeQuery: (statement: string, params?: never[]) =>
        statement === "PRAGMA foreign_keys = OFF"
          ? Promise.resolve([])
          : adapter.executeQuery(statement, params),
    }) as typeof adapter;
    let ran = false;

    await expect(
      executeTransaction(ignoresSwitchOff, async tx => {
        ran = true;
        await tx.execute("CREATE TABLE marker (id TEXT)");
      })
    ).rejects.toMatchObject({
      code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
      logContext: { reason: "enforcement-still-on" },
    });
    expect(ran).toBe(false);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE name = 'marker'")
        .all()
    ).toEqual([]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("restores the setting it found, and restores it after a failed statement", async () => {
    sqlite.pragma("foreign_keys = OFF");
    await runUnit(["CREATE TABLE a (id TEXT)"]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(0);

    sqlite.pragma("foreign_keys = ON");
    await expect(runUnit(["CREATE TABLE a (id TEXT)"])).rejects.toThrow(
      /already exists/
    );
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("a unit run outside a transaction that fails part-way", () => {
  /** The unit's error, from a real driver failure on its last statement. */
  async function failure(
    statements: string[],
    unit: Parameters<typeof runMigrationStatements>[2]
  ): Promise<NextlyError> {
    const thrown = await runMigrationStatements(adapter, statements, unit).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(thrown).toBeInstanceOf(NextlyError);
    return thrown as NextlyError;
  }

  const FAILS_THIRD = [
    "INSERT INTO parent VALUES ('p2', 'two')",
    "INSERT INTO parent VALUES ('p3', 'three')",
    "INSERT INTO missing_secret_table VALUES ('x')",
  ];

  it("keeps the driver's reason out of the public message", async () => {
    const error = await failure(FAILS_THIRD, {
      source: "0001_x.sql",
      transaction: false,
    });

    expect(error.code).toBe("NEXTLY_MIGRATION_PARTIALLY_APPLIED");
    expect(error.publicMessage).toBe(
      "0001_x.sql ran outside a transaction, and its statement 3 of 3 failed. The 2 statement(s) before it stayed applied, and were not undone. If you finish its remaining statements by hand, mark it applied with `nextly migrate:resolve --applied 0001_x.sql` rather than running it again; if you reverse the statements that ran, run `nextly migrate` again."
    );
    expect(error.publicMessage).not.toContain("missing_secret_table");
    // The reason travels where the operator reads it, not the wire.
    expect(error.logMessage).toMatch(
      /^0001_x\.sql: statement 3 of 3 failed: .*no such table: missing_secret_table$/
    );
    expect(error.cause?.message).toContain(
      "no such table: missing_secret_table"
    );
    expect(error.logContext).toEqual({
      source: "0001_x.sql",
      failedStatement: 3,
      statements: 3,
      reason: "partially-applied",
    });
    expect(error.toResponseJSON("req").message).not.toContain(
      "missing_secret_table"
    );
    expect(count("parent")).toBe(3);
  });

  it("names a module's recovery for a plugin module", async () => {
    const error = await failure(FAILS_THIRD, {
      source: "plugin:@acme/fx/001_init",
      transaction: false,
    });
    expect(error.publicMessage).toContain(
      "run `nextly migrate:resolve --failed-cleanup plugin:@acme/fx/001_init` and then `nextly migrate`, which records it applied rather than running it again"
    );
  });

  it("asks a DOWN to be finished or reversed, not marked applied", async () => {
    const error = await failure(FAILS_THIRD, {
      source: "0001_x.sql",
      transaction: false,
      direction: "down",
    });
    expect(error.publicMessage).toContain(
      "The 2 statement(s) before it stayed applied, and were not undone. Finish or reverse them by hand before running it again."
    );
    expect(error.publicMessage).not.toContain("--applied");
  });

  it("says nothing ran when the first statement fails", async () => {
    const error = await failure(
      ["INSERT INTO missing_secret_table VALUES ('x')"],
      {
        source: "0001_x.sql",
        transaction: false,
      }
    );
    expect(error.publicMessage).toBe(
      "0001_x.sql ran outside a transaction, and its statement 1 of 1 failed. No statement before it had run, so it can run again once the cause is fixed."
    );
  });
});
