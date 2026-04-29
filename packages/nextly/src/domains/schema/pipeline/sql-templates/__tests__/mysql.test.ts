// F11 PR 3: MySQL SQL templates unit tests.

import { describe, expect, it } from "vitest";

import type { Operation } from "../../diff/types.js";
import { generateSQL } from "../index.js";

const my = (op: Operation) => generateSQL(op, "mysql");

describe("generateSQL — mysql", () => {
  it("add_table emits CREATE TABLE with backtick identifiers", () => {
    const sql = my({
      type: "add_table",
      table: {
        name: "dc_posts",
        columns: [
          { name: "id", type: "varchar(36)", nullable: false },
          { name: "title", type: "text", nullable: false },
        ],
      },
    });
    expect(sql).toContain("CREATE TABLE `dc_posts`");
    expect(sql).toContain("`id` varchar(36) NOT NULL");
    expect(sql).toContain("`title` text NOT NULL");
  });

  it("drop_table emits DROP TABLE WITHOUT CASCADE (MySQL syntax)", () => {
    expect(my({ type: "drop_table", tableName: "dc_old" })).toBe(
      "DROP TABLE `dc_old`"
    );
  });

  it("rename_table emits ALTER TABLE RENAME TO", () => {
    expect(
      my({ type: "rename_table", fromName: "dc_old", toName: "dc_new" })
    ).toBe("ALTER TABLE `dc_old` RENAME TO `dc_new`");
  });

  it("add_column emits ALTER TABLE ADD COLUMN", () => {
    expect(
      my({
        type: "add_column",
        tableName: "dc_posts",
        column: { name: "excerpt", type: "text", nullable: true },
      })
    ).toBe("ALTER TABLE `dc_posts` ADD COLUMN `excerpt` text");
  });

  it("drop_column emits ALTER TABLE DROP COLUMN", () => {
    expect(
      my({
        type: "drop_column",
        tableName: "dc_posts",
        columnName: "obsolete",
        columnType: "text",
      })
    ).toBe("ALTER TABLE `dc_posts` DROP COLUMN `obsolete`");
  });

  it("rename_column uses MySQL 8.0+ RENAME COLUMN syntax", () => {
    expect(
      my({
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "title",
        toColumn: "name",
        fromType: "text",
        toType: "text",
      })
    ).toBe("ALTER TABLE `dc_posts` RENAME COLUMN `title` TO `name`");
  });

  it("change_column_type uses MODIFY COLUMN (no TYPE keyword)", () => {
    expect(
      my({
        type: "change_column_type",
        tableName: "dc_posts",
        columnName: "views",
        fromType: "int",
        toType: "bigint",
      })
    ).toBe("ALTER TABLE `dc_posts` MODIFY COLUMN `views` bigint");
  });

  it("change_column_default emits SET DEFAULT / DROP DEFAULT", () => {
    expect(
      my({
        type: "change_column_default",
        tableName: "dc_posts",
        columnName: "views",
        fromDefault: undefined,
        toDefault: "0",
      })
    ).toBe("ALTER TABLE `dc_posts` ALTER COLUMN `views` SET DEFAULT 0");

    expect(
      my({
        type: "change_column_default",
        tableName: "dc_posts",
        columnName: "views",
        fromDefault: "0",
        toDefault: undefined,
      })
    ).toBe("ALTER TABLE `dc_posts` ALTER COLUMN `views` DROP DEFAULT");
  });
});
