// F11 PR 3: SQLite SQL templates unit tests.
//
// Covers the supported ops + asserts the unsupported in-place changes
// throw a clear error pointing operators at the recreate-table workaround.

import { describe, expect, it } from "vitest";

import type { Operation } from "../../diff/types";
import { generateSQL, SqliteUnsupportedOperationError } from "../index";

const sl = (op: Operation) => generateSQL(op, "sqlite");

describe("generateSQL — sqlite (supported ops)", () => {
  it("add_table emits CREATE TABLE with double-quoted identifiers", () => {
    const sql = sl({
      type: "add_table",
      table: {
        name: "dc_posts",
        columns: [
          { name: "id", type: "text", nullable: false },
          { name: "title", type: "text", nullable: false },
        ],
      },
    });
    expect(sql).toContain('CREATE TABLE "dc_posts"');
    expect(sql).toContain('"id" text NOT NULL');
  });

  it("drop_table emits DROP TABLE without CASCADE", () => {
    expect(sl({ type: "drop_table", tableName: "dc_old" })).toBe(
      'DROP TABLE "dc_old"'
    );
  });

  it("rename_table emits ALTER TABLE RENAME TO", () => {
    expect(
      sl({ type: "rename_table", fromName: "dc_old", toName: "dc_new" })
    ).toBe('ALTER TABLE "dc_old" RENAME TO "dc_new"');
  });

  it("add_column emits ALTER TABLE ADD COLUMN", () => {
    expect(
      sl({
        type: "add_column",
        tableName: "dc_posts",
        column: { name: "excerpt", type: "text", nullable: true },
      })
    ).toBe('ALTER TABLE "dc_posts" ADD COLUMN "excerpt" text');
  });

  it("drop_column emits ALTER TABLE DROP COLUMN", () => {
    expect(
      sl({
        type: "drop_column",
        tableName: "dc_posts",
        columnName: "obsolete",
        columnType: "text",
      })
    ).toBe('ALTER TABLE "dc_posts" DROP COLUMN "obsolete"');
  });

  it("rename_column emits ALTER TABLE RENAME COLUMN TO", () => {
    expect(
      sl({
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
      })
    ).toBe('ALTER TABLE "dc_posts" RENAME COLUMN "title" TO "name"');
  });
});

describe("generateSQL — sqlite (unsupported in-place changes)", () => {
  it("throws SqliteUnsupportedOperationError for change_column_type", () => {
    expect(() =>
      sl({
        type: "change_column_type",
        tableName: "dc_posts",
        columnName: "views",
        fromType: "integer",
        toType: "real",
      })
    ).toThrow(SqliteUnsupportedOperationError);
  });

  it("throws for change_column_nullable", () => {
    expect(() =>
      sl({
        type: "change_column_nullable",
        tableName: "dc_posts",
        columnName: "title",
        fromNullable: true,
        toNullable: false,
      })
    ).toThrow(SqliteUnsupportedOperationError);
  });

  it("throws for change_column_default", () => {
    expect(() =>
      sl({
        type: "change_column_default",
        tableName: "dc_posts",
        columnName: "views",
        fromDefault: undefined,
        toDefault: "0",
      })
    ).toThrow(SqliteUnsupportedOperationError);
  });

  it("error message hints at the recreate-table workaround", () => {
    try {
      sl({
        type: "change_column_type",
        tableName: "dc_posts",
        columnName: "views",
        fromType: "integer",
        toType: "real",
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toContain("RENAME TO");
      expect((err as Error).message).toContain("recreate-table");
    }
  });
});
