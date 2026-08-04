import { describe, it, expect } from "vitest";

import { NextlyError } from "../../../../../errors";

import { PRE_RESOLUTION_OP_TYPES } from "../../diff/types";
import type { Operation } from "../../diff/types";
import { emitAdditiveDdl } from "../additive";

describe("emitAdditiveDdl — add_column", () => {
  it("sqlite: nullable column, no default", () => {
    const op: Operation = {
      type: "add_column",
      tableName: "dc_authors",
      column: { name: "age", type: "integer", nullable: true },
    };
    expect(emitAdditiveDdl(op, "sqlite")).toEqual([
      `ALTER TABLE "dc_authors" ADD COLUMN "age" integer`,
    ]);
  });

  it("mysql: NOT NULL column with a default, backtick-quoted", () => {
    const op: Operation = {
      type: "add_column",
      tableName: "dc_authors",
      column: {
        name: "status",
        type: "varchar(20)",
        nullable: false,
        default: "'draft'",
      },
    };
    expect(emitAdditiveDdl(op, "mysql")).toEqual([
      "ALTER TABLE `dc_authors` ADD COLUMN `status` varchar(20) NOT NULL DEFAULT 'draft'",
    ]);
  });
});

describe("emitAdditiveDdl — add_table", () => {
  const table: Operation = {
    type: "add_table",
    table: {
      name: "dc_articles",
      columns: [
        { name: "id", type: "text", nullable: false, primaryKey: true },
        { name: "title", type: "text", nullable: false },
        { name: "views", type: "integer", nullable: true },
        { name: "status", type: "text", nullable: false, default: "'draft'" },
      ],
      indexes: [
        { name: "idx_dc_articles_slug", columns: ["slug"], unique: true },
      ],
    },
  };

  it("sqlite: CREATE TABLE with PK on id + tracked indexes", () => {
    const stmts = emitAdditiveDdl(table, "sqlite");
    expect(stmts[0]).toBe(
      `CREATE TABLE "dc_articles" (\n` +
        `  "id" text PRIMARY KEY NOT NULL,\n` +
        `  "title" text NOT NULL,\n` +
        `  "views" integer,\n` +
        `  "status" text NOT NULL DEFAULT 'draft'\n` +
        `)`
    );
    expect(stmts[1]).toBe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_articles_slug" ON "dc_articles" ("slug")`
    );
  });

  it("mysql: CREATE TABLE with PK on id, plain CREATE INDEX (no IF NOT EXISTS)", () => {
    // MySQL's id is `varchar(36)`, not `text`: the column descriptor gives
    // it that type because MySQL rejects a TEXT column in a key spec
    // without a length (ER_BLOB_KEY_WITHOUT_LENGTH). Asserting the type
    // production actually emits keeps this from passing on DDL the
    // database would refuse.
    const mysqlTable: Operation = {
      ...table,
      table: {
        ...(table as Extract<Operation, { type: "add_table" }>).table,
        columns: [
          {
            name: "id",
            type: "varchar(36)",
            nullable: false,
            primaryKey: true,
          },
          { name: "slug", type: "varchar(255)", nullable: false },
        ],
      },
    };
    const stmts = emitAdditiveDdl(mysqlTable, "mysql");
    expect(stmts[0]).toContain("CREATE TABLE `dc_articles`");
    expect(stmts[0]).toContain("`id` varchar(36) PRIMARY KEY NOT NULL");
    expect(stmts[1]).toBe(
      "CREATE UNIQUE INDEX `idx_dc_articles_slug` ON `dc_articles` (`slug`)"
    );
  });

  it("takes the primary key from the spec flag, not the column name", () => {
    // A key named something other than `id` still gets PRIMARY KEY, and a
    // non-key column named `id` does not become one.
    const oddKey: Operation = {
      type: "add_table",
      table: {
        name: "dc_odd",
        columns: [
          { name: "uid", type: "text", nullable: false, primaryKey: true },
          { name: "id", type: "text", nullable: true },
        ],
      },
    };
    const [createTable] = emitAdditiveDdl(oddKey, "sqlite");
    expect(createTable).toContain(`"uid" text PRIMARY KEY NOT NULL`);
    expect(createTable).toContain(`"id" text`);
    expect(createTable).not.toContain(`"id" text PRIMARY KEY`);
  });

  it("keeps a default declared on the key column", () => {
    const keyed: Operation = {
      type: "add_table",
      table: {
        name: "dc_keyed",
        columns: [
          {
            name: "id",
            type: "text",
            nullable: false,
            primaryKey: true,
            default: "gen_random_uuid()",
          },
        ],
      },
    };
    expect(emitAdditiveDdl(keyed, "sqlite")[0]).toContain(
      `"id" text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()`
    );
  });

  it("still keys a legacy spec (no primaryKey flags at all) on id", () => {
    // Snapshots predating the flag leave it undefined throughout; the
    // historical convention keeps them from emitting a table with no key.
    const legacySpec: Operation = {
      type: "add_table",
      table: {
        name: "dc_legacy",
        columns: [
          { name: "id", type: "text", nullable: false },
          { name: "slug", type: "text", nullable: false },
        ],
      },
    };
    expect(emitAdditiveDdl(legacySpec, "sqlite")[0]).toContain(
      `"id" text PRIMARY KEY NOT NULL`
    );
  });

  it("falls back to canonical slug/created_at indexes when none are tracked", () => {
    const legacy: Operation = {
      type: "add_table",
      table: {
        name: "dc_posts",
        columns: [
          { name: "id", type: "text", nullable: false },
          { name: "slug", type: "text", nullable: false },
          { name: "created_at", type: "integer", nullable: false },
        ],
      },
    };
    const stmts = emitAdditiveDdl(legacy, "sqlite");
    expect(stmts).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_posts_slug" ON "dc_posts" ("slug")`
    );
    expect(stmts).toContain(
      `CREATE INDEX IF NOT EXISTS "idx_dc_posts_created_at" ON "dc_posts" ("created_at" DESC)`
    );
  });
});

