/**
 * The SQLite column conversion, from facts read off a live table: the rebuilt table's definition is
 * the stored CREATE TABLE statement with only the converted column's declared type and NOT NULL
 * changed, and the swap carries the table's indexes, triggers and the views and other triggers
 * that read it. Fed synthetic facts; the integration suite beside it runs the result.
 */
import { describe, expect, it } from "vitest";

import { sqliteForeignKeysOffGuard } from "../../../pipeline/sql-templates/sqlite-swap";
import { planSqliteConversion, type SqliteTableFacts } from "../sqlite";
import type { ConversionRequest } from "../types";

const request = (
  overrides: Partial<ConversionRequest> = {}
): ConversionRequest => ({
  dialect: "sqlite",
  table: "t",
  column: "c",
  from: { type: "text", nullable: false },
  to: { type: "text", nullable: true },
  ...overrides,
});

const facts = (
  createSql: string,
  overrides: Partial<SqliteTableFacts> = {}
): SqliteTableFacts => ({
  createSql,
  columns: [
    { name: "id", generated: false, primaryKey: true },
    { name: "c", generated: false, primaryKey: false },
    { name: "d", generated: false, primaryKey: false },
  ],
  indexes: [],
  objects: [],
  uniqueKeys: [],
  foreignKeys: [],
  ...overrides,
});

/** The foreign-keys-off guard every conversion step starts with, for `table`'s column `c`. */
const GUARD = (table: string): string[] =>
  sqliteForeignKeysOffGuard(
    table,
    `converting ${table}.c rebuilds ${table}, which needs foreign keys off: run it with foreign keys off, as nextly's migration runner does`
  );

/** The CREATE statement of the rebuilt twin, from a plan. */
const twinOf = (plan: { steps: string[][] }): string | undefined =>
  plan.steps[0]?.find(s => s.startsWith('CREATE TABLE "__new_t"'));

