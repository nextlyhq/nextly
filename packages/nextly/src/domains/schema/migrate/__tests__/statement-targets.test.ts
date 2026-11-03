// The tables one migration statement changes, read through the shared
// statement cursor. A form it does not know is unreadable (undefined), never
// guessed: a caller deciding whether a file stays inside one entity's tables
// must treat an unreadable statement as leaving them.
import { describe, expect, it } from "vitest";

import { buildCollectionMetadataUpsert } from "../../ui-schema/metadata-sql";
import {
  indexesDroppedBy,
  registryRowWrittenBy,
  tablesChangedIn,
  tablesDroppedBy,
} from "../statement-targets";

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

// The registry row a statement writes, keyed on its slug. The positive cells
// read the upsert the Builder itself generated, so a change to its shape
// shows up here; each negative cell is one way a statement could reach a
// row other than the slug it names.
describe.each(["postgresql", "mysql"] as const)(
  "registryRowWrittenBy on %s",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const read = (sql: string) => registryRowWrittenBy(sql, dialect);
    const upsert = buildCollectionMetadataUpsert(
      { slug: "posts", fields: [{ name: "title", type: "text" }] },
      dialect
    );

    it("reads the slug of the Builder's own upsert", () => {
      expect(read(upsert)).toEqual({
        table: "dynamic_collections",
        slug: "posts",
      });
    });

    it("reads a plain insert with no upsert", () => {
      expect(
        read(
          `INSERT INTO ${q("r")} (${q("id")}, ${q("slug")}) VALUES ('1', 'posts')`
        )
      ).toEqual({ table: "r", slug: "posts" });
    });

    it("reads an update keyed on one slug", () => {
      expect(
        read(
          `UPDATE ${q("r")} SET ${q("labels")} = '{}' WHERE ${q("slug")} = 'posts'`
        )
      ).toEqual({ table: "r", slug: "posts" });
    });

    it.each([
      [
        "a second row",
        () =>
          `INSERT INTO ${q("r")} (${q("slug")}) VALUES ('posts'), ('other')`,
      ],
      [
        "a slug that is not a string",
        () => `INSERT INTO ${q("r")} (${q("slug")}) VALUES (lower('POSTS'))`,
      ],
      [
        "a slug the scan cannot read exactly",
        () => `INSERT INTO ${q("r")} (${q("slug")}) VALUES (E'po\\sts')`,
      ],
      [
        "no slug column",
        () => `INSERT INTO ${q("r")} (${q("id")}) VALUES ('posts')`,
      ],
      [
        "an insert from a query",
        () => `INSERT INTO ${q("r")} (${q("slug")}) SELECT 'posts'`,
      ],
      [
        "an update that renames the row",
        () =>
          `UPDATE ${q("r")} SET ${q("slug")} = 'other' WHERE ${q("slug")} = 'posts'`,
      ],
      [
        "an update that rewrites the id",
        () =>
          `UPDATE ${q("r")} SET ${q("id")} = 'x' WHERE ${q("slug")} = 'posts'`,
      ],
      [
        "an update keyed on more than the slug",
        () =>
          `UPDATE ${q("r")} SET ${q("labels")} = '{}' WHERE ${q("slug")} = 'posts' OR 1 = 1`,
      ],
      [
        "an update with no WHERE",
        () => `UPDATE ${q("r")} SET ${q("labels")} = '{}'`,
      ],
      [
        "an upsert that renames the row it meets",
        () =>
          dialect === "mysql"
            ? `INSERT INTO ${q("r")} (${q("slug")}) VALUES ('posts') ON DUPLICATE KEY UPDATE ${q("slug")} = 'other'`
            : `INSERT INTO ${q("r")} (${q("slug")}) VALUES ('posts') ON CONFLICT (${q("slug")}) DO UPDATE SET ${q("slug")} = 'other'`,
      ],
      [
        "an upsert setting a column to something else",
        () =>
          dialect === "mysql"
            ? `INSERT INTO ${q("r")} (${q("slug")}, ${q("labels")}) VALUES ('posts', '{}') ON DUPLICATE KEY UPDATE ${q("labels")} = (SELECT 1)`
            : `INSERT INTO ${q("r")} (${q("slug")}, ${q("labels")}) VALUES ('posts', '{}') ON CONFLICT (${q("slug")}) DO UPDATE SET ${q("labels")} = (SELECT 1)`,
      ],
      [
        "an upsert followed by a statement left without its ;",
        () =>
          `${upsert}\n--> statement-breakpoint\nALTER TABLE ${q("nextly_users")} ADD COLUMN ${q("x")} text`,
      ],
      [
        "an update followed by a statement left without its ;",
        () =>
          `UPDATE ${q("r")} SET ${q("labels")} = '{}' ALTER TABLE ${q("t")} ADD ${q("x")} text WHERE ${q("slug")} = 'posts'`,
      ],
      [
        "a deletion",
        () => `DELETE FROM ${q("r")} WHERE ${q("slug")} = 'posts'`,
      ],
    ])("reads nothing from %s", (_, sql) => {
      expect(read(sql())).toBeUndefined();
    });
  }
);

describe("registryRowWrittenBy on postgresql only", () => {
  it("reads nothing from an upsert keyed on another column", () => {
    expect(
      registryRowWrittenBy(
        `INSERT INTO "r" ("id", "slug") VALUES ('1', 'posts') ON CONFLICT ("id") DO UPDATE SET "labels" = EXCLUDED."labels"`,
        "postgresql"
      )
    ).toBeUndefined();
  });
});

describe("indexesDroppedBy", () => {
  it.each([
    [`DROP INDEX "idx_a"`, ["idx_a"]],
    [
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_a", idx_b RESTRICT;`,
      ["idx_a", "idx_b"],
    ],
  ])("reads %s", (sql, names) => {
    expect(indexesDroppedBy(sql, "postgresql")).toEqual(names);
  });

  it.each([
    `DROP INDEX "idx_a" CASCADE`,
    `DROP INDEX "s"."idx_a"`,
    "DROP INDEX `idx_a` ON `t`",
    `DROP TABLE "idx_a"`,
  ])("reads nothing from %s", sql => {
    expect(indexesDroppedBy(sql, "postgresql")).toBeUndefined();
  });
});
