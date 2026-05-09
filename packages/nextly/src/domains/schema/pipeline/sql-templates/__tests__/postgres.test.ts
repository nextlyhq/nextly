// F11 PR 3: PostgreSQL SQL templates unit tests. Covers all 9 op types.

import { describe, expect, it } from "vitest";

import type { Operation } from "../../diff/types";
import { generateSQL } from "../index";

const pg = (op: Operation) => generateSQL(op, "postgresql");

describe("generateSQL — postgres", () => {
  it("add_table emits CREATE TABLE with quoted identifiers", () => {
    const sql = pg({
      type: "add_table",
      table: {
        name: "dc_posts",
        columns: [
          {
            name: "id",
            type: "uuid",
            nullable: false,
            default: "gen_random_uuid()",
          },
          { name: "title", type: "text", nullable: false },
          { name: "excerpt", type: "text", nullable: true },
        ],
      },
    });
    expect(sql).toContain('CREATE TABLE "dc_posts"');
    expect(sql).toContain('"id" uuid NOT NULL DEFAULT gen_random_uuid()');
    expect(sql).toContain('"title" text NOT NULL');
    expect(sql).toContain('"excerpt" text');
    expect(sql).not.toContain('"excerpt" text NOT NULL');
  });

  it("drop_table emits DROP TABLE with CASCADE", () => {
    expect(pg({ type: "drop_table", tableName: "dc_old" })).toBe(
      'DROP TABLE "dc_old" CASCADE'
    );
  });

  it("rename_table emits ALTER TABLE RENAME TO", () => {
    expect(
      pg({ type: "rename_table", fromName: "dc_old", toName: "dc_new" })
    ).toBe('ALTER TABLE "dc_old" RENAME TO "dc_new"');
  });

  it("add_column emits ALTER TABLE ADD COLUMN", () => {
    expect(
      pg({
        type: "add_column",
        tableName: "dc_posts",
        column: { name: "excerpt", type: "text", nullable: true },
      })
    ).toBe('ALTER TABLE "dc_posts" ADD COLUMN "excerpt" text');
  });

  it("add_column emits NOT NULL + DEFAULT when present", () => {
    expect(
      pg({
        type: "add_column",
        tableName: "dc_posts",
        column: {
          name: "views",
          type: "integer",
          nullable: false,
          default: "0",
        },
      })
    ).toBe(
      'ALTER TABLE "dc_posts" ADD COLUMN "views" integer NOT NULL DEFAULT 0'
    );
  });

  it("drop_column emits ALTER TABLE DROP COLUMN", () => {
    expect(
      pg({
        type: "drop_column",
        tableName: "dc_posts",
        columnName: "obsolete",
        columnType: "text",
      })
    ).toBe('ALTER TABLE "dc_posts" DROP COLUMN "obsolete"');
  });

  it("rename_column emits ALTER TABLE RENAME COLUMN TO", () => {
    expect(
      pg({
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
      })
    ).toBe('ALTER TABLE "dc_posts" RENAME COLUMN "title" TO "name"');
  });

  it("change_column_type emits ALTER COLUMN ... TYPE", () => {
    expect(
      pg({
        type: "change_column_type",
        tableName: "dc_posts",
        columnName: "views",
        fromType: "integer",
        toType: "bigint",
      })
    ).toBe('ALTER TABLE "dc_posts" ALTER COLUMN "views" TYPE bigint');
  });

  it("change_column_nullable emits SET NOT NULL when toNullable=false", () => {
    expect(
      pg({
        type: "change_column_nullable",
        tableName: "dc_posts",
        columnName: "title",
        fromNullable: true,
        toNullable: false,
      })
    ).toBe('ALTER TABLE "dc_posts" ALTER COLUMN "title" SET NOT NULL');
  });

  it("change_column_nullable emits DROP NOT NULL when toNullable=true", () => {
    expect(
      pg({
        type: "change_column_nullable",
        tableName: "dc_posts",
        columnName: "title",
        fromNullable: false,
        toNullable: true,
      })
    ).toBe('ALTER TABLE "dc_posts" ALTER COLUMN "title" DROP NOT NULL');
  });

  it("change_column_default emits SET DEFAULT when toDefault provided", () => {
    expect(
      pg({
        type: "change_column_default",
        tableName: "dc_posts",
        columnName: "views",
        fromDefault: undefined,
        toDefault: "0",
      })
    ).toBe('ALTER TABLE "dc_posts" ALTER COLUMN "views" SET DEFAULT 0');
  });

  it("change_column_default emits DROP DEFAULT when toDefault undefined", () => {
    expect(
      pg({
        type: "change_column_default",
        tableName: "dc_posts",
        columnName: "views",
        fromDefault: "0",
        toDefault: undefined,
      })
    ).toBe('ALTER TABLE "dc_posts" ALTER COLUMN "views" DROP DEFAULT');
  });
});