describe("planSqliteConversion: the rebuilt definition", () => {
  it("drops only the column's NOT NULL, keeping its default, collation and check and every other column", () => {
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE "t" ("id" text PRIMARY KEY NOT NULL, "c" text NOT NULL DEFAULT 'x' COLLATE NOCASE CHECK (c IS NOT NULL OR 1), "d" text NOT NULL)`
      ),
      request()
    );
    expect(twinOf(plan)).toBe(
      `CREATE TABLE "__new_t" ("id" text PRIMARY KEY NOT NULL, "c" text DEFAULT 'x' COLLATE NOCASE CHECK (c IS NOT NULL OR 1), "d" text NOT NULL)`
    );
    expect(plan).toMatchObject({
      rewritesTable: true,
      blocks: "writes",
      cannotCarry: [],
      notCarried: [],
    });
    expect(plan.steps).toHaveLength(1);
  });

  it("changes only the declared type for an affinity change, keeping the rest of the column as written", () => {
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE t (id INTEGER PRIMARY KEY, c   TEXT   DEFAULT '1' REFERENCES p(id) NOT DEFERRABLE, d text)`
      ),
      request({
        from: { type: "TEXT", nullable: true },
        to: { type: "integer", nullable: true },
      })
    );
    expect(twinOf(plan)).toBe(
      `CREATE TABLE "__new_t" (id INTEGER PRIMARY KEY, c   integer   DEFAULT '1' REFERENCES p(id) NOT DEFERRABLE, d text)`
    );
  });

  it("rebuilds a type change whose affinity stays the same, sizes and all", () => {
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE t (id INTEGER PRIMARY KEY, c decimal(10, 2), d text)`
      ),
      request({
        from: { type: "decimal(10, 2)", nullable: true },
        to: { type: "numeric", nullable: true },
      })
    );
    expect(twinOf(plan)).toBe(
      `CREATE TABLE "__new_t" (id INTEGER PRIMARY KEY, c numeric, d text)`
    );
  });

  it("leaves the type as written when only the nullability changes", () => {
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE t (id INTEGER PRIMARY KEY, c VarChar ( 36 ) NOT NULL, d text)`
      ),
      request({ to: { type: "varchar(36)", nullable: true } })
    );
    expect(twinOf(plan)).toBe(
      `CREATE TABLE "__new_t" (id INTEGER PRIMARY KEY, c VarChar ( 36 ), d text)`
    );
  });

  it("removes a named NOT NULL with its conflict clause, and leaves comments and a NULL check alone", () => {
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE t (\n  id INTEGER PRIMARY KEY,\n  [c] /* kept */ text CONSTRAINT c_present NOT /* x */ NULL ON CONFLICT REPLACE CHECK (c NOT NULL), -- note\n  d text\n) STRICT`
      ),
      request()
    );
    expect(twinOf(plan)).toBe(
      `CREATE TABLE "__new_t" (\n  id INTEGER PRIMARY KEY,\n  [c] /* kept */ text CHECK (c NOT NULL), -- note\n  d text\n) STRICT`
    );
  });

  it("finds the column by any quoting and case, and not by a longer name or a table constraint", () => {
    const plan = planSqliteConversion(
      facts(
        "CREATE TABLE `t` (id INTEGER PRIMARY KEY, cc text NOT NULL, `C` text NOT NULL, d text, CONSTRAINT c CHECK (cc <> ''))"
      ),
      request()
    );
    expect(twinOf(plan)).toBe(
      "CREATE TABLE \"__new_t\" (id INTEGER PRIMARY KEY, cc text NOT NULL, `C` text, d text, CONSTRAINT c CHECK (cc <> ''))"
    );
  });

  it("adds a declared type to a column written without one, and NOT NULL where the target asks for it", () => {
    const plan = planSqliteConversion(
      facts(`CREATE TABLE t (id INTEGER PRIMARY KEY, c DEFAULT 0, d)`),
      request({
        from: { type: "", nullable: true },
        to: { type: "real", nullable: false },
      })
    );
    expect(twinOf(plan)).toBe(
      `CREATE TABLE "__new_t" (id INTEGER PRIMARY KEY, c real DEFAULT 0 NOT NULL, d)`
    );
  });

  it("copies every stored column but a generated one, which the new table computes again", () => {
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE t (id INTEGER PRIMARY KEY, c text NOT NULL, d text, g text GENERATED ALWAYS AS (upper(c)) STORED)`,
        {
          columns: [
            { name: "id", generated: false, primaryKey: true },
            { name: "c", generated: false, primaryKey: false },
            { name: "d", generated: false, primaryKey: false },
            { name: "g", generated: true, primaryKey: false },
          ],
        }
      ),
      request()
    );
    expect(plan.steps[0]).toContain(
      'INSERT INTO "__new_t" ("id", "c", "d") SELECT "id", "c", "d" FROM "t"'
    );
  });
});

