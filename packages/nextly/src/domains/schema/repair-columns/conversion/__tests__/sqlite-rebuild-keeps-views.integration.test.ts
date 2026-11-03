/**
 * Both SQLite rebuilds on a table that views read, run on a real SQLite the way the migration
 * runner runs a unit: foreign keys off around one transaction, `PRAGMA foreign_key_check` before
 * COMMIT (`executeTransaction`).
 *
 * SQLite refuses to rename the rebuilt table into place while a view still names the dropped one
 * ("error in view v: no such table: main.t"). The column conversion reads the live views and
 * triggers, so its rebuild drops them first and creates them again; the migration file's rebuild
 * cannot read them when it is written (snapshots record no views), so its guard refuses before
 * anything is dropped and says what to do.
 */
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  readTableDefinition,
  withNamedChange,
  type TableDefinition,
} from "../../../__tests__/helpers/table-definition";
import { executeTransaction } from "../../../migrate/migration-transaction";
import { diffSnapshots } from "../../../pipeline/diff/diff";
import type { TableSpec } from "../../../pipeline/diff/types";
import { generateStatements } from "../../../pipeline/sql-templates";
import { buildSqliteConversion } from "../sqlite";
import type { ConversionRequest } from "../types";

let adapter: ReturnType<typeof createSqliteAdapter> | undefined;
let db: Database.Database;

afterEach(async () => {
  await adapter?.disconnect();
  adapter = undefined;
});

/** A fresh in-memory database of this test's own, with foreign keys on as the adapter leaves them. */
async function freshDatabase(): Promise<Database.Database> {
  adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  const client = adapter.getDrizzle<{ $client: Database.Database }>().$client;
  client.pragma("foreign_keys = ON");
  return client;
}

/** Run statements as the migration runner runs one unit. */
async function runAsMigration(statements: readonly string[]): Promise<void> {
  if (adapter === undefined) throw new Error("no database");
  await executeTransaction(adapter, async tx => {
    for (const statement of statements) await tx.execute(statement);
  });
}

/** Everything but the tables' rows: the stored definition of every schema object. */
function storedSchema(): unknown[] {
  return db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name"
    )
    .all();
}

describe("the migration file's rebuild of a table a view reads", () => {
  const ORDERS = "fx_rkv_orders";
  const orders = (statuses: string[]): TableSpec => ({
    name: ORDERS,
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "status", type: "text", nullable: false },
    ],
    indexes: [],
    checks: [
      {
        name: `ck_${ORDERS}_status`,
        sql: `status IN (${statuses.map(s => `'${s}'`).join(", ")})`,
      },
    ],
    foreignKeys: [],
  });
  const migration = (from: TableSpec[], to: TableSpec[]): string[] =>
    generateStatements(
      diffSnapshots({ tables: from }, { tables: to }),
      "sqlite",
      to
    );

  it("is refused by its guard, naming the table, before anything is dropped", async () => {
    db = await freshDatabase();
    await runAsMigration(migration([], [orders(["open"])]));
    db.exec(`INSERT INTO ${ORDERS} VALUES ('1', 'open'), ('2', 'open')`);
    db.exec(
      `CREATE VIEW fx_rkv_open AS SELECT id FROM ${ORDERS} WHERE status = 'open'`
    );
    const schemaBefore = storedSchema();

    const statements = migration(
      [orders(["open"])],
      [orders(["open", "paid"])]
    );
    await expect(runAsMigration(statements)).rejects.toThrow(
      `rebuilding ${ORDERS} would break the views that read it: drop each view that reads ${ORDERS}, migrate, then create the view again`
    );

    // Refused by the guard, which runs before the first DROP: the guard's insert is where it fails.
    const guardInsert = statements.findIndex(s =>
      s.startsWith('INSERT INTO "__nextly_rebuild_')
    );
    const firstDrop = statements.findIndex(s =>
      s.startsWith(`DROP TABLE "${ORDERS}"`)
    );
    expect(guardInsert).toBeGreaterThan(-1);
    expect(guardInsert).toBeLessThan(firstDrop);
    expect(storedSchema()).toEqual(schemaBefore);
    expect(db.prepare(`SELECT * FROM ${ORDERS} ORDER BY id`).all()).toEqual([
      { id: "1", status: "open" },
      { id: "2", status: "open" },
    ]);
    expect(db.prepare("SELECT id FROM fx_rkv_open ORDER BY id").all()).toEqual([
      { id: "1" },
      { id: "2" },
    ]);
  });

  it("rebuilds a table whose name is in a view's own name, where the view reads another table", async () => {
    // The guard looks for the table in what a view reads, not in the view's own name.
    db = await freshDatabase();
    await runAsMigration(migration([], [orders(["open"])]));
    db.exec(`INSERT INTO ${ORDERS} VALUES ('1', 'open')`);
    db.exec("CREATE TABLE fx_rkv_other (id integer PRIMARY KEY)");
    db.exec(`CREATE VIEW ${ORDERS}_report AS SELECT id FROM fx_rkv_other`);

    await runAsMigration(
      migration([orders(["open"])], [orders(["open", "paid"])])
    );

    db.exec(`INSERT INTO ${ORDERS} VALUES ('2', 'paid')`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ${ORDERS}`).get()).toEqual({
      n: 2,
    });
    expect(db.prepare(`SELECT * FROM ${ORDERS}_report`).all()).toEqual([]);
  });

  it("is refused for a view that reads the table and whose own name is part of the table's", async () => {
    db = await freshDatabase();
    await runAsMigration(migration([], [orders(["open"])]));
    db.exec("CREATE VIEW orders AS SELECT id FROM " + ORDERS);
    await expect(
      runAsMigration(migration([orders(["open"])], [orders(["open", "paid"])]))
    ).rejects.toThrow(
      `rebuilding ${ORDERS} would break the views that read it`
    );
  });

  it("still rebuilds the same table once nothing reads it", async () => {
    // The control: the refusal is about the view, not about the rebuild.
    db = await freshDatabase();
    await runAsMigration(migration([], [orders(["open"])]));
    db.exec(`INSERT INTO ${ORDERS} VALUES ('1', 'open')`);

    await runAsMigration(
      migration([orders(["open"])], [orders(["open", "paid"])])
    );

    db.exec(`INSERT INTO ${ORDERS} VALUES ('2', 'paid')`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ${ORDERS}`).get()).toEqual({
      n: 2,
    });
  });
});

