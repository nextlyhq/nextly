import { describe, it, expect } from "vitest";

import { NextlyError } from "../../../../../errors";

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
    const stmts = emitAdditiveDdl(table, "mysql");
    expect(stmts[0]).toContain("CREATE TABLE `dc_articles`");
    expect(stmts[0]).toContain("`id` text PRIMARY KEY NOT NULL");
    expect(stmts[1]).toBe(
      "CREATE UNIQUE INDEX `idx_dc_articles_slug` ON `dc_articles` (`slug`)"
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
});
