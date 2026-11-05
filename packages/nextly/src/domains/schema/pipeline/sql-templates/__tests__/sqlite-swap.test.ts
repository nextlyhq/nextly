/**
 * The one SQLite table swap both rebuilds use: what it renders, in what order, and that the order
 * is the one SQLite accepts while views and other tables' triggers read the table.
 *
 * SQLite refuses `ALTER TABLE __new_t RENAME TO t` once `t` is dropped while any view or trigger in
 * the schema still names `t` ("error in view v: no such table: main.t"), so the swap drops those
 * first and creates them again from their stored SQL once the table is back under its own name.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  sqliteForeignKeysOffGuard,
  sqliteSwapStatements,
} from "../sqlite-swap";

const plain = {
  table: "fx__orders",
  definition: '(\n  "id" text PRIMARY KEY NOT NULL,\n  "status" text\n)',
  columns: ["id", "status"],
  indexes: ['CREATE INDEX "idx_fx__orders_status" ON "fx__orders" ("status")'],
  triggers: [],
  views: [],
};

describe("sqliteSwapStatements", () => {
  it("renders the four-statement swap and the indexes, nothing else, for a table nothing reads", () => {
    // The shape the drop guard reads as a rebuild that keeps its table: create the twin, copy into
    // it, drop the table, rename the twin back, adjacent and in that order.
    expect(sqliteSwapStatements(plain)).toEqual([
      'CREATE TABLE "__new_fx__orders" (\n  "id" text PRIMARY KEY NOT NULL,\n  "status" text\n)',
      'INSERT INTO "__new_fx__orders" ("id", "status") SELECT "id", "status" FROM "fx__orders"',
      'DROP TABLE "fx__orders"',
      'ALTER TABLE "__new_fx__orders" RENAME TO "fx__orders"',
      'CREATE INDEX "idx_fx__orders_status" ON "fx__orders" ("status")',
    ]);
  });

  it("drops the readers first and recreates indexes, triggers, views, then the other readers' triggers", () => {
    const statements = sqliteSwapStatements({
      ...plain,
      triggers: [
        "CREATE TRIGGER own AFTER UPDATE ON fx__orders BEGIN SELECT 1; END",
      ],
      views: [
        {
          name: "v_open",
          sql: "CREATE VIEW v_open AS SELECT id FROM fx__orders",
        },
        { name: "v_more", sql: "CREATE VIEW v_more AS SELECT id FROM v_open" },
      ],
      dependentTriggers: [
        {
          name: "elsewhere",
          sql: "CREATE TRIGGER elsewhere AFTER INSERT ON fx__log BEGIN INSERT INTO fx__orders (id) VALUES (new.id); END",
        },
      ],
    });
    expect(statements).toEqual([
      'DROP TRIGGER "elsewhere"',
      'DROP VIEW "v_open"',
      'DROP VIEW "v_more"',
      'CREATE TABLE "__new_fx__orders" (\n  "id" text PRIMARY KEY NOT NULL,\n  "status" text\n)',
      'INSERT INTO "__new_fx__orders" ("id", "status") SELECT "id", "status" FROM "fx__orders"',
      'DROP TABLE "fx__orders"',
      'ALTER TABLE "__new_fx__orders" RENAME TO "fx__orders"',
      'CREATE INDEX "idx_fx__orders_status" ON "fx__orders" ("status")',
      "CREATE TRIGGER own AFTER UPDATE ON fx__orders BEGIN SELECT 1; END",
      "CREATE VIEW v_open AS SELECT id FROM fx__orders",
      "CREATE VIEW v_more AS SELECT id FROM v_open",
      "CREATE TRIGGER elsewhere AFTER INSERT ON fx__log BEGIN INSERT INTO fx__orders (id) VALUES (new.id); END",
    ]);
  });

  it("carries an AUTOINCREMENT key's sequence to the twin before the four adjacent statements", () => {
    const statements = sqliteSwapStatements({ ...plain, keepsSequence: true });
    expect(statements[0]).toBe(
      `INSERT INTO sqlite_sequence (name, seq) SELECT '__new_fx__orders', seq FROM sqlite_sequence WHERE name = 'fx__orders'`
    );
    expect(statements.slice(1, 5)).toEqual(
      sqliteSwapStatements(plain).slice(0, 4)
    );
  });

  it("swaps a table a view and another table's trigger read, on a real SQLite, keeping both", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, c TEXT NOT NULL);
      CREATE INDEX t_c ON t (c);
      CREATE TABLE log (x TEXT);
      CREATE VIEW v AS SELECT c FROM t;
      CREATE VIEW w AS SELECT c FROM v;
      CREATE TRIGGER into_t AFTER INSERT ON log BEGIN INSERT INTO t (c) VALUES (new.x); END;
      INSERT INTO t (c) VALUES ('a'), ('b'), ('gone');
      DELETE FROM t WHERE c = 'gone';
    `);
    const stored = (type: string, name: string): string =>
      (
        db
          .prepare("SELECT sql FROM sqlite_master WHERE type = ? AND name = ?")
          .get(type, name) as { sql: string }
      ).sql;
    const swap = {
      table: "t",
      definition: "(id INTEGER PRIMARY KEY AUTOINCREMENT, c TEXT)",
      columns: ["id", "c"],
      indexes: [stored("index", "t_c")],
      triggers: [],
      views: ["v", "w"].map(name => ({ name, sql: stored("view", name) })),
      dependentTriggers: [{ name: "into_t", sql: stored("trigger", "into_t") }],
      keepsSequence: true,
    };

    // The control: without dropping its readers first, SQLite refuses the rename.
    const bare = sqliteSwapStatements({
      ...swap,
      views: [],
      dependentTriggers: [],
    });
    expect(() => db.transaction(() => bare.forEach(s => db.exec(s)))()).toThrow(
      /error in (view|trigger) \w+: no such table: main\.t/
    );

    db.transaction(() => sqliteSwapStatements(swap).forEach(s => db.exec(s)))();

    expect(db.prepare("SELECT c FROM w ORDER BY c").all()).toEqual([
      { c: "a" },
      { c: "b" },
    ]);
    db.exec("INSERT INTO log (x) VALUES ('from-trigger'), (NULL)");
    expect(db.prepare("SELECT id, c FROM t ORDER BY id").all()).toEqual([
      { id: 1, c: "a" },
      { id: 2, c: "b" },
      // The key does not reuse the deleted row's 3: the sequence came across.
      { id: 4, c: "from-trigger" },
      // The column is nullable now: the definition passed in is the one created.
      { id: 5, c: null },
    ]);
    expect(
      db
        .prepare(
          "SELECT type, name FROM sqlite_master WHERE type <> 'table' ORDER BY type, name"
        )
        .all()
    ).toEqual([
      { type: "index", name: "t_c" },
      { type: "trigger", name: "into_t" },
      { type: "view", name: "v" },
      { type: "view", name: "w" },
    ]);
    db.close();
  });
});

describe("sqliteForeignKeysOffGuard", () => {
  const REFUSAL = "converting t.c rebuilds t, which needs foreign keys off";

  /** A table with a child whose rows go with a deleted parent, as a swap's DROP TABLE would. */
  function database(foreignKeys: boolean): Database.Database {
    const db = new Database(":memory:");
    db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
    db.exec(`
      CREATE TABLE t (id INTEGER PRIMARY KEY, c TEXT);
      CREATE TABLE child (id INTEGER PRIMARY KEY, t_id INTEGER REFERENCES t (id) ON DELETE CASCADE);
      INSERT INTO t VALUES (1, 'a');
      INSERT INTO child VALUES (1, 1);
    `);
    return db;
  }

  /** Every schema object and every row, which the guard must leave as they were. */
  const state = (db: Database.Database): unknown => ({
    schema: db
      .prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
      .all(),
    t: db.prepare("SELECT * FROM t").all(),
    child: db.prepare("SELECT * FROM child").all(),
  });

  const run = (db: Database.Database): void =>
    db.transaction(() =>
      sqliteForeignKeysOffGuard("t", REFUSAL).forEach(s => db.exec(s))
    )();

  it("refuses with the given message when foreign keys are on, changing nothing", () => {
    const db = database(true);
    const before = state(db);
    expect(() => run(db)).toThrow(`CHECK constraint failed: ${REFUSAL}`);
    expect(state(db)).toEqual(before);
    db.close();
  });

  it("runs and leaves nothing behind when foreign keys are off", () => {
    const db = database(false);
    const before = state(db);
    run(db);
    // The guard table is gone again: the schema and rows read exactly as before.
    expect(state(db)).toEqual(before);
    db.close();
  });
});