describe("the column conversion's rebuild keeps everything but the column's type and nullability", () => {
  const ITEMS = "fx_rkv_items";
  const LINES = "fx_rkv_lines";

  /** A table with every property a rebuild could lose, and a view and triggers that read `score`. */
  async function itemsTable(): Promise<void> {
    db = await freshDatabase();
    db.exec(`
      CREATE TABLE "${ITEMS}" (
        "id" text PRIMARY KEY NOT NULL,
        "title" text COLLATE NOCASE NOT NULL,
        "score" text NOT NULL DEFAULT '0' CHECK (length("score") < 20),
        "note" text,
        CONSTRAINT "ck_${ITEMS}_title" CHECK ("title" <> '')
      );
      CREATE INDEX "idx_${ITEMS}_score" ON "${ITEMS}" ("score");
      CREATE TABLE "${LINES}" (
        "id" text PRIMARY KEY NOT NULL,
        "item_id" text REFERENCES "${ITEMS}" ("id") ON DELETE CASCADE
      );
      CREATE TABLE "fx_rkv_log" ("item_id" text, "score");
      CREATE TRIGGER "fx_rkv_items_scored" AFTER UPDATE OF "score" ON "${ITEMS}"
        BEGIN INSERT INTO "fx_rkv_log" VALUES (new."id", new."score"); END;
      CREATE TRIGGER "fx_rkv_lines_noted" AFTER INSERT ON "${LINES}"
        BEGIN UPDATE "${ITEMS}" SET "note" = 'score ' || "score" WHERE "id" = new."item_id"; END;
      CREATE VIEW "fx_rkv_scores" AS SELECT "id", "score" FROM "${ITEMS}";
      INSERT INTO "${ITEMS}" ("id", "title", "score") VALUES ('a', 'Alpha', '5'), ('b', 'Beta', '7');
      INSERT INTO "${LINES}" VALUES ('l1', 'a');
    `);
  }

  const query = async <T>(statement: string): Promise<T[]> =>
    db.prepare(statement).all() as T[];

  /** The stored definition of every schema object but the converted table's own statement. */
  const everythingElse = (): unknown[] =>
    storedSchema().filter(
      row =>
        !(row as { type: string; name: string }).name.startsWith(ITEMS) ||
        (row as { type: string }).type !== "table"
    );

  /**
   * Builds the plan, checks what it says the new type cannot keep, and runs it as a migration.
   * `blockedBy` lists the properties and names the plan must name; the rebuild is run either way,
   * since the rebuild keeps them as written and the block is the judgement of what they mean for
   * the new type.
   */
  async function convert(
    to: ConversionRequest["to"],
    blockedBy: [string, string][] = []
  ): Promise<{
    before: TableDefinition;
    after: TableDefinition;
    schemaBefore: unknown[];
  }> {
    await itemsTable();
    const before = await readTableDefinition(query, "sqlite", ITEMS);
    const linesBefore = await readTableDefinition(query, "sqlite", LINES);
    const schemaBefore = everythingElse();
    if (adapter === undefined) throw new Error("no database");
    const plan = await buildSqliteConversion(adapter.getDrizzle(), {
      dialect: "sqlite",
      table: ITEMS,
      column: "score",
      from: { type: "text", nullable: false },
      to,
    });
    expect(plan).toMatchObject({
      rewritesTable: true,
      blocks: "writes",
      notCarried: [],
    });
    expect(plan.cannotCarry.map(item => [item.property, item.name])).toEqual(
      blockedBy
    );
    expect(plan.steps).toHaveLength(1);
    await runAsMigration(plan.steps[0] ?? []);
    expect(await readTableDefinition(query, "sqlite", LINES)).toEqual(
      linesBefore
    );
    return {
      before,
      after: await readTableDefinition(query, "sqlite", ITEMS),
      schemaBefore,
    };
  }

  /** What still works through the view and both triggers, and the other table's key. */
  function stillReadAndFired(score: unknown): void {
    expect(
      db.prepare(`SELECT * FROM "fx_rkv_scores" ORDER BY "id"`).all()
    ).toEqual([
      { id: "a", score },
      { id: "b", score: typeof score === "number" ? 7 : "7" },
    ]);
    db.exec(`UPDATE "${ITEMS}" SET "score" = '9' WHERE "id" = 'b'`);
    expect(db.prepare(`SELECT * FROM "fx_rkv_log"`).all()).toEqual([
      { item_id: "b", score: typeof score === "number" ? 9 : "9" },
    ]);
    db.exec(`INSERT INTO "${LINES}" VALUES ('l2', 'b')`);
    expect(
      db.prepare(`SELECT "note" FROM "${ITEMS}" WHERE "id" = 'b'`).get()
    ).toEqual({ note: "score 9" });
    db.exec(`DELETE FROM "${ITEMS}" WHERE "id" = 'a'`);
    expect(db.prepare(`SELECT "id" FROM "${LINES}"`).all()).toEqual([
      { id: "l2" },
    ]);
  }

  it("refuses with foreign keys on, before anything is dropped, and converts with them off", async () => {
    // With foreign keys on, the swap's DROP TABLE would run the child's ON DELETE CASCADE and take
    // its rows: the step must refuse before that, and leave the table, the child and the view whole.
    await itemsTable();
    if (adapter === undefined) throw new Error("no database");
    const plan = await buildSqliteConversion(adapter.getDrizzle(), {
      dialect: "sqlite",
      table: ITEMS,
      column: "score",
      from: { type: "text", nullable: false },
      to: { type: "text", nullable: true },
    });
    const step = plan.steps[0] ?? [];
    const schemaBefore = storedSchema();
    const rows = (): unknown => ({
      items: db.prepare(`SELECT * FROM "${ITEMS}" ORDER BY "id"`).all(),
      lines: db.prepare(`SELECT * FROM "${LINES}" ORDER BY "id"`).all(),
      view: db.prepare(`SELECT * FROM "fx_rkv_scores" ORDER BY "id"`).all(),
    });
    const rowsBefore = rows();
    expect(rowsBefore).toMatchObject({ lines: [{ id: "l1", item_id: "a" }] });

    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() => db.transaction(() => step.forEach(s => db.exec(s)))()).toThrow(
      `converting ${ITEMS}.score rebuilds ${ITEMS}, which needs foreign keys off: run it with foreign keys off, as nextly's migration runner does`
    );
    // The guard comes before the first statement that drops anything.
    const firstDrop = step.findIndex(s => s.startsWith("DROP "));
    const guardInsert = step.findIndex(s =>
      s.startsWith('INSERT INTO "__nextly_swap_')
    );
    expect(guardInsert).toBeGreaterThan(-1);
    expect(guardInsert).toBeLessThan(firstDrop);
    expect(storedSchema()).toEqual(schemaBefore);
    expect(rows()).toEqual(rowsBefore);

    // The control: the same step, run as the migration runner runs it, converts.
    await runAsMigration(step);
    expect(
      (
        db
          .prepare(
            `SELECT "notnull" FROM pragma_table_info('${ITEMS}') WHERE name = 'score'`
          )
          .get() as {
          notnull: number;
        }
      ).notnull
    ).toBe(0);
    expect(rows()).toEqual(rowsBefore);
  });

  it("a NOT NULL drop changes only the column's nullability", async () => {
    const { before, after, schemaBefore } = await convert({
      type: "text",
      nullable: true,
    });

    expect(after).toEqual(
      withNamedChange(before, { column: "score", nullable: true })
    );
    expect(everythingElse()).toEqual(schemaBefore);
    db.exec(
      `INSERT INTO "${ITEMS}" ("id", "title", "score") VALUES ('c', 'Gamma', NULL)`
    );
    db.exec(`DELETE FROM "${ITEMS}" WHERE "id" = 'c'`);
    stillReadAndFired("5");
  });

  it("an affinity-changing type change changes only the column's type", async () => {
    // The check reads `score` as a string, and integer is another kind of value: the plan names
    // it, and the rebuild still keeps it as written.
    const { before, after, schemaBefore } = await convert(
      { type: "integer", nullable: false },
      [["check", 'CHECK (length("score") < 20)']]
    );

    expect(after).toEqual({
      ...before,
      columns: before.columns.map(column =>
        // SQLite reports a declared type upper-cased.
        column.name === "score" ? { ...column, type: "INTEGER" } : column
      ),
    });
    expect(everythingElse()).toEqual(schemaBefore);
    expect(
      db
        .prepare(`SELECT typeof("score") AS t FROM "${ITEMS}" ORDER BY "id"`)
        .all()
    ).toEqual([{ t: "integer" }, { t: "integer" }]);
    stillReadAndFired(5);
  });
});
