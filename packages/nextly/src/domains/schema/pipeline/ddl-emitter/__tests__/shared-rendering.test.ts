// The dev-push emitters render tables and indexes through the migration
// templates, so a table pushed in development and the same table created by a
// migration are the same DDL.
//
// Each case below is one the emitters used to get wrong with a spelling of
// their own: an expression index rendered as `()`, a partial index without
// its WHERE, a serial key with no sequence or AUTO_INCREMENT, and on
// PostgreSQL a primary key granted only to a column named `id`. The
// integration round trip (`diff/__tests__/emitted-table-roundtrip`) runs the
// same shapes on real servers.

import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../../errors/nextly-error";

import type { IndexSpec, Operation, TableSpec } from "../../diff/types";
import { generateSQL } from "../../sql-templates";
import { emitAdditiveDdl } from "../additive";
import { emitDdl } from "../index";
import { emitPostgresDdl } from "../postgres";

const expressionIndex: IndexSpec = {
  name: "idx_fx__users_email_lower",
  columns: [],
  unique: false,
  expression: "lower(email)",
};
const partialUnique: IndexSpec = {
  name: "uq_fx__users_email_live",
  columns: ["email"],
  unique: true,
  where: "deleted_at IS NULL",
};

const addIndex = (index: IndexSpec): Operation => ({
  type: "add_index",
  tableName: "fx__users",
  index,
});

describe("emitted indexes carry their expression and predicate", () => {
  it("postgresql: an expression index names its expression", () => {
    expect(emitPostgresDdl(addIndex(expressionIndex))).toEqual([
      `CREATE INDEX IF NOT EXISTS "idx_fx__users_email_lower" ON "fx__users" ((lower(email)))`,
    ]);
  });

  it("postgresql: a partial unique index keeps its WHERE", () => {
    expect(emitPostgresDdl(addIndex(partialUnique))).toEqual([
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_fx__users_email_live" ON "fx__users" ("email") WHERE deleted_at IS NULL`,
    ]);
  });

  it("sqlite: both shapes, as on postgresql", () => {
    expect(emitAdditiveDdl(addIndex(expressionIndex), "sqlite")).toEqual([
      `CREATE INDEX IF NOT EXISTS "idx_fx__users_email_lower" ON "fx__users" ((lower(email)))`,
    ]);
    expect(emitAdditiveDdl(addIndex(partialUnique), "sqlite")).toEqual([
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_fx__users_email_live" ON "fx__users" ("email") WHERE deleted_at IS NULL`,
    ]);
  });

  it("mysql: a new table's expression index is a functional key part, and a partial one is refused", () => {
    const table = (index: IndexSpec): Operation => ({
      type: "add_table",
      table: {
        name: "fx__users",
        columns: [
          {
            name: "id",
            type: "varchar(36)",
            nullable: false,
            primaryKey: true,
          },
          { name: "email", type: "varchar(100)", nullable: true },
          { name: "deleted_at", type: "datetime", nullable: true },
        ],
        indexes: [index],
      },
    });
    expect(emitAdditiveDdl(table(expressionIndex), "mysql")[1]).toBe(
      "CREATE INDEX `idx_fx__users_email_lower` ON `fx__users` ((lower(email)))"
    );
    // MySQL has no partial indexes; a full unique index would reject rows the
    // predicate admits, so the statement is refused instead.
    expect(() => emitAdditiveDdl(table(partialUnique), "mysql")).toThrow();
  });
});

describe("emitted tables declare their key the way the migration templates do", () => {
  const counters: TableSpec = {
    name: "fx__counters",
    columns: [
      {
        name: "seq",
        type: "int4",
        nullable: false,
        primaryKey: true,
        autoIncrement: true,
      },
      { name: "label", type: "text", nullable: true },
    ],
    indexes: [],
  };

  it("postgresql: a serial key is a serial primary key, whatever its name", () => {
    const [create] = emitPostgresDdl({ type: "add_table", table: counters });
    expect(create).toContain(`"seq" serial PRIMARY KEY`);
  });

  it("mysql: a serial key carries AUTO_INCREMENT", () => {
    const table: TableSpec = {
      ...counters,
      columns: [{ ...counters.columns[0], type: "int" }, counters.columns[1]],
    };
    const [create] = emitAdditiveDdl({ type: "add_table", table }, "mysql");
    expect(create).toContain("`seq` int NOT NULL AUTO_INCREMENT PRIMARY KEY");
  });

  it("postgresql: the marked key is the primary key, and a column named id is not", () => {
    const table: TableSpec = {
      name: "fx__things",
      columns: [
        { name: "uuid", type: "text", nullable: false, primaryKey: true },
        { name: "id", type: "text", nullable: true },
      ],
      indexes: [],
    };
    const [create] = emitPostgresDdl({ type: "add_table", table });
    expect(create).toContain(`"uuid" text PRIMARY KEY NOT NULL`);
    expect(create).toContain(`"id" text\n`);
    expect(create).not.toContain(`"id" text PRIMARY KEY`);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "%s: the CREATE TABLE is the migration template's, less the constraints added later",
    dialect => {
      const table: TableSpec = {
        name: "fx__notes",
        columns: [
          {
            name: "id",
            type: "varchar(36)",
            nullable: false,
            primaryKey: true,
          },
          {
            name: "body",
            type: "varchar(255)",
            typeModifier: "255",
            nullable: true,
          },
          { name: "rank", type: "integer", nullable: false, default: "0" },
        ],
        indexes: [
          { name: "idx_fx__notes_rank", columns: ["rank"], unique: false },
        ],
      };
      const op: Operation = { type: "add_table", table };
      const template = generateSQL(op, dialect).split(";\n");
      expect(emitDdl([op], dialect)).toEqual(template);
    }
  );

  it("postgresql and mysql add a new table's constraints once, after the CREATE", () => {
    const table: TableSpec = {
      name: "fx__items",
      columns: [
        { name: "id", type: "text", nullable: false, primaryKey: true },
        { name: "qty", type: "integer", nullable: false },
      ],
      indexes: [],
      checks: [{ name: "ck_fx__items_qty", sql: "qty >= 0" }],
    };
    for (const dialect of ["postgresql", "mysql"] as const) {
      const statements = emitDdl([{ type: "add_table", table }], dialect);
      expect(
        statements.filter(statement => statement.includes("ck_fx__items_qty"))
      ).toHaveLength(1);
      expect(statements[0]).not.toContain("CHECK");
    }
  });
});

describe("expression index key lists", () => {
  it("renders each key of a list as its own key, leaving a bare column bare", () => {
    const index: IndexSpec = {
      name: "idx_fx__users_email_status",
      columns: [],
      unique: false,
      expression: "lower(email), status",
    };
    expect(emitPostgresDdl(addIndex(index))).toEqual([
      `CREATE INDEX IF NOT EXISTS "idx_fx__users_email_status" ON "fx__users" ((lower(email)), status)`,
    ]);
  });

  it.each([
    "lower(email) DESC",
    "email text_pattern_ops",
    "email COLLATE nocase",
  ])("refuses a key that orders or classes its value: %s", expression => {
    expect(() =>
      emitPostgresDdl(
        addIndex({
          name: "idx_fx__users_x",
          columns: [],
          unique: false,
          expression,
        })
      )
    ).toThrow(NextlyError);
  });
});
