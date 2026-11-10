/**
 * A column conversion changes only the column's type and nullability.
 *
 * Each case builds a table whose converted column carries a default, a comment, a collation and an
 * index that both its old and new type can hold, beside a check, a trigger, a view and another
 * table's foreign key pointing at it. The plan is built from the live table, its statements are
 * run, and the whole table definition is read before and after (and on MySQL after each step of
 * the list conversion): only the type and nullability may differ, and a character set or
 * collation the new type has no place for, which the plan must name as not carried.
 *
 * A plan that dropped the comment, reset the collation or lost the index fails the definition
 * comparison; one that blocked what the new type keeps fails on its `cannotCarry`; one that did not
 * name what it leaves out fails on its `notCarried`. The cases where the new type cannot keep
 * something check that the plan names it and that building the plan changed nothing.
 *
 * PostgreSQL and MySQL run in a database of the test's own; SQLite in memory.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readDialectUrl } from "../../../../database/__tests__/integration/helpers/test-db";
import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../../__tests__/helpers/fresh-database";
import {
  readTableDefinition,
  withNamedChange,
  type QueryRows,
  type TableDefinition,
} from "../../__tests__/helpers/table-definition";
import {
  buildColumnConversion,
  type ColumnConversionPlan,
  type ConversionRequest,
  type NotCarried,
} from "../conversion";
import type { ColumnState } from "../types";

/** One database connection: the Drizzle handle the plan reads through, and raw statements. */
interface Connection {
  dialect: SupportedDialect;
  db: unknown;
  exec(statement: string): Promise<void>;
  query: QueryRows;
  close(): Promise<void>;
}

/**
 * A connection of one, so a MySQL session variable and a PostgreSQL transaction live on the
 * connection the next statement runs on.
 */
async function connect(
  dialect: SupportedDialect,
  scratch: ScratchDatabase | null
): Promise<Connection> {
  if (dialect !== "sqlite" && scratch === null) {
    throw new Error(`${dialect} needs a scratch database`);
  }
  const url = scratch?.url ?? "";
  if (dialect === "postgresql") {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url, max: 1 });
    return {
      dialect,
      db: drizzle({ client: pool }),
      exec: async statement => {
        await pool.query(statement);
      },
      query: async <T>(statement: string) =>
        (await pool.query(statement)).rows as T[],
      close: () => pool.end(),
    };
  }
  if (dialect === "mysql") {
    const { createPool } = await import("mysql2");
    const { drizzle } = await import("drizzle-orm/mysql2");
    const pool = createPool({ uri: url, connectionLimit: 1 });
    return {
      dialect,
      db: drizzle({ client: pool }),
      exec: async statement => {
        await pool.promise().query(statement);
      },
      query: async <T>(statement: string) =>
        (await pool.promise().query(statement))[0] as T[],
      close: () => new Promise<void>(resolve => pool.end(() => resolve())),
    };
  }
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(":memory:");
  // As the SQLite adapter opens every connection, so a rebuild meets the keys it meets there.
  sqlite.pragma("foreign_keys = ON");
  return {
    dialect,
    db: drizzle({ client: sqlite }),
    exec: async statement => {
      sqlite.exec(statement);
    },
    query: async <T>(statement: string) =>
      sqlite.prepare(statement).all() as T[],
    close: async () => {
      sqlite.close();
    },
  };
}

/**
 * Runs a plan's steps as the change that applies differences will: each group in one transaction
 * on PostgreSQL and SQLite; on MySQL each statement commits as it runs. `afterEach` sees the table
 * after every group.
 *
 * A SQLite group runs as the migration runner runs a unit (`executeTransaction`): foreign keys
 * switched off before BEGIN (the pragma does nothing inside a transaction) and confirmed off
 * inside it, `PRAGMA foreign_key_check` before COMMIT, which rolls back a group that leaves a
 * reference dangling, and the setting read beforehand restored afterwards, whatever happened.
 */
async function runPlan(
  connection: Connection,
  plan: ColumnConversionPlan,
  afterStep?: (step: number) => Promise<void>
): Promise<void> {
  for (const [step, group] of plan.steps.entries()) {
    await runGroup(connection, group);
    await afterStep?.(step);
  }
}

/** One group of a plan's statements, run as the dialect commits them. */
async function runGroup(
  connection: Connection,
  group: readonly string[]
): Promise<void> {
  if (connection.dialect === "sqlite") return runSqliteGroup(connection, group);
  if (connection.dialect === "mysql") return runStatements(connection, group);
  return inTransaction(connection, "BEGIN", () =>
    runStatements(connection, group)
  );
}

async function runStatements(
  connection: Connection,
  group: readonly string[]
): Promise<void> {
  for (const statement of group) await connection.exec(statement);
}

/** `work` inside one transaction, committed when it succeeds and rolled back when it throws. */
async function inTransaction(
  connection: Connection,
  begin: string,
  work: () => Promise<void>
): Promise<void> {
  await connection.exec(begin);
  try {
    await work();
    await connection.exec("COMMIT");
  } catch (error) {
    await connection.exec("ROLLBACK");
    throw error;
  }
}

/** A SQLite group as `executeTransaction` runs a unit, its foreign-key setting restored after. */
async function runSqliteGroup(
  connection: Connection,
  group: readonly string[]
): Promise<void> {
  const [{ foreign_keys: enforced }] = await connection.query<{
    foreign_keys: number;
  }>("PRAGMA foreign_keys");
  await connection.exec("PRAGMA foreign_keys = OFF");
  try {
    await inTransaction(connection, "BEGIN IMMEDIATE", async () => {
      const [{ foreign_keys: inside }] = await connection.query<{
        foreign_keys: number;
      }>("PRAGMA foreign_keys");
      if (inside !== 0) throw new Error("foreign keys are still on");
      await runStatements(connection, group);
      const dangling = await connection.query("PRAGMA foreign_key_check");
      if (dangling.length > 0) {
        throw new Error(
          `the step left references dangling: ${JSON.stringify(dangling)}`
        );
      }
    });
  } finally {
    await connection.exec(
      `PRAGMA foreign_keys = ${enforced === 0 ? "OFF" : "ON"}`
    );
  }
}