describe("emitAdditiveDdl — indexes and contracts", () => {
  it("add_index / drop_index per dialect", () => {
    const add: Operation = {
      type: "add_index",
      tableName: "dc_authors",
      index: {
        name: "idx_dc_authors_email",
        columns: ["email"],
        unique: false,
      },
    };
    expect(emitAdditiveDdl(add, "sqlite")).toEqual([
      `CREATE INDEX IF NOT EXISTS "idx_dc_authors_email" ON "dc_authors" ("email")`,
    ]);
    const drop: Operation = {
      type: "drop_index",
      tableName: "dc_authors",
      index: {
        name: "idx_dc_authors_email",
        columns: ["email"],
        unique: false,
      },
    };
    // SQLite indexes are namespace-global; MySQL scopes drop to the table.
    expect(emitAdditiveDdl(drop, "sqlite")).toEqual([
      `DROP INDEX IF EXISTS "idx_dc_authors_email"`,
    ]);
    expect(emitAdditiveDdl(drop, "mysql")).toEqual([
      "DROP INDEX `idx_dc_authors_email` ON `dc_authors`",
    ]);
  });

  it("emits nothing for pre-resolution-handled ops", () => {
    const dropCol: Operation = {
      type: "drop_column",
      tableName: "dc_authors",
      columnName: "old",
      columnType: "text",
    };
    expect(emitAdditiveDdl(dropCol, "sqlite")).toEqual([]);
    expect(emitAdditiveDdl(dropCol, "mysql")).toEqual([]);
  });

  it("throws a typed internal error on change_* ops (kit owns rebuilds here)", () => {
    const changeType: Operation = {
      type: "change_column_type",
      tableName: "dc_authors",
      columnName: "age",
      fromType: "text",
      toType: "integer",
    };
    // NextlyError's public message is generic by design; the routing-bug
    // detail lives in logContext.
    let thrown: unknown;
    try {
      emitAdditiveDdl(changeType, "sqlite");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NextlyError);
    expect((thrown as NextlyError).logContext).toMatchObject({
      op: "change_column_type",
      dialect: "sqlite",
    });
  });

  // The executor runs these before the emitter is reached, so emitting SQL
  // for one applies it twice. Asserted over the SET rather than over a list
  // of op types copied from it: moving an op into pre-resolution (as the
  // index-ordering work does for `drop_index`) then fails here on the same
  // commit instead of surfacing as ER_CANT_DROP_FIELD_OR_KEY at runtime on
  // MySQL, whose DROP INDEX has no IF EXISTS.
  it("emits nothing for every op the pre-resolution executor owns", () => {
    const samples: Record<Operation["type"], Operation> = {
      rename_table: { type: "rename_table", fromName: "a", toName: "b" },
      rename_column: {
        type: "rename_column",
        tableName: "dc_a",
        fromColumn: "a",
        toColumn: "b",
        fromType: "text",
        toType: "text",
      },
      drop_column: {
        type: "drop_column",
        tableName: "dc_a",
        columnName: "old",
        columnType: "text",
      },
      drop_table: { type: "drop_table", tableName: "dc_a" },
      add_column: {
        type: "add_column",
        tableName: "dc_a",
        column: { name: "c", type: "text", nullable: true },
      },
      add_table: {
        type: "add_table",
        table: {
          name: "dc_a",
          columns: [{ name: "id", type: "text", nullable: false }],
        },
      },
      add_index: {
        type: "add_index",
        tableName: "dc_a",
        index: { name: "idx_dc_a_c", columns: ["c"], unique: false },
      },
      drop_index: {
        type: "drop_index",
        tableName: "dc_a",
        index: { name: "idx_dc_a_c", columns: ["c"], unique: false },
      },
      change_column_type: {
        type: "change_column_type",
        tableName: "dc_a",
        columnName: "c",
        fromType: "text",
        toType: "integer",
      },
      change_column_nullable: {
        type: "change_column_nullable",
        tableName: "dc_a",
        columnName: "c",
        toNullable: true,
      },
      change_column_default: {
        type: "change_column_default",
        tableName: "dc_a",
        columnName: "c",
        toDefault: "'x'",
      },
    };

    for (const type of PRE_RESOLUTION_OP_TYPES) {
      const op = samples[type];
      expect(emitAdditiveDdl(op, "sqlite")).toEqual([]);
      expect(emitAdditiveDdl(op, "mysql")).toEqual([]);
    }
  });
});
