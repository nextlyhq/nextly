// The tables one migration statement changes, read through the shared
// statement cursor. A form it does not know is unreadable (undefined), never
// guessed: a caller deciding whether a file stays inside one entity's tables
// must treat an unreadable statement as leaving them.
import { describe, expect, it } from "vitest";

import { buildCollectionMetadataUpsert } from "../../ui-schema/metadata-sql";
import {
  archiveWriteOf,
  indexesDroppedBy,
  indexesRenamedBy,
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
      // MySQL's multi-table DML changes every table it names; a reading of the first alone would
      // let a file change another entity's table unseen.
      [
        "an UPDATE of several tables",
        () =>
          `UPDATE ${q("dc_posts")}, ${q("dc_comments")} SET ${q("dc_comments")}.${q("flag")} = 1`,
      ],
      [
        "an UPDATE over a JOIN",
        () =>
          `UPDATE ${q("dc_posts")} JOIN ${q("dc_comments")} ON ${q("dc_comments")}.${q("post")} = ${q("dc_posts")}.${q("id")} SET ${q("dc_comments")}.${q("flag")} = 1`,
      ],
      [
        "an UPDATE with a modifier before its table",
        () => `UPDATE LOW_PRIORITY ${q("dc_posts")} SET ${q("x")} = 1`,
      ],
      [
        "an UPDATE of an aliased table",
        () => `UPDATE ${q("dc_posts")} AS p SET ${q("x")} = 1`,
      ],
      [
        "a DELETE FROM several tables",
        () =>
          `DELETE FROM ${q("dc_posts")}, ${q("dc_comments")} USING ${q("dc_posts")} JOIN ${q("dc_comments")} ON ${q("dc_comments")}.${q("post")} = ${q("dc_posts")}.${q("id")}`,
      ],
      [
        "a DELETE FROM … USING",
        () =>
          `DELETE FROM ${q("dc_posts")} USING ${q("dc_posts")} JOIN ${q("dc_comments")} ON ${q("dc_comments")}.${q("post")} = ${q("dc_posts")}.${q("id")}`,
      ],
      [
        "a DELETE naming its tables before FROM",
        () =>
          `DELETE ${q("dc_posts")}, ${q("dc_comments")} FROM ${q("dc_posts")} JOIN ${q("dc_comments")} ON ${q("dc_comments")}.${q("post")} = ${q("dc_posts")}.${q("id")}`,
      ],
      [
        "an ALTER TABLE exchanging a partition with another table",
        () =>
          `ALTER TABLE ${q("dc_posts")} EXCHANGE PARTITION p0 WITH TABLE ${q("dc_comments")}`,
      ],
    ])("does not read %s", (_form, sql) => {
      expect(read(sql())).toBeUndefined();
    });

    it.each([
      [
        "an UPDATE … SET … WHERE",
        () =>
          `UPDATE ${q("dc_posts")} SET ${q("x")} = 1 WHERE ${q("id")} = 'a'`,
      ],
      [
        "a DELETE FROM … WHERE",
        () => `DELETE FROM ${q("dc_posts")} WHERE ${q("id")} = 'a'`,
      ],
    ])("reads the one table of %s", (_form, sql) => {
      expect(read(sql())).toEqual(["dc_posts"]);
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

// A DROP TABLE is read only in the shape the Builder wrote: its names, then at most the one
// CASCADE it added on PostgreSQL and MySQL, and nothing after. Any other trailing clause is a
// statement the Builder never wrote, and reads as unread.
describe.each(["postgresql", "mysql"] as const)(
  "a DROP TABLE's trailing clause on %s",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    it("reads the Builder's own CASCADE", () => {
      const sql = `DROP TABLE IF EXISTS ${q("dc_posts")} CASCADE;`;
      expect(tablesDroppedBy(sql, dialect)).toEqual(["dc_posts"]);
      expect(tablesChangedIn(sql, dialect)).toEqual(["dc_posts"]);
    });
    it.each([
      ["RESTRICT", `RESTRICT`],
      ["a second CASCADE", `CASCADE CASCADE`],
      ["a word after CASCADE", `CASCADE PURGE`],
    ])("is undefined with %s after the names", (_form, tail) => {
      const sql = `DROP TABLE ${q("dc_posts")} ${tail};`;
      expect(tablesDroppedBy(sql, dialect)).toBeUndefined();
      expect(tablesChangedIn(sql, dialect)).toBeUndefined();
    });
  }
);

// A quoted name keeps its case on PostgreSQL ("DC_POSTS" is not dc_posts), and a table name's
// case matters on MySQL too: a quoted name not written in lower case, as the Builder never wrote
// one, reads as unread, so a reader judging which entity a statement belongs to fails closed.
describe.each(["postgresql", "mysql"] as const)(
  "a quoted table name's case on %s",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    it("reads a quoted lower-case name, and an unquoted name folded", () => {
      expect(
        tablesChangedIn(
          `ALTER TABLE ${q("dc_posts")} ADD COLUMN x text`,
          dialect
        )
      ).toEqual(["dc_posts"]);
      expect(
        tablesChangedIn(`ALTER TABLE DC_POSTS ADD COLUMN x text`, dialect)
      ).toEqual(["dc_posts"]);
    });
    it("is undefined for a quoted name written in another case", () => {
      expect(
        tablesChangedIn(
          `ALTER TABLE ${q("DC_POSTS")} ADD COLUMN x text`,
          dialect
        )
      ).toBeUndefined();
      expect(
        tablesDroppedBy(`DROP TABLE ${q("Dc_Posts")};`, dialect)
      ).toBeUndefined();
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

// MySQL's upsert updates whichever row any unique key meets: a registry row's id and table name
// are unique too, so the upsert writes this slug's row only where both are the ones its slug
// derives. Built by the Builder's own writer, with one value taken from another slug's row.
describe("registryRowWrittenBy on a MySQL upsert", () => {
  const upsertOf = (slug: string) =>
    buildCollectionMetadataUpsert(
      { slug, fields: [{ name: "title", type: "text" }] },
      "mysql"
    );
  const posts = upsertOf("posts");
  // The id literal is the first value the writer puts in the row.
  const idOf = (sql: string) => /VALUES \('([^']+)'/.exec(sql)?.[1] ?? "";

  it("reads the Builder's own upsert", () => {
    expect(registryRowWrittenBy(posts, "mysql")).toEqual({
      table: "dynamic_collections",
      slug: "posts",
    });
  });

  it.each([
    [
      "another slug's id",
      () => posts.replace(idOf(posts), idOf(upsertOf("comments"))),
    ],
    [
      "another slug's table name",
      () => posts.replace("'dc_posts'", "'dc_comments'"),
    ],
    [
      "no id",
      () =>
        "INSERT INTO `dynamic_collections` (`slug`, `table_name`) VALUES ('posts', 'dc_posts') " +
        "ON DUPLICATE KEY UPDATE `table_name` = VALUES(`table_name`)",
    ],
    [
      "a registry whose keys are not derived here",
      () =>
        "INSERT INTO `r` (`id`, `slug`, `table_name`) VALUES ('1', 'posts', 'dc_posts') " +
        "ON DUPLICATE KEY UPDATE `table_name` = VALUES(`table_name`)",
    ],
  ])("reads nothing from an upsert carrying %s", (_n, sql) => {
    expect(sql()).not.toEqual(posts);
    expect(registryRowWrittenBy(sql(), "mysql")).toBeUndefined();
  });
});

// A table rename creates its destination's address, so the destination is a
// target too; a column, index or constraint rename changes the table alone.
describe.each(["postgresql", "mysql"] as const)("a rename on %s", dialect => {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  it.each([
    [
      "RENAME TO",
      () => `ALTER TABLE ${q("dc_posts")} RENAME TO ${q("dc_comments")}`,
      ["dc_posts", "dc_comments"],
    ],
    [
      "RENAME COLUMN",
      () => `ALTER TABLE ${q("dc_posts")} RENAME COLUMN ${q("a")} TO ${q("b")}`,
      ["dc_posts"],
    ],
    [
      "RENAME CONSTRAINT",
      () =>
        `ALTER TABLE ${q("dc_posts")} RENAME CONSTRAINT ${q("a")} TO ${q("b")}`,
      ["dc_posts"],
    ],
    // Each RENAME clause is read, not the first alone: MySQL takes several in one ALTER.
    [
      "a table rename after a column rename",
      () =>
        `ALTER TABLE ${q("dc_posts")} RENAME COLUMN ${q("a")} TO ${q("b")}, RENAME TO ${q("dc_comments")}`,
      ["dc_posts", "dc_comments"],
    ],
  ])("reads %s", (_n, sql, tables) => {
    expect(tablesChangedIn(sql(), dialect)).toEqual(tables);
  });
});

describe("indexesRenamedBy", () => {
  it("reads PostgreSQL's ALTER INDEX … RENAME TO as both names", () => {
    expect(
      indexesRenamedBy(
        `ALTER INDEX IF EXISTS "idx_a" RENAME TO "idx_b"`,
        "postgresql"
      )
    ).toEqual(["idx_a", "idx_b"]);
  });

  it.each([
    `ALTER INDEX "idx_a" SET TABLESPACE t`,
    `ALTER INDEX "s"."idx_a" RENAME TO "idx_b"`,
  ])("reads nothing from %s", sql => {
    expect(indexesRenamedBy(sql, "postgresql")).toBeUndefined();
  });
});

describe("a statement cut off inside a quoted name", () => {
  it("is unreadable, not a statement on the name it starts", () => {
    expect(
      tablesChangedIn(`ALTER TABLE "dc_posts`, "postgresql")
    ).toBeUndefined();
    expect(tablesDroppedBy("DROP TABLE `dc_posts", "mysql")).toBeUndefined();
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

// The statements an earlier Builder wrote into an `_i18n_` file to keep a
// translation's values: the shared archive created if absent, and the
// entity's values copied into it. Anything else on the archive reads nothing.
describe("archiveWriteOf", () => {
  const insert = (slug: string, from: string) =>
    `INSERT INTO "nextly_i18n_archive" ("collection", "entity_kind", "entry_id", "locale", "field", "value") ` +
    `SELECT '${slug}', 'collection', src."_parent", src."_locale", 'title', src."title" ` +
    `FROM "${from}" src WHERE src."_locale" <> 'en' AND ` +
    `(SELECT a."value" FROM "nextly_i18n_archive" a WHERE a."collection" = '${slug}' ORDER BY a."id" DESC LIMIT 1) IS DISTINCT FROM src."title"`;

  it.each([
    `CREATE TABLE IF NOT EXISTS "nextly_i18n_archive" ("id" serial PRIMARY KEY)`,
    `CREATE INDEX IF NOT EXISTS "nextly_i18n_archive_lookup_idx" ON "nextly_i18n_archive" ("collection")`,
  ])("reads the archive's creation if absent: %s", sql => {
    expect(archiveWriteOf(sql, "postgresql")).toEqual({ kind: "create" });
  });

  it("reads an archive copy's slug and the tables it reads", () => {
    expect(
      archiveWriteOf(insert("posts", "dc_posts_locales"), "postgresql")
    ).toEqual({
      kind: "insert",
      slug: "posts",
      reads: ["dc_posts_locales", "nextly_i18n_archive"],
    });
  });

  it.each([
    `CREATE TABLE "nextly_i18n_archive" ("id" serial PRIMARY KEY)`,
    `DELETE FROM "nextly_i18n_archive" WHERE "collection" = 'posts'`,
    `INSERT INTO "nextly_i18n_archive" ("collection") VALUES ('posts')`,
    `INSERT INTO "dc_posts" ("id") SELECT 'x' FROM "dc_posts_locales"`,
    // A FROM listing several tables reads each; one read past its first is not read here.
    insert("posts", "dc_posts_locales").replace(
      `FROM "dc_posts_locales" src`,
      `FROM "dc_posts_locales" src, "dc_comments_locales" c`
    ),
    insert("posts", "dc_posts_locales").replace(
      `FROM "dc_posts_locales" src`,
      `FROM "dc_posts_locales", "dc_comments_locales" src`
    ),
  ])("reads nothing from %s", sql => {
    expect(archiveWriteOf(sql, "postgresql")).toBeUndefined();
  });
});