const TABLE = "conv_t";
const CHILD = "conv_child";
const COMMENT = "the converted column";

/**
 * The table every case converts a column of, with a check, a trigger, a view and a child table's
 * foreign key, none of which reads the converted column `c`. `columnSql` is the column's
 * definition; `indexOn`, where given, the key of an index on it.
 */
function tableStatements(
  dialect: SupportedDialect,
  columnSql: string,
  indexOn: string | null
): string[] {
  const index =
    indexOn === null ? [] : [`CREATE INDEX conv_t_c ON ${TABLE} (${indexOn})`];
  if (dialect === "postgresql") {
    return [
      `CREATE TABLE ${TABLE} (id integer PRIMARY KEY, c ${columnSql}, other integer CONSTRAINT conv_t_other_check CHECK (other >= 0))`,
      `COMMENT ON COLUMN ${TABLE}.c IS '${COMMENT}'`,
      ...index,
      `CREATE TABLE ${CHILD} (id integer PRIMARY KEY, t_id integer CONSTRAINT conv_child_t REFERENCES ${TABLE} (id))`,
      `CREATE FUNCTION conv_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.other := COALESCE(NEW.other, 0); RETURN NEW; END $$`,
      `CREATE TRIGGER conv_trg BEFORE INSERT ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION conv_touch()`,
      `CREATE VIEW conv_v AS SELECT id, other FROM ${TABLE}`,
    ];
  }
  if (dialect === "mysql") {
    return [
      `CREATE TABLE ${TABLE} (id int PRIMARY KEY, c ${columnSql} COMMENT '${COMMENT}', other int, CONSTRAINT conv_t_other_check CHECK (other >= 0))`,
      ...index,
      `CREATE TABLE ${CHILD} (id int PRIMARY KEY, t_id int, CONSTRAINT conv_child_t FOREIGN KEY (t_id) REFERENCES ${TABLE} (id))`,
      `CREATE TRIGGER conv_trg BEFORE INSERT ON ${TABLE} FOR EACH ROW SET NEW.other = COALESCE(NEW.other, 0)`,
      `CREATE VIEW conv_v AS SELECT id, other FROM ${TABLE}`,
    ];
  }
  // A table constraint, which the definition reader lists among the table's checks.
  return [
    `CREATE TABLE ${TABLE} (id integer PRIMARY KEY, c ${columnSql}, other integer, CONSTRAINT conv_t_other_check CHECK (other >= 0))`,
    ...index,
    `CREATE TABLE ${CHILD} (id integer PRIMARY KEY, t_id integer CONSTRAINT conv_child_t REFERENCES ${TABLE} (id))`,
    `CREATE TRIGGER conv_trg AFTER INSERT ON ${TABLE} BEGIN UPDATE ${TABLE} SET other = COALESCE(other, 0) WHERE id = NEW.id; END`,
    `CREATE VIEW conv_v AS SELECT id, other FROM ${TABLE}`,
  ];
}

/** Rows for the table, each value of `c` as SQL, and a child row pointing at the first. */
function rowStatements(values: readonly string[]): string[] {
  return [
    ...values.map(
      (value, i) =>
        `INSERT INTO ${TABLE} (id, c, other) VALUES (${i + 1}, ${value}, ${i})`
    ),
    `INSERT INTO ${CHILD} (id, t_id) VALUES (1, 1)`,
  ];
}

/** Everything the conversion must leave as it was, outside the converted column. */
interface Snapshot {
  table: TableDefinition;
  child: TableDefinition;
  rows: unknown[];
  childRows: unknown[];
}

async function snapshot(connection: Connection): Promise<Snapshot> {
  return {
    table: await readTableDefinition(
      connection.query,
      connection.dialect,
      TABLE
    ),
    child: await readTableDefinition(
      connection.query,
      connection.dialect,
      CHILD
    ),
    rows: await connection.query(`SELECT id, other FROM ${TABLE} ORDER BY id`),
    childRows: await connection.query(
      `SELECT id, t_id FROM ${CHILD} ORDER BY id`
    ),
  };
}

/**
 * What the snapshot should read after the column became `type` and `nullable`: that and nothing
 * else, except a character set or collation the plan names as not carried, which the new column
 * reports as none.
 */
function expectedAfter(
  before: Snapshot,
  change: { type: string; nullable: boolean; notCarried: readonly NotCarried[] }
): Snapshot {
  const named = withNamedChange(before.table, {
    column: "c",
    nullable: change.nullable,
  });
  const gone = new Set(change.notCarried.map(item => item.property));
  return {
    ...before,
    table: {
      ...named,
      columns: named.columns.map(column =>
        column.name !== "c"
          ? column
          : {
              ...column,
              type: change.type,
              charset: gone.has("characterSet") ? null : column.charset,
              collation: gone.has("collation") ? null : column.collation,
            }
      ),
    },
  };
}

/** One known shape a conversion exists for, on one dialect. */
interface Shape {
  name: string;
  columnSql: string;
  indexOn: string | null;
  values: string[];
  from: ColumnState;
  to: ColumnState;
  referenceList?: boolean;
  /** The column's type as the definition reader reports it, after each step. */
  typeAfterStep: string[];
  notCarried: NotCarried[];
}

