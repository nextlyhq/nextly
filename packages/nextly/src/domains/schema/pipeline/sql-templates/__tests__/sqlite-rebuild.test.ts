/**
 * A check or foreign-key change on an existing SQLite table, as a migration
 * generates it and the runner executes it.
 *
 * SQLite cannot alter either in place, so the generated SQL rebuilds the
 * table. What decides whether that is correct is only observable on a real
 * engine running it the way the runner does — through the runner's own
 * `executeTransaction` on the real SQLite adapter: foreign keys turned off
 * around one transaction, `PRAGMA foreign_key_check` before COMMIT. The rows must
 * survive, the new definition must be enforced, and a table that references
 * the rebuilt one must keep its rows and its reference. What that contract
 * cannot cover — a runner that left foreign keys on, triggers on the table —
 * must be refused before anything is dropped.
 */
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { DynamicCollectionSchemaService } from "../../../../dynamic-collections/services/dynamic-collection-schema-service";
import { executeTransaction } from "../../../migrate/migration-transaction";
import { diffSnapshots } from "../../diff/diff";
import { introspectLiveSnapshot } from "../../diff/introspect-live";
import type { TableSpec } from "../../diff/types";
import { generateSQL, generateStatements } from "../index";

const ORDERS = "fx__orders";

function orders(statuses: string[], extra: Partial<TableSpec> = {}): TableSpec {
  return {
    name: ORDERS,
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "status", type: "text", nullable: false },
      { name: "note", type: "text", nullable: true },
    ],
    indexes: [
      { name: "idx_fx__orders_status", columns: ["status"], unique: false },
    ],
    checks: [
      {
        name: "ck_fx__orders_status",
        sql: `status IN (${statuses.map(s => `'${s}'`).join(", ")})`,
      },
    ],
    foreignKeys: [],
    ...extra,
  };
}

/** A table referencing the orders table, with the given ON DELETE action. */
function lines(onDelete: "cascade" | "set null" | "no action"): TableSpec {
  return {
    name: "fx__lines",
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "order_id", type: "text", nullable: true },
    ],
    indexes: [],
    checks: [],
    foreignKeys: [
      {
        name: "fk_fx__lines_order_id",
        columns: ["order_id"],
        referencesTable: ORDERS,
        referencesColumns: ["id"],
        onDelete,
        onUpdate: "no action",
      },
    ],
  };
}

let adapter: ReturnType<typeof createSqliteAdapter>;
let db: Database.Database;
afterEach(async () => {
  await adapter?.disconnect();
});

/** A database holding `tables`, created by the migration SQL for them. */
async function databaseWith(tables: TableSpec[]): Promise<Database.Database> {
  adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  const created = adapter.getDrizzle<{ $client: Database.Database }>().$client;
  created.pragma("foreign_keys = ON");
  for (const statement of generateStatements(
    diffSnapshots({ tables: [] }, { tables }),
    "sqlite",
    tables
  )) {
    for (const part of statement.split(";\n")) created.prepare(part).run();
  }
  return created;
}

function migrationStatements(from: TableSpec[], to: TableSpec[]): string[] {
  return generateStatements(
    diffSnapshots({ tables: from }, { tables: to }),
    "sqlite",
    to
  );
}

/** Run a migration as the runner does: one unit through `executeTransaction`. */
async function migrate(from: TableSpec[], to: TableSpec[]): Promise<void> {
  await executeTransaction(adapter, async tx => {
    for (const statement of migrationStatements(from, to)) {
      await tx.execute(statement);
    }
  });
}

/**
 * Run a migration in a plain transaction with foreign keys still on — a
 * runner that skipped the contract, which the rebuild must refuse.
 */
