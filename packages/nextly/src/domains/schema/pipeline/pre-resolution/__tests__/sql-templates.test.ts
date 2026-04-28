import { describe, expect, it } from "vitest";

import {
  buildDropColumnSql,
  buildDropTableSql,
  buildRenameColumnSql,
  buildRenameTableSql,
} from "../sql-templates.js";

describe("buildRenameColumnSql", () => {
  it("emits postgres ALTER TABLE RENAME COLUMN with double-quoted identifiers", () => {
    expect(
      buildRenameColumnSql("dc_posts", "title", "name", "postgresql")
    ).toBe(`ALTER TABLE "dc_posts" RENAME COLUMN "title" TO "name"`);
  });

  it("emits mysql ALTER TABLE RENAME COLUMN with backtick identifiers", () => {
    expect(buildRenameColumnSql("dc_posts", "title", "name", "mysql")).toBe(
      "ALTER TABLE `dc_posts` RENAME COLUMN `title` TO `name`"
    );
  });

  it("emits sqlite ALTER TABLE RENAME COLUMN with double-quoted identifiers", () => {
    expect(buildRenameColumnSql("dc_posts", "title", "name", "sqlite")).toBe(
      `ALTER TABLE "dc_posts" RENAME COLUMN "title" TO "name"`
    );
  });

  it("handles reserved-word identifiers via the dialect quoting", () => {
    // "order" is reserved in SQL; the quotes make it a regular identifier.
    expect(buildRenameColumnSql("order", "select", "from", "postgresql")).toBe(
      `ALTER TABLE "order" RENAME COLUMN "select" TO "from"`
    );
  });
});

describe("buildDropColumnSql", () => {
  it("emits postgres DROP COLUMN", () => {
    expect(buildDropColumnSql("dc_posts", "body", "postgresql")).toBe(
      `ALTER TABLE "dc_posts" DROP COLUMN "body"`
    );
  });

  it("emits mysql DROP COLUMN with backticks", () => {
    expect(buildDropColumnSql("dc_posts", "body", "mysql")).toBe(
      "ALTER TABLE `dc_posts` DROP COLUMN `body`"
    );
  });

  it("emits sqlite DROP COLUMN with double quotes", () => {
    expect(buildDropColumnSql("dc_posts", "body", "sqlite")).toBe(
      `ALTER TABLE "dc_posts" DROP COLUMN "body"`
    );
  });
});

describe("buildDropTableSql", () => {
  it("emits postgres DROP TABLE with CASCADE", () => {
    // CASCADE handles FK constraints from other tables - safer for our
    // managed-tables-only scope where we don't track FKs at the diff level.
    expect(buildDropTableSql("dc_old", "postgresql")).toBe(
      `DROP TABLE "dc_old" CASCADE`
    );
  });

  it("emits mysql DROP TABLE without CASCADE keyword (mysql FK semantics differ)", () => {
    expect(buildDropTableSql("dc_old", "mysql")).toBe("DROP TABLE `dc_old`");
  });

  it("emits sqlite DROP TABLE", () => {
    // SQLite does not support CASCADE keyword on DROP TABLE; FKs cascade
    // via foreign_keys = ON pragma at connection level.
    expect(buildDropTableSql("dc_old", "sqlite")).toBe(`DROP TABLE "dc_old"`);
  });
});

describe("buildRenameTableSql", () => {
  it("emits postgres ALTER TABLE RENAME TO", () => {
    expect(buildRenameTableSql("dc_old", "dc_new", "postgresql")).toBe(
      `ALTER TABLE "dc_old" RENAME TO "dc_new"`
    );
  });

  it("emits mysql ALTER TABLE RENAME TO with backticks", () => {
    expect(buildRenameTableSql("dc_old", "dc_new", "mysql")).toBe(
      "ALTER TABLE `dc_old` RENAME TO `dc_new`"
    );
  });

  it("emits sqlite ALTER TABLE RENAME TO", () => {
    expect(buildRenameTableSql("dc_old", "dc_new", "sqlite")).toBe(
      `ALTER TABLE "dc_old" RENAME TO "dc_new"`
    );
  });
});