describe("planSqliteConversion: what goes back on the table", () => {
  it("recreates the indexes, its triggers, the views that read it and the triggers that read them", () => {
    const view = (name: string, sql: string) => ({
      type: "view" as const,
      name,
      tableName: name,
      sql,
    });
    const trigger = (name: string, on: string, sql: string) => ({
      type: "trigger" as const,
      name,
      tableName: on,
      sql,
    });
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, c text NOT NULL, d text)`,
        {
          indexes: ["CREATE INDEX orders_c ON orders (c)"],
          objects: [
            view("v1", "CREATE VIEW v1 AS SELECT c FROM ORDERS"),
            view("unrelated", "CREATE VIEW unrelated AS SELECT 1 FROM other"),
            view("v2", "CREATE VIEW v2 AS SELECT c FROM v1"),
            trigger(
              "own",
              "orders",
              "CREATE TRIGGER own AFTER UPDATE ON orders BEGIN SELECT 1; END"
            ),
            trigger(
              "on_v2",
              "v2",
              "CREATE TRIGGER on_v2 INSTEAD OF INSERT ON v2 BEGIN SELECT 1; END"
            ),
            trigger(
              "into_t",
              "log",
              "CREATE TRIGGER into_t AFTER INSERT ON log BEGIN INSERT INTO orders (c) VALUES (new.x); END"
            ),
            trigger(
              "elsewhere",
              "log",
              "CREATE TRIGGER elsewhere AFTER INSERT ON log BEGIN SELECT 1; END"
            ),
          ],
        }
      ),
      request({ table: "orders" })
    );
    // The step starts with the foreign-keys-off guard, then the swap.
    expect(plan.steps).toEqual([
      [
        ...GUARD("orders"),
        'DROP TRIGGER "on_v2"',
        'DROP TRIGGER "into_t"',
        'DROP VIEW "v1"',
        'DROP VIEW "v2"',
        'CREATE TABLE "__new_orders" (id INTEGER PRIMARY KEY, c text, d text)',
        'INSERT INTO "__new_orders" ("id", "c", "d") SELECT "id", "c", "d" FROM "orders"',
        'DROP TABLE "orders"',
        'ALTER TABLE "__new_orders" RENAME TO "orders"',
        "CREATE INDEX orders_c ON orders (c)",
        "CREATE TRIGGER own AFTER UPDATE ON orders BEGIN SELECT 1; END",
        "CREATE VIEW v1 AS SELECT c FROM ORDERS",
        "CREATE VIEW v2 AS SELECT c FROM v1",
        "CREATE TRIGGER on_v2 INSTEAD OF INSERT ON v2 BEGIN SELECT 1; END",
        "CREATE TRIGGER into_t AFTER INSERT ON log BEGIN INSERT INTO orders (c) VALUES (new.x); END",
      ],
    ]);
  });

  it("finds a view that reads the table through a view stored after it", () => {
    // A view recreated later is stored later, so the reader can come first in storage order.
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, c text NOT NULL, d text)`,
        {
          objects: [
            {
              type: "view",
              name: "outer_v",
              tableName: "outer_v",
              sql: "CREATE VIEW outer_v AS SELECT c FROM inner_v",
            },
            {
              type: "view",
              name: "inner_v",
              tableName: "inner_v",
              sql: "CREATE VIEW inner_v AS SELECT c FROM orders",
            },
          ],
        }
      ),
      request({ table: "orders" })
    );
    expect(plan.steps[0]?.filter(s => s.startsWith("DROP VIEW"))).toEqual([
      'DROP VIEW "outer_v"',
      'DROP VIEW "inner_v"',
    ]);
  });

  it("carries an AUTOINCREMENT key's sequence", () => {
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE t (id INTEGER PRIMARY KEY AutoIncrement, c text NOT NULL, d text)`
      ),
      request()
    );
    // First after the foreign-keys-off guard, before the twin exists.
    expect(plan.steps[0]?.[GUARD("t").length]).toMatch(
      /^INSERT INTO sqlite_sequence/
    );
  });
});

describe("planSqliteConversion: what blocks it", () => {
  it("blocks, building nothing, when the stored statement does not show the column", () => {
    const plan = planSqliteConversion(
      facts(`CREATE TABLE t (id INTEGER PRIMARY KEY, d text)`),
      request()
    );
    expect(plan.steps).toEqual([]);
    expect(plan.cannotCarry).toEqual([
      expect.objectContaining({ property: "definition", name: "c" }),
    ]);
  });

  it("blocks when the stored statement has a quote it cannot close", () => {
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE t (id INTEGER PRIMARY KEY, c text DEFAULT 'x, d text)`
      ),
      request()
    );
    expect(plan.cannotCarry).toHaveLength(1);
  });

  it("blocks a column of the primary key, whose type decides whether it is the rowid", () => {
    const plan = planSqliteConversion(
      facts(`CREATE TABLE t (id INTEGER PRIMARY KEY, c text NOT NULL, d text)`),
      request({
        column: "id",
        from: { type: "INTEGER", nullable: false },
        to: { type: "text", nullable: false },
      })
    );
    expect(plan.cannotCarry).toEqual([
      expect.objectContaining({ property: "key", name: "id" }),
    ]);
  });

  it("does not block a primary-key column whose nullability alone changes, which keeps its declared type", () => {
    const plan = planSqliteConversion(
      facts(`CREATE TABLE t (id text PRIMARY KEY NOT NULL, c text, d text)`),
      request({
        column: "id",
        from: { type: "text", nullable: false },
        to: { type: "text", nullable: true },
      })
    );
    expect(plan.cannotCarry).toEqual([]);
    expect(twinOf(plan)).toBe(
      `CREATE TABLE "__new_t" (id text PRIMARY KEY, c text, d text)`
    );
  });

  it("blocks a STRICT table's column becoming a type STRICT does not take, naming the table and the types", () => {
    const plan = planSqliteConversion(
      facts(
        `CREATE TABLE t (id INTEGER PRIMARY KEY, c text NOT NULL, d text) STRICT`
      ),
      request({ to: { type: "varchar(36)", nullable: true } })
    );
    expect(plan.cannotCarry).toEqual([
      expect.objectContaining({ property: "definition", name: "c" }),
    ]);
    const [item] = plan.cannotCarry;
    expect(item.reason).toContain("t is a STRICT table");
    expect(item.reason).toContain("INT, INTEGER, REAL, TEXT, BLOB, ANY");
    expect(item.reason).toContain("varchar(36)");
    expect(item.ownerCan.length).toBeGreaterThan(0);
  });

  it("does not block a STRICT table's column becoming INTEGER, or a type change on a table that is not STRICT", () => {
    // A STRICT type in any case, among other table options.
    const strictInteger = planSqliteConversion(
      facts(
        `CREATE TABLE t (id INTEGER PRIMARY KEY, c text NOT NULL, d text) WITHOUT ROWID, STRICT`
      ),
      request({ to: { type: "integer", nullable: true } })
    );
    expect(strictInteger.cannotCarry).toEqual([]);
    const plain = planSqliteConversion(
      facts(`CREATE TABLE t (id INTEGER PRIMARY KEY, c text NOT NULL, d text)`),
      request({ to: { type: "varchar(36)", nullable: true } })
    );
    expect(plain.cannotCarry).toEqual([]);
    // A column named strict is not the table option.
    const columnNamedStrict = planSqliteConversion(
      facts(
        `CREATE TABLE t (id INTEGER PRIMARY KEY, c text NOT NULL, strict text)`
      ),
      request({ to: { type: "varchar(36)", nullable: true } })
    );
    expect(columnNamedStrict.cannotCarry).toEqual([]);
  });

  it("refuses a target type that is not a plain type name", () => {
    expect(() =>
      planSqliteConversion(
        facts(
          `CREATE TABLE t (id INTEGER PRIMARY KEY, c text NOT NULL, d text)`
        ),
        request({ to: { type: "text); DROP TABLE t; --", nullable: true } })
      )
    ).toThrow();
  });
});