function migrateWithoutTheContract(from: TableSpec[], to: TableSpec[]): void {
  db.exec("BEGIN");
  try {
    for (const statement of migrationStatements(from, to)) {
      db.prepare(statement).run();
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

describe("SQLite check and foreign-key changes rebuild the table", () => {
  it("an enum change keeps every row and enforces the new check", async () => {
    db = await databaseWith([orders(["open", "paid"])]);
    db.prepare(
      `INSERT INTO ${ORDERS} VALUES ('1', 'open', 'a'), ('2', 'paid', NULL)`
    ).run();

    await migrate(
      [orders(["open", "paid"])],
      [orders(["open", "paid", "void"])]
    );

    expect(db.prepare(`SELECT * FROM ${ORDERS} ORDER BY id`).all()).toEqual([
      { id: "1", status: "open", note: "a" },
      { id: "2", status: "paid", note: null },
    ]);
    // The widened check admits the new value and still refuses others.
    db.prepare(`INSERT INTO ${ORDERS} VALUES ('3', 'void', NULL)`).run();
    expect(() =>
      db.prepare(`INSERT INTO ${ORDERS} VALUES ('4', 'lost', NULL)`).run()
    ).toThrow(/CHECK constraint failed/);
    // The index went with the old table and came back with the new one.
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`
        )
        .all(ORDERS)
    ).toEqual([{ name: "idx_fx__orders_status" }]);
    // Nothing the rebuild used is left behind.
    expect(
      db
        .prepare(
          // Every helper name starts with two underscores (`__new_`, the
          // guard); compared literally, since `_` is a LIKE wildcard.
          `SELECT name FROM sqlite_master WHERE substr(name, 1, 2) = '__'`
        )
        .all()
    ).toEqual([]);
  });

  it("the down migration restores the narrower check", async () => {
    db = await databaseWith([orders(["open", "paid", "void"])]);
    db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'open', NULL)`).run();

    await migrate(
      [orders(["open", "paid", "void"])],
      [orders(["open", "paid"])]
    );

    expect(() =>
      db.prepare(`INSERT INTO ${ORDERS} VALUES ('2', 'void', NULL)`).run()
    ).toThrow(/CHECK constraint failed/);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ${ORDERS}`).get()).toEqual({
      n: 1,
    });
  });

  it("a narrowed check that existing rows violate rolls the migration back", async () => {
    db = await databaseWith([orders(["open", "paid"])]);
    db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'paid', NULL)`).run();

    await expect(
      migrate([orders(["open", "paid"])], [orders(["open"])])
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(db.prepare(`SELECT * FROM ${ORDERS}`).all()).toEqual([
      { id: "1", status: "paid", note: null },
    ]);
  });

  it("a referencing table keeps its rows and its reference to the rebuilt table", async () => {
    db = await databaseWith([orders(["open"]), lines("no action")]);
    db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'open', NULL)`).run();
    db.prepare(`INSERT INTO fx__lines VALUES ('l1', '1')`).run();

    await migrate(
      [orders(["open"]), lines("no action")],
      [orders(["open", "paid"]), lines("no action")]
    );

    expect(db.prepare(`SELECT * FROM fx__lines`).all()).toEqual([
      { id: "l1", order_id: "1" },
    ]);
    // Still enforced, and against the rebuilt table rather than a renamed copy.
    expect(() =>
      db.prepare(`DELETE FROM ${ORDERS} WHERE id = '1'`).run()
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(
      db
        .prepare(`SELECT "table" FROM pragma_foreign_key_list('fx__lines')`)
        .all()
    ).toEqual([{ table: ORDERS }]);
  });

  it.each(["cascade", "set null"] as const)(
    "a referencing table's ON DELETE %s does not fire: its rows are kept and still act afterwards",
    async action => {
      db = await databaseWith([orders(["open"]), lines(action)]);
      db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'open', NULL)`).run();
      db.prepare(`INSERT INTO fx__lines VALUES ('l1', '1')`).run();

      await migrate(
        [orders(["open"]), lines(action)],
        [orders(["open", "paid"]), lines(action)]
      );

      expect(db.prepare(`SELECT * FROM fx__lines`).all()).toEqual([
        { id: "l1", order_id: "1" },
      ]);
      // The action is wired to the rebuilt table, not lost with the old one.
      db.prepare(`DELETE FROM ${ORDERS} WHERE id = '1'`).run();
      expect(db.prepare(`SELECT * FROM fx__lines`).all()).toEqual(
        action === "cascade" ? [] : [{ id: "l1", order_id: null }]
      );
    }
  );

  it("a table referencing itself with ON DELETE SET NULL keeps its references", async () => {
    const tree = (statuses: string[]): TableSpec =>
      orders(statuses, {
        columns: [
          ...orders(statuses).columns,
          { name: "parent_id", type: "text", nullable: true },
        ],
        foreignKeys: [
          {
            name: "fk_fx__orders_parent_id",
            columns: ["parent_id"],
            referencesTable: ORDERS,
            referencesColumns: ["id"],
            onDelete: "set null",
            onUpdate: "no action",
          },
        ],
      });
    db = await databaseWith([tree(["open"])]);
    db.prepare(
      `INSERT INTO ${ORDERS} VALUES ('1', 'open', NULL, NULL), ('2', 'open', NULL, '1')`
    ).run();

    await migrate([tree(["open"])], [tree(["open", "paid"])]);

    expect(
      db.prepare(`SELECT id, parent_id FROM ${ORDERS} ORDER BY id`).all()
    ).toEqual([
      { id: "1", parent_id: null },
      { id: "2", parent_id: "1" },
    ]);
  });

  it("refuses, losing nothing, when foreign keys were left on", async () => {
    db = await databaseWith([orders(["open"]), lines("cascade")]);
    db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'open', NULL)`).run();
    db.prepare(`INSERT INTO fx__lines VALUES ('l1', '1')`).run();

    expect(() =>
      migrateWithoutTheContract(
        [orders(["open"]), lines("cascade")],
        [orders(["open", "paid"]), lines("cascade")]
      )
    ).toThrow(/rebuilding fx__orders needs foreign keys off/);
    expect(db.prepare(`SELECT * FROM fx__lines`).all()).toEqual([
      { id: "l1", order_id: "1" },
    ]);
  });

  it("refuses, dropping nothing, when the table has a trigger", async () => {
    db = await databaseWith([orders(["open"])]);
    db.exec(
      `CREATE TRIGGER fx__orders_touch AFTER UPDATE ON ${ORDERS} BEGIN SELECT 1; END`
    );

    await expect(
      migrate([orders(["open"])], [orders(["open", "paid"])])
    ).rejects.toThrow(/rebuilding fx__orders would drop the triggers on it/);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`).all()
    ).toEqual([{ name: "fx__orders_touch" }]);
  });

  it("a new foreign key the existing rows violate is refused before COMMIT", async () => {
    const withoutKey: TableSpec = { ...lines("no action"), foreignKeys: [] };
    db = await databaseWith([orders(["open"]), withoutKey]);
    db.prepare(`INSERT INTO fx__lines VALUES ('l1', 'missing')`).run();

    await expect(
      migrate(
        [orders(["open"]), withoutKey],
        [orders(["open"]), lines("no action")]
      )
    ).rejects.toThrow(/referencing rows that do not exist/);
    expect(
      db
        .prepare(`SELECT "table" FROM pragma_foreign_key_list('fx__lines')`)
        .all()
    ).toEqual([]);
  });

  it("adds a foreign key to an existing table, enforced afterwards", async () => {
    const withoutKey: TableSpec = { ...lines("no action"), foreignKeys: [] };
    db = await databaseWith([orders(["open"]), withoutKey]);
    db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'open', NULL)`).run();
    db.prepare(`INSERT INTO fx__lines VALUES ('l1', '1')`).run();

    await migrate(
      [orders(["open"]), withoutKey],
      [orders(["open"]), lines("cascade")]
    );

    expect(db.prepare(`SELECT * FROM fx__lines`).all()).toEqual([
      { id: "l1", order_id: "1" },
    ]);
    db.prepare(`DELETE FROM ${ORDERS} WHERE id = '1'`).run();
    expect(db.prepare(`SELECT * FROM fx__lines`).all()).toEqual([]);
  });

  it("removes an enum column its check names: the drop is left to the rebuild", async () => {
    // SQLite refuses DROP COLUMN on a column a check names, and the diff drops
    // the check and the column in one list.
    const withStatus = orders(["open", "paid"]);
    const withoutStatus: TableSpec = {
      ...withStatus,
      columns: withStatus.columns.filter(c => c.name !== "status"),
      indexes: [],
      checks: [],
    };
    db = await databaseWith([withStatus]);
    db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'open', 'kept')`).run();

    await migrate([withStatus], [withoutStatus]);

    expect(db.prepare(`SELECT * FROM ${ORDERS}`).all()).toEqual([
      { id: "1", note: "kept" },
    ]);
  });

  it("removes a foreign-key column in the down that reverses adding it", async () => {
    // The down of adding `order_id` with its foreign key drops both; the
    // key names the column, so the column cannot be dropped on its own.
    const withKey = lines("no action");
    const withoutKey: TableSpec = {
      ...withKey,
      columns: withKey.columns.filter(c => c.name !== "order_id"),
      foreignKeys: [],
    };
    db = await databaseWith([orders(["open"]), withKey]);
    db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'open', NULL)`).run();
    db.prepare(`INSERT INTO fx__lines VALUES ('l1', '1')`).run();

    await migrate([orders(["open"]), withKey], [orders(["open"]), withoutKey]);

    expect(db.prepare(`SELECT * FROM fx__lines`).all()).toEqual([{ id: "l1" }]);
  });

  it("refuses, dropping nothing, to rebuild a table whose live foreign keys its spec does not track", async () => {
    // An entity's spec leaves foreign keys undefined, while the table it
    // describes carries real ones; rebuilt from the spec it would lose them.
    db = await databaseWith([orders(["open"]), lines("cascade")]);
    const untracked = (checks: string[]): TableSpec => ({
      ...lines("cascade"),
      foreignKeys: undefined,
      checks: checks.map(sql => ({ name: "ck_fx__lines_id", sql })),
    });

    await expect(
      migrate(
        [orders(["open"]), untracked([])],
        [orders(["open"]), untracked(["id <> ''"])]
      )
    ).rejects.toThrow(
      /rebuilding fx__lines would drop foreign keys its schema does not track/
    );
    expect(
      db
        .prepare(`SELECT "table" FROM pragma_foreign_key_list('fx__lines')`)
        .all()
    ).toEqual([{ table: ORDERS }]);
  });

  it("rebuilds a table whose untracked foreign keys it has none of", async () => {
    // The control: the refusal above is about the live keys, not about the
    // spec leaving the dimension undefined.
    const bare = (checks: string[]): TableSpec => ({
      ...orders(["open"]),
      foreignKeys: undefined,
      checks: checks.map(sql => ({ name: "ck_fx__orders_status", sql })),
    });
    db = await databaseWith([bare(["status IN ('open')"])]);

    await migrate(
      [bare(["status IN ('open')"])],
      [bare(["status IN ('open', 'paid')"])]
    );

    db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'paid', NULL)`).run();
  });

  it("refuses to rebuild a table whose live checks its spec does not track", async () => {
    // Checks untracked, a foreign key changing: the live check would be lost.
    const withoutKey: TableSpec = {
      ...lines("no action"),
      foreignKeys: [],
      checks: undefined,
    };
    db = await databaseWith([orders(["open"]), withoutKey]);
    db.exec(
      `CREATE TABLE fx__checked (id TEXT PRIMARY KEY, order_id TEXT, CONSTRAINT ck_fx__checked_id CHECK (id <> ''))`
    );
    const checked = (keys: TableSpec["foreignKeys"]): TableSpec => ({
      ...withoutKey,
      name: "fx__checked",
      foreignKeys: keys,
      checks: undefined,
    });

    await expect(
      migrate(
        [orders(["open"]), checked([])],
        [orders(["open"]), checked(lines("no action").foreignKeys)]
      )
    ).rejects.toThrow(
      /rebuilding fx__checked would drop checks its schema does not track/
    );
  });

  it("rebuilds a table from a snapshot too old to mark its key, keyed on id", async () => {
    // Snapshots written before `primaryKey` existed leave it off every
    // column; the historical `id` convention still names the key.
    const unmarked = (statuses: string[]): TableSpec => ({
      ...orders(statuses),
      columns: orders(statuses).columns.map(({ primaryKey: _key, ...c }) => c),
    });
    db = await databaseWith([orders(["open"])]);
    db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'open', NULL)`).run();

    await migrate([unmarked(["open"])], [unmarked(["open", "paid"])]);

    expect(() =>
      db.prepare(`INSERT INTO ${ORDERS} VALUES ('1', 'paid', NULL)`).run()
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("renders one rebuild for several constraint changes to one table", async () => {
    const from = orders(["open"]);
    const to = orders(["open", "paid"], {
      checks: [
        { name: "ck_fx__orders_status", sql: "status IN ('open', 'paid')" },
        { name: "ck_fx__orders_note", sql: "length(note) < 100" },
      ],
    });
    const statements = generateStatements(
      diffSnapshots({ tables: [from] }, { tables: [to] }),
      "sqlite",
      [to]
    );
    expect(
      statements.filter(s => s.startsWith(`DROP TABLE "${ORDERS}"`))
    ).toHaveLength(1);
  });

  it("PostgreSQL and MySQL render the operations one by one, as generateSQL does", async () => {
    const ops = diffSnapshots(
      { tables: [orders(["open"])] },
      { tables: [orders(["open", "paid"])] }
    );
    for (const dialect of ["postgresql", "mysql"] as const) {
      expect(generateStatements(ops, dialect, [])).toEqual(
        ops.map(op => generateSQL(op, dialect))
      );
    }
  });
});

describe("Schema Builder tables and the foreign keys their specs cannot track", () => {
  // Built by the Schema Builder's own DDL generator, the path that creates
  // `dc_` tables with foreign keys, rather than by hand.
  const builder = new DynamicCollectionSchemaService(undefined, "sqlite");
  const authorField = {
    name: "author",
    type: "relationship",
    options: { target: "fx_authors", relationType: "manyToOne" },
  };

  function runBuilderSql(sql: string): void {
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (statement) db.exec(statement);
    }
  }

  const foreignKeysOf = (table: string) =>
    db
      .prepare(`SELECT "table", "from" FROM pragma_foreign_key_list(?)`)
      .all(table);

  /** Two Builder tables that end with the same fields by different histories. */
  async function twoHistories(): Promise<void> {
    db = await databaseWith([]);
    runBuilderSql(
      builder.generateMigrationSQL("dc_fx_authors", [
        { name: "name", type: "text" },
      ] as never)
    );
    // Created with the relationship already declared.
    runBuilderSql(
      builder.generateMigrationSQL("dc_fx_born_with", [authorField] as never)
    );
    // Created without it, then given it — the Builder's edit path.
    runBuilderSql(
      builder.generateMigrationSQL("dc_fx_given_later", [] as never)
    );
    runBuilderSql(
      builder.generateAlterTableMigration("dc_fx_given_later", [], [
        authorField,
      ] as never)
    );
  }

  /** The table as its entity spec describes it: foreign keys untracked, a check added. */
  async function specOf(table: string, checks: string[]): Promise<TableSpec> {
    const live = await introspectLiveSnapshot(
      drizzle({ client: db }),
      "sqlite",
      [table]
    );
    const spec = live.tables[0];
    if (spec === undefined) throw new Error(`expected ${table}`);
    return {
      ...spec,
      foreignKeys: undefined,
      checks: checks.map(sql => ({ name: `ck_${table}_contributed`, sql })),
    };
  }

  it("holds different foreign keys for the same fields, so no spec derived from them fits both", async () => {
    await twoHistories();
    expect(foreignKeysOf("dc_fx_born_with")).toEqual([
      { table: "dc_fx_authors", from: "author" },
    ]);
    expect(foreignKeysOf("dc_fx_given_later")).toEqual([]);
  });

  it("refuses to rebuild the Builder table that has one, and keeps it", async () => {
    await twoHistories();
    const before = await specOf("dc_fx_born_with", []);
    const after = await specOf("dc_fx_born_with", [
      "author IS NOT NULL OR author IS NULL",
    ]);

    await expect(migrate([before], [after])).rejects.toThrow(
      /rebuilding dc_fx_born_with would drop foreign keys its schema does not track: write this change as a manual migration/
    );
    expect(foreignKeysOf("dc_fx_born_with")).toEqual([
      { table: "dc_fx_authors", from: "author" },
    ]);
  });

  it("refuses when the spec tracks some checks but not the Builder's validation check", async () => {
    // Tracking is per element, not per table: a contributed check makes the
    // spec's checks defined, while the Builder's own `chk_*_validation` is
    // still undescribed. Rebuilt from the spec it would be lost.
    db = await databaseWith([]);
    runBuilderSql(
      builder.generateMigrationSQL("dc_fx_scored", [
        { name: "score", type: "number", validation: { min: 0 } },
      ] as never)
    );
    const live = await introspectLiveSnapshot(
      drizzle({ client: db }),
      "sqlite",
      ["dc_fx_scored"]
    );
    const spec = live.tables[0];
    if (spec === undefined) throw new Error("expected dc_fx_scored");
    const withContributed = (checks: string[]): TableSpec => ({
      ...spec,
      checks: checks.map(sql => ({ name: "ck_dc_fx_scored_contributed", sql })),
    });

    await expect(
      migrate([withContributed([])], [withContributed(["score < 1000"])])
    ).rejects.toThrow(
      /rebuilding dc_fx_scored would drop checks its schema does not track/
    );
    expect(
      (
        db
          .prepare(`SELECT sql FROM sqlite_master WHERE name = 'dc_fx_scored'`)
          .get() as { sql: string }
      ).sql
    ).toContain("chk_dc_fx_scored_validation");
  });

  it("rebuilds the Builder table that has none", async () => {
    await twoHistories();
    const before = await specOf("dc_fx_given_later", []);
    const after = await specOf("dc_fx_given_later", [
      "author IS NOT NULL OR author IS NULL",
    ]);

    await migrate([before], [after]);

    expect(
      db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE name = 'dc_fx_given_later'`
        )
        .get()
    ).toEqual({
      sql: expect.stringContaining("ck_dc_fx_given_later_contributed"),
    });
  });
});
