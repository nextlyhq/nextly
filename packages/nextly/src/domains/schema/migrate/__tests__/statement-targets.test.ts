// The tables one migration statement changes, read through the shared
// statement cursor. A form it does not know is unreadable (undefined), never
// guessed: a caller deciding whether a file stays inside one entity's tables
// must treat an unreadable statement as leaving them.
import { describe, expect, it } from "vitest";

import { tablesChangedIn, tablesDroppedBy } from "../statement-targets";

describe.each(["postgresql", "mysql"] as const)(
  "tablesChangedIn on %s",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const read = (sql: string) => tablesChangedIn(sql, dialect);

    it.each([
      [
        "CREATE TABLE",
        () => `CREATE TABLE ${q("dc_posts")} (${q("id")} text);`,
        ["dc_posts"],
      ],
      [
        "CREATE TABLE IF NOT EXISTS",
        () => `CREATE TABLE IF NOT EXISTS ${q("dc_posts")} (${q("id")} text)`,
        ["dc_posts"],
      ],
      [
        "ALTER TABLE",
        () => `ALTER TABLE ${q("dc_posts")} ADD COLUMN ${q("x")} text;`,
        ["dc_posts"],
      ],
      [
        "DROP TABLE IF EXISTS with a list",
        () => `DROP TABLE IF EXISTS ${q("dc_a")}, ${q("dc_b")};`,
        ["dc_a", "dc_b"],
      ],
      [
        "CREATE UNIQUE INDEX … ON",
        () =>
          `CREATE UNIQUE INDEX IF NOT EXISTS ${q("uq_x")} ON ${q("dc_posts")}(${q("x")});`,
        ["dc_posts"],
      ],
      [
        "CREATE INDEX … ON",
        () => `CREATE INDEX ${q("idx_x")} ON ${q("dc_posts")}(${q("x")});`,
        ["dc_posts"],
      ],
      [
        "INSERT INTO",
        () =>
          `INSERT INTO ${q("dynamic_collections")} (${q("slug")}) VALUES ('posts');`,
        ["dynamic_collections"],
      ],
      [
        "UPDATE",
        () => `UPDATE ${q("dc_posts")} SET ${q("x")} = 1;`,
        ["dc_posts"],
      ],
      ["DELETE FROM", () => `DELETE FROM ${q("dc_posts")};`, ["dc_posts"]],
      [
        "a bare, unquoted name",
        () => "ALTER TABLE dc_posts ADD COLUMN x text",
        ["dc_posts"],
      ],
    ])("reads %s", (_form, sql, tables) => {
      expect(read(sql())).toEqual(tables);
    });

    it.each([
      ["a GRANT", () => `GRANT ALL ON ${q("dc_posts")} TO someone`],
      [
        "a schema-qualified table",
        () =>
          `ALTER TABLE ${q("public")}.${q("dc_posts")} ADD COLUMN ${q("x")} text`,
      ],
      ["a function body", () => "SELECT 1"],
      ["an empty statement", () => ""],
    ])("does not read %s", (_form, sql) => {
      expect(read(sql())).toBeUndefined();
    });
  }
);

describe("DROP INDEX", () => {
  it("reads MySQL's table", () => {
    expect(
      tablesChangedIn("DROP INDEX `idx_x` ON `dc_posts`;", "mysql")
    ).toEqual(["dc_posts"]);
  });
  it("does not read a PostgreSQL index drop, which names no table", () => {
    expect(
      tablesChangedIn('DROP INDEX IF EXISTS "idx_dc_posts_x";', "postgresql")
    ).toBeUndefined();
  });
});

describe.each(["postgresql", "mysql"] as const)(
  "tablesDroppedBy on %s",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    it("reads a DROP TABLE's list", () => {
      expect(
        tablesDroppedBy(
          `DROP TABLE IF EXISTS ${q("dc_a")}, ${q("dc_b")};`,
          dialect
        )
      ).toEqual(["dc_a", "dc_b"]);
    });
    it.each([
      ["an ALTER", () => `ALTER TABLE ${q("dc_a")} DROP COLUMN ${q("x")}`],
      ["a CREATE", () => `CREATE TABLE ${q("dc_a")} (${q("id")} text)`],
      ["a DELETE", () => `DELETE FROM ${q("dc_a")}`],
    ])("is undefined for %s, which drops no table", (_form, sql) => {
      expect(tablesDroppedBy(sql(), dialect)).toBeUndefined();
    });
  }
);