describe("planSqliteConversion: what the new type cannot keep", () => {
  const TABLE_SQL = `CREATE TABLE "t" ("id" integer PRIMARY KEY, "c" text CHECK (length(c) > 0), "d" text, CONSTRAINT "d_check" CHECK (d <> ''), CONSTRAINT "c_named" CHECK ("c" <> 'x'))`;
  const INDEXES = [
    `CREATE INDEX "t_c_lower" ON "t" (lower(c))`,
    `CREATE INDEX "t_c" ON "t" ("c")`,
    `CREATE INDEX "t_c_collate" ON "t" (c COLLATE NOCASE DESC)`,
    `CREATE INDEX "t_d_partial" ON "t" ("d") WHERE c IS NOT NULL`,
    `CREATE INDEX "t_d" ON "t" (d)`,
  ];
  const plan = (to: ConversionRequest["to"]) =>
    planSqliteConversion(facts(TABLE_SQL, { indexes: INDEXES }), {
      ...request(),
      from: { type: "text", nullable: true },
      to,
    });
  const named = (cannotCarry: { property: string; name: string }[]) =>
    cannotCarry.map(item => [item.property, item.name]);

  it("a check or an expression or partial index that reads the column blocks a change to another kind of value", () => {
    const blocked = plan({ type: "integer", nullable: true });
    expect(named(blocked.cannotCarry)).toEqual([
      ["check", "CHECK (length(c) > 0)"],
      ["check", "c_named"],
      ["index", "t_c_lower"],
      ["index", "t_d_partial"],
    ]);
    for (const item of blocked.cannotCarry) {
      expect(item.ownerCan.length).toBeGreaterThan(0);
    }
  });

  it("within one kind of value, or for a nullability change, each is kept", () => {
    expect(plan({ type: "varchar(36)", nullable: true }).cannotCarry).toEqual(
      []
    );
    expect(plan({ type: "text", nullable: false }).cannotCarry).toEqual([]);
  });
});

