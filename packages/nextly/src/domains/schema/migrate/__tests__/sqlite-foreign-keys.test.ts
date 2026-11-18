/**
 * The dangling-reference refusal judges what a unit DID, not what the
 * database already held.
 *
 * A SQLite database can carry rows that reference missing rows before any
 * migration runs — written while enforcement was off, or by an older rebuild.
 * Checked against zero, one such row refused every later migration, unrelated
 * ones included, and blamed each of them for it. Run on the real SQLite
 * adapter through the runner's own `executeTransaction`.
 */
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeTransaction } from "../migration-transaction";
import { danglingReferences } from "../sqlite-foreign-keys";

let adapter: ReturnType<typeof createSqliteAdapter>;
let sqlite: Database.Database;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;
  sqlite.exec(`
    CREATE TABLE parent (id TEXT PRIMARY KEY);
    CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent (id));
    INSERT INTO parent VALUES ('p1');
    INSERT INTO child VALUES ('c1', 'p1');
  `);
  // The pre-existing orphan: written with enforcement off, as an older
  // database may hold one.
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`INSERT INTO child VALUES ('c0', 'gone')`);
  sqlite.pragma("foreign_keys = ON");
});
afterEach(async () => {
  await adapter.disconnect();
});

const runUnit = (statements: string[]) =>
  executeTransaction(adapter, async tx => {
    for (const statement of statements) await tx.execute(statement);
  });

describe("the dangling-reference refusal", () => {
  it("lets an unrelated migration through a database that already holds a dangling row", async () => {
    await runUnit(["CREATE TABLE unrelated (id TEXT PRIMARY KEY)"]);
    expect(
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE name = 'unrelated'`)
        .all()
    ).toEqual([{ name: "unrelated" }]);
  });

  it("lets a rebuild of the table holding that row through, though its rowids change", async () => {
    // The copy renumbers the implicit rowid — the dangling `c0` was
    // inserted second and is copied first — so the old dangling row reads
    // back under a different rowid; it is still the same row.
    await runUnit([
      "CREATE TABLE __new_child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent (id), note TEXT)",
      "INSERT INTO __new_child (id, parent_id) SELECT id, parent_id FROM child ORDER BY id",
      "DROP TABLE child",
      "ALTER TABLE __new_child RENAME TO child",
    ]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM child").get()).toEqual({
      n: 2,
    });
  });

  it("still refuses, and rolls back, a migration that leaves a new dangling row", async () => {
    await expect(
      runUnit(["DELETE FROM parent WHERE id = 'p1'"])
    ).rejects.toThrow(
      /1 row\(s\) referencing rows that do not exist \(child → parent\)/
    );
    expect(sqlite.prepare("SELECT count(*) AS n FROM parent").get()).toEqual({
      n: 1,
    });
  });
});

describe("danglingReferences", () => {
  it("names the key each count dangles through, telling two keys between the same tables apart", async () => {
    sqlite.exec(
      `CREATE TABLE pair (id TEXT PRIMARY KEY, a TEXT REFERENCES parent (id), b TEXT REFERENCES parent (id))`
    );
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec(
      `INSERT INTO pair VALUES ('x', 'gone', 'p1'), ('y', 'gone', 'gone')`
    );
    sqlite.pragma("foreign_keys = ON");

    const found = await danglingReferences({
      read: <T>(statement: string) =>
        Promise.resolve(sqlite.prepare(statement).all() as T[]),
    });
    const byKey = [...found].sort((x, y) =>
      `${x.table}.${x.columns.join()}`.localeCompare(
        `${y.table}.${y.columns.join()}`
      )
    );
    expect(byKey).toEqual([
      {
        table: "child",
        parent: "parent",
        rows: 1,
        columns: ["parent_id"],
        referencesColumns: ["id"],
      },
      {
        table: "pair",
        parent: "parent",
        rows: 2,
        columns: ["a"],
        referencesColumns: ["id"],
      },
      {
        table: "pair",
        parent: "parent",
        rows: 1,
        columns: ["b"],
        referencesColumns: ["id"],
      },
    ]);
  });

  it("names the columns each key references, telling two keys from one column apart", async () => {
    sqlite.exec(`
      CREATE TABLE owner (id TEXT PRIMARY KEY, email TEXT UNIQUE);
      INSERT INTO owner VALUES ('o1', 'gone');
      CREATE TABLE note (id TEXT PRIMARY KEY, who TEXT, FOREIGN KEY (who) REFERENCES owner (id), FOREIGN KEY (who) REFERENCES owner (email));
    `);
    // `gone` is an owner's email and no owner's id: it dangles through the first key only.
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec(`INSERT INTO note VALUES ('n1', 'gone')`);
    sqlite.pragma("foreign_keys = ON");

    const found = await danglingReferences({
      read: <T>(statement: string) =>
        Promise.resolve(sqlite.prepare(statement).all() as T[]),
    });
    expect(found.filter(entry => entry.table === "note")).toEqual([
      {
        table: "note",
        parent: "owner",
        rows: 1,
        columns: ["who"],
        referencesColumns: ["id"],
      },
    ]);
  });
});