const SHAPES: Record<SupportedDialect, Shape[]> = {
  postgresql: [
    {
      // A plain btree on text is kept on jsonb, which has a default btree operator class.
      // No default: text has no automatic cast to jsonb.
      name: "a repeater held as text becomes jsonb",
      columnSql: `text COLLATE "C"`,
      indexOn: "c",
      values: [`'[1,2]'`, `'{"a":1}'`, "NULL"],
      from: { type: "text", nullable: true },
      to: { type: "jsonb", nullable: true },
      typeAfterStep: ["jsonb"],
      notCarried: [{ property: "collation", value: "C" }],
    },
    {
      name: "a float held as decimal(10,2) becomes a double",
      columnSql: "numeric(10,2) DEFAULT 1.25",
      indexOn: "c",
      values: ["1.25", "3.5", "NULL"],
      from: { type: "numeric", typeModifier: "10,2", nullable: true },
      to: { type: "float8", nullable: true },
      typeAfterStep: ["double precision"],
      notCarried: [],
    },
    {
      name: "a required relationship becomes nullable",
      columnSql: `text COLLATE "C" NOT NULL DEFAULT 'x'`,
      indexOn: "c",
      values: [`'a'`, `'b'`],
      from: { type: "text", nullable: false },
      to: { type: "text", nullable: true },
      typeAfterStep: ["text"],
      notCarried: [],
    },
    {
      name: "a component list held in a uuid column becomes a JSON list",
      columnSql: "uuid",
      indexOn: "c",
      values: [`'6f1c2a3e-1111-4c2b-9d3e-0a1b2c3d4e5f'`, "NULL"],
      from: { type: "uuid", nullable: true },
      to: { type: "jsonb", nullable: true },
      referenceList: true,
      typeAfterStep: ["jsonb"],
      notCarried: [],
    },
    {
      name: "a component list held in a text column becomes a JSON list",
      columnSql: `text COLLATE "C"`,
      indexOn: "c",
      values: [`'abc'`, `'{"a","b"}'`, `'["x"]'`, "NULL"],
      from: { type: "text", nullable: true },
      to: { type: "jsonb", nullable: true },
      referenceList: true,
      typeAfterStep: ["jsonb"],
      notCarried: [{ property: "collation", value: "C" }],
    },
  ],
  mysql: [
    {
      // JSON takes no plain index and only an expression default.
      name: "a repeater held as text becomes json",
      columnSql:
        "text CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT ('[]')",
      indexOn: null,
      values: [`'[1,2]'`, `'{"a":1}'`, "NULL"],
      from: { type: "text", nullable: true },
      to: { type: "json", nullable: true },
      typeAfterStep: ["json"],
      notCarried: [
        { property: "characterSet", value: "utf8mb4" },
        { property: "collation", value: "utf8mb4_bin" },
      ],
    },
    {
      name: "a float held as decimal(10,2) becomes a double",
      columnSql: "decimal(10,2) DEFAULT 1.25",
      indexOn: "c",
      values: ["1.25", "3.5", "NULL"],
      from: { type: "decimal(10,2)", nullable: true },
      to: { type: "double", nullable: true },
      typeAfterStep: ["double"],
      notCarried: [],
    },
    {
      // A prefix no longer than the new length, which both types keep as it is.
      name: "a text column the legacy map left becomes varchar(255)",
      columnSql: "text COLLATE utf8mb4_bin DEFAULT ('x')",
      indexOn: "c(20)",
      values: [`'a'`, `'bb'`, "NULL"],
      from: { type: "text", nullable: true },
      to: { type: "varchar(255)", nullable: true },
      typeAfterStep: ["varchar(255)"],
      notCarried: [],
    },
    {
      name: "a text column the legacy map left becomes varchar(36)",
      columnSql: "text COLLATE utf8mb4_bin DEFAULT ('x')",
      indexOn: "c(20)",
      values: [`'a'`, `'bb'`, "NULL"],
      from: { type: "text", nullable: true },
      to: { type: "varchar(36)", nullable: true },
      typeAfterStep: ["varchar(36)"],
      notCarried: [],
    },
    {
      name: "a required relationship becomes nullable",
      columnSql: "varchar(36) COLLATE utf8mb4_bin NOT NULL DEFAULT 'x'",
      indexOn: "c",
      values: [`'a'`, `'b'`],
      from: { type: "varchar(36)", nullable: false },
      to: { type: "varchar(36)", nullable: true },
      typeAfterStep: ["varchar(36)"],
      notCarried: [],
    },
    {
      // Widened to text, rewritten, retyped to json: each step compared on its own.
      name: "a component list held in a varchar(36) column becomes a JSON list",
      columnSql: "varchar(36) COLLATE utf8mb4_bin",
      indexOn: null,
      values: [`'abc'`, `'["x"]'`, "NULL"],
      from: { type: "varchar(36)", nullable: true },
      to: { type: "json", nullable: true },
      referenceList: true,
      typeAfterStep: ["text", "text", "json"],
      notCarried: [
        { property: "characterSet", value: "utf8mb4" },
        { property: "collation", value: "utf8mb4_bin" },
      ],
    },
  ],
  sqlite: [
    {
      name: "a required relationship becomes nullable",
      columnSql: "text NOT NULL DEFAULT 'x' COLLATE NOCASE",
      indexOn: "c",
      values: [`'a'`, `'b'`],
      from: { type: "text", nullable: false },
      to: { type: "text", nullable: true },
      // SQLite reports a declared type it knows upper-cased (3.53: `text` reads as TEXT).
      typeAfterStep: ["TEXT"],
      notCarried: [],
    },
  ],
};

/** PostgreSQL's file for the table's rows, which a rewrite replaces. */
async function relfilenode(connection: Connection): Promise<string> {
  const [row] = await connection.query<{ node: string }>(
    `SELECT relfilenode::text AS node FROM pg_class WHERE oid = to_regclass('${TABLE}')`
  );
  return row.node;
}

const request = (
  dialect: SupportedDialect,
  shape: Pick<Shape, "from" | "to" | "referenceList">
): ConversionRequest => ({
  dialect,
  table: TABLE,
  column: "c",
  from: shape.from,
  to: shape.to,
  ...(shape.referenceList === true ? { referenceList: true } : {}),
});

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