describe("planSqliteConversion: what a change of affinity cannot keep", () => {
  const TEXT = { type: "text", nullable: true };
  const INTEGER = { type: "integer", nullable: true };
  const VARCHAR = { type: "varchar(36)", nullable: true };
  const named = (cannotCarry: { property: string; name: string }[]) =>
    cannotCarry.map(item => [item.property, item.name]);
  const convert = (
    createSql: string,
    overrides: Partial<SqliteTableFacts>,
    to: ConversionRequest["to"]
  ) =>
    planSqliteConversion(facts(createSql, overrides), {
      ...request(),
      from: TEXT,
      to,
    }).cannotCarry;

  it("a stored generated column that reads the column blocks a type change; a virtual one, or one reading another column, does not", () => {
    const createSql = `CREATE TABLE "t" ("id" integer PRIMARY KEY, "c" text, "d" text, "g" text GENERATED ALWAYS AS (typeof(c)) STORED, "v" text AS (typeof(c)) VIRTUAL, "h" text AS (upper(d)) STORED)`;
    const columns: SqliteTableFacts["columns"] = [
      { name: "id", generated: false, primaryKey: true },
      { name: "c", generated: false, primaryKey: false },
      { name: "d", generated: false, primaryKey: false },
      { name: "g", generated: true, primaryKey: false, storedGenerated: true },
      { name: "v", generated: true, primaryKey: false },
      { name: "h", generated: true, primaryKey: false, storedGenerated: true },
    ];
    expect(named(convert(createSql, { columns }, INTEGER))).toEqual([
      ["generated column", "g"],
    ]);
    expect(
      convert(createSql, { columns }, { ...TEXT, nullable: false })
    ).toEqual([]);
  });

  it("a stored generated column that reads the column through a virtual one blocks a type change", () => {
    const createSql = `CREATE TABLE "t" ("id" integer PRIMARY KEY, "c" text, "v" text AS (typeof(c)) VIRTUAL, "s" text AS (v) STORED, "w" text AS (upper(s)) STORED)`;
    const columns: SqliteTableFacts["columns"] = [
      { name: "id", generated: false, primaryKey: true },
      { name: "c", generated: false, primaryKey: false },
      { name: "v", generated: true, primaryKey: false },
      { name: "s", generated: true, primaryKey: false, storedGenerated: true },
      { name: "w", generated: true, primaryKey: false, storedGenerated: true },
    ];
    // `s` reads `c` through `v`, and `w` through `s`: both are computed again from the new values.
    expect(named(convert(createSql, { columns }, INTEGER))).toEqual([
      ["generated column", "s"],
      ["generated column", "w"],
    ]);
  });

  it("a unique key or a foreign key on the column blocks a change of affinity, naming the key; the same affinity keeps both", () => {
    const createSql = `CREATE TABLE "t" ("id" integer PRIMARY KEY, "c" text UNIQUE REFERENCES "p" ("k"), "d" text)`;
    const keys: Partial<SqliteTableFacts> = {
      uniqueKeys: [
        { name: "UNIQUE (c)", columns: ["c"] },
        { name: "UNIQUE (d)", columns: ["d"] },
      ],
      foreignKeys: [
        { name: "t (c) REFERENCES p (k)", column: "c" },
        { name: "lines (t_c) REFERENCES t (c)", column: "C" },
        { name: "t (d) REFERENCES p (k)", column: "d" },
      ],
    };
    const blocked = convert(createSql, keys, INTEGER);
    expect(named(blocked)).toEqual([
      ["key", "UNIQUE (c)"],
      ["key", "t (c) REFERENCES p (k)"],
      ["key", "lines (t_c) REFERENCES t (c)"],
    ]);
    for (const item of blocked) {
      expect(item.ownerCan.length).toBeGreaterThan(0);
    }
    // text and varchar(36) both take TEXT affinity.
    expect(convert(createSql, keys, VARCHAR)).toEqual([]);
  });
});