describe.each(DIALECTS)("a column conversion on %s", dialect => {
  const available = dialect === "sqlite" || readDialectUrl(dialect) !== null;
  // Whether this run can reach each database, so a case written for one skips on the others.
  const onPostgres = available && dialect === "postgresql";
  const onMysql = available && dialect === "mysql";
  const onSqlite = available && dialect === "sqlite";
  const onServer = onPostgres || onMysql;
  let scratch: ScratchDatabase | null = null;
  let connection: Connection;

  beforeEach(async () => {
    if (!available) return;
    scratch =
      dialect === "sqlite"
        ? null
        : await createScratchDatabase(dialect, "conv_keeps");
    connection = await connect(dialect, scratch);
  });

  afterEach(async () => {
    if (!available) return;
    await connection.close();
    await scratch?.drop();
    scratch = null;
  });

  async function build(shape: Shape): Promise<void> {
    for (const statement of [
      ...tableStatements(dialect, shape.columnSql, shape.indexOn),
      ...rowStatements(shape.values),
    ]) {
      await connection.exec(statement);
    }
  }

  it.skipIf(!available).each(SHAPES[dialect])(
    "$name: only the type and nullability change",
    async shape => {
      await build(shape);
      const before = await snapshot(connection);
      // The fixture reaches every property the conversion must keep.
      const column = before.table.columns.find(item => item.name === "c");
      if (shape.columnSql.includes("DEFAULT")) {
        expect(column?.default ?? null).not.toBeNull();
      }
      if (dialect !== "sqlite") expect(column?.comment).toBe(COMMENT);
      expect(before.table.checks.length).toBe(1);
      expect(before.table.triggers.map(item => item.name)).toEqual([
        "conv_trg",
      ]);
      expect(before.table.views.map(item => item.name)).toEqual(["conv_v"]);
      expect(before.child.foreignKeys.length).toBe(1);
      if (shape.indexOn !== null) {
        expect(before.table.indexes.map(item => item.name)).toContain(
          "conv_t_c"
        );
      }

      const plan = await buildColumnConversion(
        connection.db,
        request(dialect, shape)
      );
      expect(plan.cannotCarry).toEqual([]);
      expect(plan.notCarried).toEqual(shape.notCarried);
      expect(plan.steps.length).toBe(shape.typeAfterStep.length);

      const fileBefore =
        dialect === "postgresql" ? await relfilenode(connection) : null;
      const last = shape.typeAfterStep.length - 1;
      await runPlan(connection, plan, async step => {
        const final = step === last;
        expect(await snapshot(connection)).toEqual(
          expectedAfter(before, {
            type: shape.typeAfterStep[step],
            nullable: final ? shape.to.nullable : shape.from.nullable,
            // A step before the last keeps a string type, which keeps the character set.
            notCarried: final ? shape.notCarried : [],
          })
        );
      });
      if (dialect === "postgresql") {
        // Whether the plan says the table is rewritten is what PostgreSQL did.
        expect((await relfilenode(connection)) !== fileBefore).toBe(
          plan.rewritesTable
        );
      }
    }
  );

  it.skipIf(!onPostgres)(
    "a view that reads the column and a default the new type cannot hold block it",
    async () => {
      await build({
        ...SHAPES.postgresql[0],
        columnSql: `text DEFAULT '[]'`,
        indexOn: null,
      });
      await connection.exec(
        `CREATE VIEW conv_reads_c AS SELECT c FROM ${TABLE}`
      );
      const before = await snapshot(connection);
      const plan = await buildColumnConversion(
        connection.db,
        request(dialect, {
          from: { type: "text", nullable: true },
          to: { type: "jsonb", nullable: true },
        })
      );
      expect(plan.cannotCarry.map(item => [item.property, item.name])).toEqual([
        ["view", "conv_reads_c"],
        ["default", "c"],
      ]);
      for (const item of plan.cannotCarry) {
        expect(item.ownerCan.length).toBeGreaterThan(0);
      }
      // Building the plan ran nothing.
      expect(await snapshot(connection)).toEqual(before);
    }
  );

  it.skipIf(!onMysql)(
    "an index on a text column becoming JSON blocks it",
    async () => {
      await build({
        ...SHAPES.mysql[0],
        indexOn: "c(20)",
      });
      const before = await snapshot(connection);
      const plan = await buildColumnConversion(
        connection.db,
        request(dialect, SHAPES.mysql[0])
      );
      expect(plan.cannotCarry.map(item => [item.property, item.name])).toEqual([
        ["index", "conv_t_c"],
      ]);
      expect(plan.cannotCarry[0].ownerCan.length).toBeGreaterThan(0);
      expect(await snapshot(connection)).toEqual(before);
    }
  );

  it.skipIf(!onMysql)(
    "a text column keyed by a 191-character prefix: blocked becoming varchar(36), kept becoming varchar(255)",
    async () => {
      // On a string no longer than the prefix MySQL would key the whole column instead, changing
      // the index; on a longer one the prefix stays as it is.
      const shape: Shape = {
        ...SHAPES.mysql[2],
        indexOn: "c(191)",
      };
      await build(shape);
      const before = await snapshot(connection);
      expect(
        before.table.indexes.find(item => item.name === "conv_t_c")?.columns
      ).toEqual(["c(191)"]);

      const blocked = await buildColumnConversion(
        connection.db,
        request(dialect, {
          from: shape.from,
          to: { type: "varchar(36)", nullable: true },
        })
      );
      expect(
        blocked.cannotCarry.map(item => [item.property, item.name])
      ).toEqual([["index", "conv_t_c"]]);
      expect(blocked.cannotCarry[0].ownerCan.length).toBeGreaterThan(0);
      // Building the plan ran nothing.
      expect(await snapshot(connection)).toEqual(before);

      const kept = await buildColumnConversion(
        connection.db,
        request(dialect, shape)
      );
      expect(kept.cannotCarry).toEqual([]);
      expect(kept.notCarried).toEqual([]);
      await runPlan(connection, kept);
      const after = await snapshot(connection);
      expect(
        after.table.indexes.find(item => item.name === "conv_t_c")?.columns
      ).toEqual(["c(191)"]);
      expect(after).toEqual(
        expectedAfter(before, {
          type: "varchar(255)",
          nullable: true,
          notCarried: [],
        })
      );
    }
  );

  it.skipIf(!onServer)(
    "a text column with a non-default collation and no index becomes JSON, its collation named as not carried",
    async () => {
      const shape: Shape =
        dialect === "postgresql"
          ? { ...SHAPES.postgresql[0], indexOn: null }
          : SHAPES.mysql[0];
      await build(shape);
      const before = await snapshot(connection);
      const plan = await buildColumnConversion(
        connection.db,
        request(dialect, shape)
      );
      expect(plan.cannotCarry).toEqual([]);
      expect(plan.notCarried).toEqual(
        dialect === "postgresql"
          ? [{ property: "collation", value: "C" }]
          : [
              { property: "characterSet", value: "utf8mb4" },
              { property: "collation", value: "utf8mb4_bin" },
            ]
      );
      await runPlan(connection, plan);
      expect(await snapshot(connection)).toEqual(
        expectedAfter(before, {
          type: shape.typeAfterStep[0],
          nullable: true,
          notCarried: plan.notCarried,
        })
      );
    }
  );

  it.skipIf(!onPostgres)(
    'a column with COLLATE "C" becoming a type that takes a collation keeps "C"',
    async () => {
      const shape: Shape = {
        name: "text to varchar",
        columnSql: `text COLLATE "C" DEFAULT 'x'`,
        indexOn: "c",
        values: [`'a'`, "NULL"],
        from: { type: "text", nullable: true },
        to: { type: "varchar", typeModifier: "255", nullable: true },
        typeAfterStep: ["character varying(255)"],
        notCarried: [],
      };
      await build(shape);
      const before = await snapshot(connection);
      expect(
        before.table.columns.find(item => item.name === "c")?.collation
      ).toBe("C");
      const plan = await buildColumnConversion(
        connection.db,
        request(dialect, shape)
      );
      expect(plan.cannotCarry).toEqual([]);
      expect(plan.notCarried).toEqual([]);
      await runPlan(connection, plan);
      const after = await snapshot(connection);
      expect(
        after.table.columns.find(item => item.name === "c")?.collation
      ).toBe("C");
      expect(after).toEqual(
        expectedAfter(before, {
          type: "character varying(255)",
          nullable: true,
          notCarried: [],
        })
      );
    }
  );

  it.skipIf(!onPostgres).each([
    {
      property: "generated column",
      name: "conv_g",
      statement: `ALTER TABLE ${TABLE} ADD COLUMN conv_g numeric GENERATED ALWAYS AS (c * 2) STORED`,
      refusal: /generated column/,
    },
    {
      property: "policy",
      name: "conv_pol",
      statement: `CREATE POLICY conv_pol ON ${TABLE} USING (c >= 0)`,
      refusal: /policy/,
    },
  ])(
    "a $property that reads the column blocks it, as PostgreSQL refuses the type change under one",
    async ({ property, name, statement, refusal }) => {
      const shape = SHAPES.postgresql[1];
      await build(shape);
      await connection.exec(statement);
      const before = await snapshot(connection);
      const plan = await buildColumnConversion(
        connection.db,
        request(dialect, shape)
      );
      expect(plan.cannotCarry.map(item => [item.property, item.name])).toEqual([
        [property, name],
      ]);
      expect(plan.cannotCarry[0].ownerCan.length).toBeGreaterThan(0);
      // Building the plan ran nothing.
      expect(await snapshot(connection)).toEqual(before);
      // The block is what PostgreSQL does: its statements are refused while the object reads `c`.
      await expect(runPlan(connection, plan)).rejects.toThrow(refusal);
    }
  );

  it.skipIf(!onPostgres)(
    'a mixed-case table keeps the converted column\'s COLLATE "C"',
    async () => {
      // The table is found by its quoted name: read unquoted, PostgreSQL folds it to lower case,
      // finds no table, and the type change would reset the collation to the new type's default.
      const table = "ConvMixed";
      await connection.exec(
        `CREATE TABLE "${table}" (id integer PRIMARY KEY, c text COLLATE "C")`
      );
      const collation = async (): Promise<string | null> => {
        const [row] = await connection.query<{ name: string | null }>(
          `SELECT collation_name AS name FROM information_schema.columns
           WHERE table_name = '${table}' AND column_name = 'c'`
        );
        return row.name;
      };
      expect(await collation()).toBe("C");
      const plan = await buildColumnConversion(connection.db, {
        dialect,
        table,
        column: "c",
        from: { type: "text", nullable: true },
        to: { type: "varchar", typeModifier: "255", nullable: true },
      });
      expect(plan.cannotCarry).toEqual([]);
      await runPlan(connection, plan);
      expect(await collation()).toBe("C");
    }
  );

  it.skipIf(!onMysql)(
    "a SET NULL key out of the column blocks making it NOT NULL, as MySQL refuses it (1830)",
    async () => {
      const shape: Shape = {
        name: "a relationship held as varchar(36) becomes required",
        columnSql: "varchar(36)",
        indexOn: null,
        values: [`'a'`],
        from: { type: "varchar(36)", nullable: true },
        to: { type: "varchar(36)", nullable: false },
        typeAfterStep: ["varchar(36)"],
        notCarried: [],
      };
      await build(shape);
      await connection.exec(
        "CREATE TABLE conv_parent (id varchar(36) PRIMARY KEY)"
      );
      await connection.exec("INSERT INTO conv_parent (id) VALUES ('a')");
      await connection.exec(
        `ALTER TABLE ${TABLE} ADD CONSTRAINT conv_c_parent FOREIGN KEY (c) REFERENCES conv_parent (id) ON DELETE SET NULL`
      );
      const before = await snapshot(connection);
      const plan = await buildColumnConversion(
        connection.db,
        request(dialect, shape)
      );
      expect(plan.cannotCarry.map(item => [item.property, item.name])).toEqual([
        ["key", "conv_c_parent"],
      ]);
      expect(plan.cannotCarry[0].ownerCan.length).toBeGreaterThan(0);
      expect(await snapshot(connection)).toEqual(before);
      await expect(runPlan(connection, plan)).rejects.toThrow(
        /cannot be NOT NULL/
      );
    }
  );

  it.skipIf(!onMysql)(
    "a check and a functional key part that read the column are read from this server's catalog",
    async () => {
      // MySQL 8.0.16 reports both; a read that took this server for one without them would find
      // neither and convert the column under them.
      await build({ ...SHAPES.mysql[0], indexOn: null });
      await connection.exec(
        `ALTER TABLE ${TABLE} ADD CONSTRAINT conv_c_check CHECK (c <> '')`
      );
      await connection.exec(
        `CREATE INDEX conv_c_fn ON ${TABLE} ((CHAR_LENGTH(c)))`
      );
      const plan = await buildColumnConversion(
        connection.db,
        request(dialect, SHAPES.mysql[0])
      );
      expect(plan.cannotCarry.map(item => [item.property, item.name])).toEqual([
        ["index", "conv_c_fn"],
        ["check", "conv_c_check"],
      ]);
    }
  );

  /** The plan for converting `table`'s column, as `[property, name]` pairs of what it cannot keep. */
  async function blockedBy(
    table: string,
    column: string,
    from: ColumnState,
    to: ColumnState
  ): Promise<{ plan: ColumnConversionPlan; named: [string, string][] }> {
    const plan = await buildColumnConversion(connection.db, {
      dialect,
      table,
      column,
      from,
      to,
    });
    for (const item of plan.cannotCarry) {
      expect(item.ownerCan.length).toBeGreaterThan(0);
    }
    return {
      plan,
      named: plan.cannotCarry.map(item => [item.property, item.name]),
    };
  }

  it.skipIf(!onPostgres)(
    "an identity column becoming text blocks it, as PostgreSQL refuses the type change",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_ident (c integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, d text)"
      );
      const { plan, named } = await blockedBy(
        "conv_ident",
        "c",
        { type: "int4", nullable: false },
        { type: "text", nullable: false }
      );
      // The column is also the primary key, and integer to text is not among the changes that
      // keep a unique key's values apart, so the key is named too.
      expect(named).toEqual([
        ["definition", "c"],
        ["key", "conv_ident_pkey"],
      ]);
      await expect(runPlan(connection, plan)).rejects.toThrow(/identity/);
      // Another integer keeps it.
      expect(
        (
          await blockedBy(
            "conv_ident",
            "c",
            { type: "int4", nullable: false },
            { type: "int8", nullable: false }
          )
        ).named
      ).toEqual([]);
    }
  );

  it.skipIf(!onPostgres).each([
    {
      shape: "inheritance children",
      statements: [
        "CREATE TABLE conv_tree (id integer, c text)",
        "CREATE TABLE conv_tree_kid (extra integer) INHERITS (conv_tree)",
      ],
      table: "conv_tree",
    },
    {
      shape: "partitions",
      statements: [
        "CREATE TABLE conv_tree (id integer, c text) PARTITION BY LIST (id)",
        "CREATE TABLE conv_tree_kid PARTITION OF conv_tree FOR VALUES IN (1)",
      ],
      table: "conv_tree",
    },
    {
      shape: "a column inherited from a parent",
      statements: [
        "CREATE TABLE conv_tree (id integer, c text)",
        "CREATE TABLE conv_tree_kid (extra integer) INHERITS (conv_tree)",
      ],
      table: "conv_tree_kid",
    },
  ])(
    "a table with $shape blocks any change of the column, nullability included",
    async ({ statements, table }) => {
      for (const statement of statements) await connection.exec(statement);
      const kid = async () =>
        connection.query(
          `SELECT column_name, data_type, is_nullable FROM information_schema.columns
           WHERE table_name = 'conv_tree_kid' ORDER BY ordinal_position`
        );
      const kidBefore = await kid();
      for (const to of [
        { type: "varchar", typeModifier: "255", nullable: true },
        { type: "text", nullable: false },
      ]) {
        const { named } = await blockedBy(
          table,
          "c",
          { type: "text", nullable: true },
          to
        );
        expect(named).toEqual([["definition", "c"]]);
      }
      // Building the plans changed no table in the tree.
      expect(await kid()).toEqual(kidBefore);
    }
  );

  it.skipIf(!onMysql)(
    "a primary-key column becoming JSON blocks it as the key, as MySQL refuses it",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_pk (c varchar(36) PRIMARY KEY, d int)"
      );
      const { plan, named } = await blockedBy(
        "conv_pk",
        "c",
        { type: "varchar(36)", nullable: false },
        { type: "json", nullable: false }
      );
      expect(named).toEqual([["key", "PRIMARY"]]);
      await expect(runPlan(connection, plan)).rejects.toThrow(/JSON/);
    }
  );

  it.skipIf(!onMysql)(
    "an AUTO_INCREMENT column becoming varchar blocks it, as MySQL refuses it",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_ai (c int AUTO_INCREMENT PRIMARY KEY, d int)"
      );
      const { plan, named } = await blockedBy(
        "conv_ai",
        "c",
        { type: "int", nullable: false },
        { type: "varchar(36)", nullable: false }
      );
      // The column is also the primary key, named as a unique key the change can merge.
      expect(named).toEqual([
        ["definition", "c"],
        ["key", "PRIMARY"],
      ]);
      await expect(runPlan(connection, plan)).rejects.toThrow(
        /Incorrect column specifier/
      );
      expect(
        (
          await blockedBy(
            "conv_ai",
            "c",
            { type: "int", nullable: false },
            { type: "bigint", nullable: false }
          )
        ).named
      ).toEqual([]);
    }
  );

  it.skipIf(!onSqlite)(
    "a stored generated column that reads the column blocks a type change; a virtual one does not",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_gen (id integer PRIMARY KEY, c text, g text GENERATED ALWAYS AS (typeof(c)) STORED, v text AS (typeof(c)) VIRTUAL)"
      );
      const { named } = await blockedBy(
        "conv_gen",
        "c",
        { type: "text", nullable: true },
        { type: "integer", nullable: true }
      );
      expect(named).toEqual([["generated column", "g"]]);
    }
  );

  it.skipIf(!onSqlite)(
    "a unique key and foreign keys on the column, read from the catalog, block a change of affinity; the same affinity keeps them",
    async () => {
      await connection.exec("CREATE TABLE conv_parent (k text PRIMARY KEY)");
      await connection.exec(
        "CREATE TABLE conv_u (id integer PRIMARY KEY, c text UNIQUE REFERENCES conv_parent (k))"
      );
      await connection.exec(
        "CREATE TABLE conv_uc (id integer PRIMARY KEY, c_ref text REFERENCES conv_u (c))"
      );
      const { named } = await blockedBy(
        "conv_u",
        "c",
        { type: "text", nullable: true },
        { type: "integer", nullable: true }
      );
      expect(named).toEqual([
        ["key", "UNIQUE (c)"],
        ["key", "conv_u (c) REFERENCES conv_parent (k)"],
        ["key", "conv_uc (c_ref) REFERENCES conv_u (c)"],
      ]);
      expect(
        (
          await blockedBy(
            "conv_u",
            "c",
            { type: "text", nullable: true },
            { type: "varchar(36)", nullable: true }
          )
        ).named
      ).toEqual([]);
    }
  );

  it.skipIf(!onPostgres)(
    "a column carried only in an index's INCLUDE list keeps the index across a type change",
    async () => {
      // An INCLUDE column has no operator class, so it is not judged as a key.
      await build({ ...SHAPES.postgresql[0], indexOn: null });
      await connection.exec(
        `CREATE INDEX conv_t_inc ON ${TABLE} (id) INCLUDE (c)`
      );
      const plan = await buildColumnConversion(
        connection.db,
        request(dialect, SHAPES.postgresql[0])
      );
      expect(plan.cannotCarry).toEqual([]);
      await runPlan(connection, plan);
      const after = await snapshot(connection);
      expect(after.table.indexes.map(item => item.name)).toContain(
        "conv_t_inc"
      );
    }
  );

  it.skipIf(!onMysql)(
    "a foreign key from a table in another schema into the column blocks a type change",
    async () => {
      const [{ name: database }] = await connection.query<{ name: string }>(
        "SELECT DATABASE() AS name"
      );
      const other = `${database}_x`;
      await connection.exec(
        "CREATE TABLE conv_ref (c varchar(36) PRIMARY KEY, d int)"
      );
      await connection.exec(`CREATE DATABASE \`${other}\``);
      try {
        await connection.exec(
          `CREATE TABLE \`${other}\`.conv_child_x (id int PRIMARY KEY, ref varchar(36), CONSTRAINT conv_x_ref FOREIGN KEY (ref) REFERENCES \`${database}\`.conv_ref (c))`
        );
        const plan = await buildColumnConversion(connection.db, {
          dialect,
          table: "conv_ref",
          column: "c",
          from: { type: "varchar(36)", nullable: false },
          to: { type: "varchar(255)", nullable: false },
        });
        expect(
          plan.cannotCarry.map(item => [item.property, item.name])
        ).toEqual([["key", "conv_x_ref"]]);
        expect(plan.cannotCarry[0].reason).toContain(`${other}.conv_child_x`);
        // MySQL refuses the change while the other schema's key names the column.
        await expect(runPlan(connection, plan)).rejects.toThrow(/foreign key/i);
      } finally {
        await connection.exec(`DROP DATABASE IF EXISTS \`${other}\``);
      }
    }
  );

  it.skipIf(!onPostgres)(
    "a check and an expression index PostgreSQL refuses against the new type block it, though the kind of value stays",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_num (id integer PRIMARY KEY, c numeric(10,2) CONSTRAINT conv_c_even CHECK (c % 2 = 0) CONSTRAINT conv_c_positive CHECK (c >= 0))"
      );
      await connection.exec("CREATE INDEX conv_c_mod ON conv_num ((c % 2))");
      const tablesBefore = await connection.query(
        "SELECT relname FROM pg_class WHERE relpersistence = 't' ORDER BY relname"
      );
      const { plan, named } = await blockedBy(
        "conv_num",
        "c",
        { type: "numeric", typeModifier: "10,2", nullable: true },
        { type: "float8", nullable: true }
      );
      expect(named).toEqual([
        ["index", "conv_c_mod"],
        ["check", "conv_c_even"],
      ]);
      expect(plan.cannotCarry[0].reason).toContain("operator does not exist");
      // The copy was made and rolled back: no temporary table is left.
      expect(
        await connection.query(
          "SELECT relname FROM pg_class WHERE relpersistence = 't' ORDER BY relname"
        )
      ).toEqual(tablesBefore);
      // What the probe says is what PostgreSQL does to the real table.
      await expect(runPlan(connection, plan)).rejects.toThrow(
        /operator does not exist/
      );
    }
  );

  it.skipIf(!onPostgres)(
    "a check PostgreSQL accepts against the new type keeps the conversion, and it runs",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_len (id integer PRIMARY KEY, c varchar(36) CONSTRAINT conv_c_filled CHECK (length(c) > 0))"
      );
      await connection.exec("INSERT INTO conv_len VALUES (1, 'a')");
      const { plan, named } = await blockedBy(
        "conv_len",
        "c",
        { type: "varchar", typeModifier: "36", nullable: true },
        { type: "varchar", typeModifier: "255", nullable: true }
      );
      expect(named).toEqual([]);
      await runPlan(connection, plan);
      const [row] = await connection.query<{ type: string }>(
        "SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'conv_len'::regclass AND attname = 'c'"
      );
      expect(row.type).toBe("character varying(255)");
    }
  );

  it.skipIf(!onPostgres)(
    "where the copy cannot be made, a check on the column blocks every type change, saying why",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_ro (id integer PRIMARY KEY, c varchar(36) CONSTRAINT conv_ro_filled CHECK (length(c) > 0))"
      );
      // A read-only session, as on a replica: PostgreSQL refuses CREATE TEMP TABLE there.
      await connection.exec("SET default_transaction_read_only = on");
      const { named, plan } = await blockedBy(
        "conv_ro",
        "c",
        { type: "varchar", typeModifier: "36", nullable: true },
        { type: "varchar", typeModifier: "255", nullable: true }
      );
      expect(named).toEqual([["check", "conv_ro_filled"]]);
      expect(plan.cannotCarry[0].reason).toContain("read-only transaction");
    }
  );

  it.skipIf(!onSqlite)(
    "a stored generated column that reads the column through a virtual one blocks a type change",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_gen2 (id integer PRIMARY KEY, c text, v text AS (typeof(c)) VIRTUAL, s text AS (v) STORED)"
      );
      const { named } = await blockedBy(
        "conv_gen2",
        "c",
        { type: "text", nullable: true },
        { type: "integer", nullable: true }
      );
      expect(named).toEqual([["generated column", "s"]]);
    }
  );

  it.skipIf(!onPostgres)(
    "an expression index whose other keys carry an operator class and an order is tried as it is, not refused for its syntax",
    async () => {
      // PostgreSQL prints a key alone without its operator class, collation or order, so the
      // probe's copy of the index is valid syntax; the real index keeps all three.
      await connection.exec(
        "CREATE TABLE conv_dec (id integer PRIMARY KEY, c varchar(36))"
      );
      await connection.exec(
        "CREATE INDEX conv_dec_i ON conv_dec (c text_pattern_ops, (length(c)) DESC, id DESC) WHERE c <> ''"
      );
      const { plan, named } = await blockedBy(
        "conv_dec",
        "c",
        { type: "varchar", typeModifier: "36", nullable: true },
        { type: "varchar", typeModifier: "255", nullable: true }
      );
      expect(named).toEqual([]);
      await runPlan(connection, plan);
      const [row] = await connection.query<{ definition: string }>(
        "SELECT pg_get_indexdef('conv_dec_i'::regclass) AS definition"
      );
      expect(row.definition).toContain("text_pattern_ops");
      expect(row.definition).toContain("DESC");
    }
  );

  it.skipIf(!onPostgres)(
    "a unique key blocks a change that can make two values equal, and keeps one that cannot",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_uq (id integer PRIMARY KEY, j text UNIQUE, u text UNIQUE, n numeric(10,2) UNIQUE, v varchar(36) UNIQUE, i integer UNIQUE)"
      );
      // Two spellings of one JSON value: distinct as text, one value as jsonb.
      await connection.exec(
        `INSERT INTO conv_uq (id, j) VALUES (1, '{"a":1}'), (2, '{ "a": 1 }')`
      );
      const TEXT = { type: "text", nullable: true };
      const NUMERIC = { type: "numeric", typeModifier: "10,2", nullable: true };
      const toJson = await blockedBy("conv_uq", "j", TEXT, {
        type: "jsonb",
        nullable: true,
      });
      expect(toJson.named).toEqual([["key", "conv_uq_j_key"]]);
      // The block is what PostgreSQL does: rebuilding the unique index meets the two as one.
      await expect(runPlan(connection, toJson.plan)).rejects.toThrow(
        /could not create unique index/
      );
      for (const [column, from, to, key] of [
        ["u", TEXT, { type: "uuid", nullable: true }, "conv_uq_u_key"],
        [
          "n",
          NUMERIC,
          { type: "numeric", typeModifier: "10,1", nullable: true },
          "conv_uq_n_key",
        ],
      ] as const) {
        expect((await blockedBy("conv_uq", column, from, to)).named).toEqual([
          ["key", key],
        ]);
      }
      for (const [column, from, to] of [
        [
          "v",
          { type: "varchar", typeModifier: "36", nullable: true },
          { type: "varchar", typeModifier: "255", nullable: true },
        ],
        [
          "i",
          { type: "int4", nullable: true },
          { type: "int8", nullable: true },
        ],
        [
          "n",
          NUMERIC,
          { type: "numeric", typeModifier: "12,2", nullable: true },
        ],
      ] as const) {
        expect((await blockedBy("conv_uq", column, from, to)).named).toEqual(
          []
        );
      }
    }
  );

  it.skipIf(!onMysql)(
    "a unique key blocks decimal becoming double, and keeps a wider decimal",
    async () => {
      await connection.exec(
        "CREATE TABLE conv_uqm (id int PRIMARY KEY, d decimal(10,2), i int, CONSTRAINT conv_uqm_d UNIQUE (d), CONSTRAINT conv_uqm_i UNIQUE (i))"
      );
      const DECIMAL = { type: "decimal(10,2)", nullable: true };
      expect(
        (
          await blockedBy("conv_uqm", "d", DECIMAL, {
            type: "double",
            nullable: true,
          })
        ).named
      ).toEqual([["key", "conv_uqm_d"]]);
      expect(
        (
          await blockedBy("conv_uqm", "d", DECIMAL, {
            type: "decimal(14,2)",
            nullable: true,
          })
        ).named
      ).toEqual([]);
      expect(
        (
          await blockedBy(
            "conv_uqm",
            "i",
            { type: "int", nullable: true },
            { type: "bigint", nullable: true }
          )
        ).named
      ).toEqual([]);
    }
  );
});
