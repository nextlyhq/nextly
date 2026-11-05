/**
 * The reader of a migration file's required columns, one row per statement form and dialect,
 * and the forms that are not one. Each change says where it is counted: before the file runs
 * (no earlier write on its table, `before` naming the names the database has now) or at its
 * statement (`writtenEarlier`).
 */
import { describe, expect, it } from "vitest";

import { readNotNullChanges } from "../not-null-statements";

const read = (
  dialect: "postgresql" | "mysql" | "sqlite",
  ...statements: string[]
) => readNotNullChanges(statements, dialect);

describe("readNotNullChanges: the forms that make a column NOT NULL", () => {
  it("PostgreSQL SET NOT NULL, alone and among other clauses", () => {
    expect(
      read(
        "postgresql",
        `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
      )
    ).toEqual([
      {
        statement: 0,
        table: "dc_posts",
        column: "subtitle",
        required: "subtitle",
        before: { table: "dc_posts", column: "subtitle" },
        writtenEarlier: false,
      },
    ]);
    expect(
      read(
        "postgresql",
        `ALTER TABLE "dc_posts" ALTER COLUMN "a" TYPE varchar(10), ALTER "b" SET NOT NULL, ADD COLUMN "c" text`
      ).map(c => [c.column, c.required])
    ).toEqual([["b", "b"]]);
  });

  it("MySQL MODIFY [COLUMN] ... NOT NULL", () => {
    for (const sql of [
      "ALTER TABLE `dc_posts` MODIFY COLUMN `subtitle` varchar(255) NOT NULL",
      "ALTER TABLE `dc_posts` MODIFY `subtitle` varchar(255) NOT NULL COMMENT 'x'",
    ]) {
      expect(read("mysql", sql).map(c => [c.table, c.column])).toEqual([
        ["dc_posts", "subtitle"],
      ]);
    }
  });

  it("MySQL CHANGE old new ... NOT NULL counts the old column and requires the new", () => {
    expect(
      read(
        "mysql",
        "ALTER TABLE `dc_posts` CHANGE COLUMN `subtitle` `sub` varchar(255) NOT NULL"
      )
    ).toEqual([
      {
        statement: 0,
        table: "dc_posts",
        column: "subtitle",
        required: "sub",
        before: { table: "dc_posts", column: "subtitle" },
        writtenEarlier: false,
      },
    ]);
  });

  it("ADD [COLUMN] ... NOT NULL without a default breaks every row, on each dialect", () => {
    for (const [dialect, sql] of [
      ["postgresql", `ALTER TABLE "dc_posts" ADD COLUMN "code" text NOT NULL`],
      ["mysql", "ALTER TABLE `dc_posts` ADD `code` varchar(255) NOT NULL"],
      ["sqlite", `ALTER TABLE "dc_posts" ADD COLUMN "code" text NOT NULL`],
    ] as const) {
      expect(read(dialect, sql)).toEqual([
        {
          statement: 0,
          table: "dc_posts",
          column: null,
          required: "code",
          before: { table: "dc_posts", column: null },
          writtenEarlier: false,
        },
      ]);
    }
  });

  it("SQLite's rebuild: each NOT NULL column of the twin, by the column of t copied into it", () => {
    const changes = read(
      "sqlite",
      `CREATE TABLE "__new_dc_posts" ("id" text PRIMARY KEY NOT NULL, "title" text, "subtitle" text NOT NULL, "rank" integer NOT NULL DEFAULT 0, "code" text NOT NULL, CONSTRAINT "u" UNIQUE("title"))`,
      `INSERT INTO "__new_dc_posts" ("id", "title", "subtitle") SELECT "id", "title", "subtitle" FROM "dc_posts"`,
      `DROP TABLE "dc_posts"`,
      `ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"`
    );
    // id and subtitle copied; rank has a default; code is copied from nothing and has none.
    expect(
      changes.map(c => [c.statement, c.table, c.column, c.required])
    ).toEqual([
      [1, "dc_posts", "id", "id"],
      [1, "dc_posts", "subtitle", "subtitle"],
      [1, "dc_posts", null, "code"],
    ]);
    expect(changes.every(c => c.before?.table === "dc_posts")).toBe(true);
    expect(changes.every(c => !c.writtenEarlier)).toBe(true);
  });

  // Which schema a qualifier names is the guard's to decide, against the database: the reader
  // keeps it on the change, and reads the table under its own name.
  it("an ALTER through a qualified name, with its qualifier", () => {
    for (const [dialect, sql] of [
      [
        "postgresql",
        `ALTER TABLE "public"."dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`,
      ],
      ["mysql", "ALTER TABLE `app`.`dc_posts` MODIFY `subtitle` text NOT NULL"],
      ["sqlite", `ALTER TABLE main.dc_posts ADD COLUMN "code" text NOT NULL`],
    ] as const) {
      const [change] = read(dialect, sql);
      expect(change).toMatchObject({ table: "dc_posts" });
      expect(change.qualifier).toBe(
        dialect === "postgresql"
          ? "public"
          : dialect === "mysql"
            ? "app"
            : "main"
      );
    }
    // A name with two qualifiers is not one this reading decides.
    expect(
      read(
        "postgresql",
        `ALTER TABLE "db"."public"."dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
      )
    ).toEqual([]);
    // An unqualified one carries none.
    expect(
      read(
        "postgresql",
        `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
      )[0]
    ).not.toHaveProperty("qualifier");
  });

  // `DEFAULT NULL` leaves every existing row null, so it is no value for a NOT NULL column.
  it("ADD ... NOT NULL with DEFAULT NULL breaks every row, as one without a default does", () => {
    for (const [dialect, sql] of [
      [
        "postgresql",
        `ALTER TABLE "dc_posts" ADD COLUMN "code" text DEFAULT NULL NOT NULL`,
      ],
      [
        "postgresql",
        `ALTER TABLE "dc_posts" ADD COLUMN "code" text DEFAULT (NULL) NOT NULL`,
      ],
      [
        "postgresql",
        `ALTER TABLE "dc_posts" ADD COLUMN "code" text NOT NULL DEFAULT ((NULL))`,
      ],
      ["mysql", "ALTER TABLE `dc_posts` ADD `code` text NOT NULL DEFAULT NULL"],
    ] as const) {
      expect(read(dialect, sql)).toMatchObject([
        { column: null, required: "code" },
      ]);
    }
  });
});

describe("readNotNullChanges: statements that make nothing NOT NULL", () => {
  it.each([
    ["mysql", "ALTER TABLE `dc_posts` MODIFY COLUMN `subtitle` varchar(255)"],
    [
      "mysql",
      "ALTER TABLE `dc_posts` MODIFY COLUMN `subtitle` varchar(255) NULL",
    ],
    [
      "postgresql",
      `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET DEFAULT 'x'`,
    ],
    [
      "postgresql",
      `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" DROP NOT NULL`,
    ],
    [
      "postgresql",
      `ALTER TABLE "dc_posts" ADD COLUMN "code" text DEFAULT 'a' NOT NULL`,
    ],
    [
      "mysql",
      "ALTER TABLE `dc_posts` ADD COLUMN `code` varchar(9) NOT NULL DEFAULT ''",
    ],
    ["postgresql", `ALTER TABLE "dc_posts" ADD COLUMN "n" serial NOT NULL`],
    [
      "postgresql",
      `ALTER TABLE "dc_posts" ADD COLUMN "code" text CHECK ("code" IS NOT NULL)`,
    ],
    [
      "postgresql",
      `ALTER TABLE "dc_posts" ADD CONSTRAINT "c" CHECK ("x" IS NOT NULL)`,
    ],
    ["postgresql", `CREATE TABLE "dc_new" ("id" text NOT NULL)`],
    // A filtered copy keeps only some rows of t, which no count of t's rows can stand for.
    [
      "sqlite",
      `CREATE TABLE "__new_dc_posts" ("id" text PRIMARY KEY NOT NULL, "subtitle" text NOT NULL)`,
      `INSERT INTO "__new_dc_posts" ("id", "subtitle") SELECT "id", "subtitle" FROM "dc_posts" WHERE "subtitle" IS NOT NULL`,
    ],
    [
      "postgresql",
      `UPDATE "dc_posts" SET "subtitle" = 'ALTER TABLE x ALTER COLUMN y SET NOT NULL'`,
    ],
    [
      "postgresql",
      `-- ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL\nSELECT 1`,
    ],
  ] as const)("%s: %s", (dialect, ...statements) => {
    expect(read(dialect, ...statements)).toEqual([]);
  });
});

describe("readNotNullChanges: what the statements before a change did", () => {
  // A column the file adds to a table that already has rows is empty in every one of them unless
  // the ADD gives it a value, so making it NOT NULL later breaks every existing row.
  it("a column added empty to an existing table, then made NOT NULL, breaks every row", () => {
    expect(
      read(
        "postgresql",
        `ALTER TABLE "dc_posts" ADD COLUMN "subtitle" text`,
        `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
      )
    ).toEqual([
      {
        statement: 1,
        table: "dc_posts",
        column: "subtitle",
        required: "subtitle",
        before: { table: "dc_posts", column: null },
        writtenEarlier: false,
      },
    ]);
    expect(
      read(
        "mysql",
        "ALTER TABLE `dc_posts` ADD `subtitle` varchar(255)",
        "ALTER TABLE `dc_posts` CHANGE `subtitle` `tagline` varchar(255) NOT NULL"
      )
    ).toMatchObject([{ before: { table: "dc_posts", column: null } }]);
  });

  it("a column added with a value, or to a table the file creates, breaks no row", () => {
    expect(
      read(
        "postgresql",
        `ALTER TABLE "dc_posts" ADD COLUMN "subtitle" text DEFAULT ''`,
        `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
      )
    ).toMatchObject([{ before: null }]);
    expect(
      read(
        "postgresql",
        `CREATE TABLE "dc_new" ("id" text)`,
        `ALTER TABLE "dc_new" ADD COLUMN "subtitle" text`,
        `ALTER TABLE "dc_new" ALTER COLUMN "subtitle" SET NOT NULL`
      )
    ).toMatchObject([{ before: null }]);
  });

  it("an earlier UPDATE, INSERT or DELETE on the table counts it at its statement", () => {
    for (const write of [
      `UPDATE "dc_posts" SET "subtitle" = '' WHERE "subtitle" IS NULL`,
      `INSERT INTO "dc_posts" ("id") VALUES ('1')`,
      `DELETE FROM "dc_posts" WHERE "subtitle" IS NULL`,
    ]) {
      const [change] = read(
        "postgresql",
        write,
        `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
      );
      expect(change).toMatchObject({ statement: 1, writtenEarlier: true });
    }
  });

  it("a write on another table, or after the change, does not", () => {
    const changes = read(
      "postgresql",
      `UPDATE "dc_pages" SET "subtitle" = ''`,
      `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`,
      `UPDATE "dc_posts" SET "subtitle" = ''`
    );
    expect(changes.map(c => c.writtenEarlier)).toEqual([false]);
  });

  // MySQL's `DELETE FROM a, b USING ...` deletes from every table it lists, not only the first.
  it("a DELETE from several tables counts a later change on any of them at its statement", () => {
    for (const write of [
      "DELETE FROM `dc_pages`, `dc_posts` USING `dc_pages` JOIN `dc_posts` ON `dc_pages`.`id` = `dc_posts`.`id`",
      "DELETE FROM `dc_pages` USING `dc_pages` JOIN `dc_posts` ON `dc_pages`.`id` = `dc_posts`.`id`",
    ]) {
      const [change] = read(
        "mysql",
        write,
        "ALTER TABLE `dc_posts` MODIFY `subtitle` text NOT NULL"
      );
      expect(change).toMatchObject({ statement: 1, writtenEarlier: true });
    }
  });

  // `ADD COLUMN IF NOT EXISTS` adds nothing over a column already there, so a later NOT NULL
  // breaks that column's null rows; over none, every row, as an empty ADD does.
  it("a column added IF NOT EXISTS, then made NOT NULL, may be the one already there", () => {
    expect(
      read(
        "postgresql",
        `ALTER TABLE "dc_posts" ADD COLUMN IF NOT EXISTS "subtitle" text`,
        `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
      )
    ).toEqual([
      {
        statement: 1,
        table: "dc_posts",
        column: "subtitle",
        required: "subtitle",
        before: {
          table: "dc_posts",
          column: "subtitle",
          addedIfMissing: true,
        },
        writtenEarlier: false,
      },
    ]);
    // With a value, a column it adds breaks no row; one already there breaks its null rows.
    expect(
      read(
        "postgresql",
        `ALTER TABLE "dc_posts" ADD COLUMN IF NOT EXISTS "subtitle" text DEFAULT ''`,
        `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
      )
    ).toMatchObject([{ before: { table: "dc_posts", column: "subtitle" } }]);
  });

  // `CREATE TABLE IF NOT EXISTS` creates nothing over a table already there, which keeps its rows.
  it("a table created IF NOT EXISTS may be the one already there", () => {
    expect(
      read(
        "postgresql",
        `CREATE TABLE IF NOT EXISTS "dc_posts" ("id" text PRIMARY KEY, "subtitle" text)`,
        `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
      )
    ).toMatchObject([
      {
        statement: 1,
        before: { table: "dc_posts", column: "subtitle" },
        writtenEarlier: false,
      },
    ]);
  });

  it("a statement whose reach is not read counts every later change at its statement", () => {
    const [change] = read(
      "postgresql",
      `DO $$ BEGIN UPDATE dc_posts SET subtitle = ''; END $$`,
      `ALTER TABLE "dc_posts" ALTER COLUMN "subtitle" SET NOT NULL`
    );
    expect(change.writtenEarlier).toBe(true);
  });

  it("earlier DDL on the table is not a write: the change is still counted before the file", () => {
    const [change] = read(
      "mysql",
      "ALTER TABLE `dc_posts` ADD COLUMN `extra` varchar(255)",
      "ALTER TABLE `dc_posts` MODIFY COLUMN `subtitle` varchar(255) NOT NULL"
    );
    expect(change).toMatchObject({
      writtenEarlier: false,
      before: { table: "dc_posts", column: "subtitle" },
    });
  });

  it("renames before the change are followed back to the names the database has now", () => {
    const [change] = read(
      "postgresql",
      `ALTER TABLE "dc_posts" RENAME COLUMN "subtitle" TO "strapline"`,
      `ALTER TABLE "dc_posts" RENAME TO "dc_articles"`,
      `ALTER TABLE "dc_articles" ALTER COLUMN "strapline" SET NOT NULL`
    );
    expect(change).toMatchObject({
      table: "dc_articles",
      column: "strapline",
      before: { table: "dc_posts", column: "subtitle" },
    });
  });

  // A table the file creates holds no row it did not put there; a column it adds empty to a table
  // that had rows is null in each of them, so it is counted as an added column is: every row.
  it("a table the file created holds no row it did not put there; a column added empty to an existing one breaks every row", () => {
    expect(
      read(
        "postgresql",
        `CREATE TABLE "dc_new" ("id" text, "a" text)`,
        `ALTER TABLE "dc_new" ALTER COLUMN "a" SET NOT NULL`,
        `ALTER TABLE "dc_posts" ADD COLUMN "b" text`,
        `ALTER TABLE "dc_posts" ALTER COLUMN "b" SET NOT NULL`
      ).map(c => c.before)
    ).toEqual([null, { table: "dc_posts", column: null }]);
  });

  it("a rebuilt table is the table it rebuilt: a later rebuild counts it before the file", () => {
    const rebuild = (column: string) => [
      `CREATE TABLE "__new_dc_posts" ("id" text PRIMARY KEY NOT NULL, "${column}" text NOT NULL)`,
      `INSERT INTO "__new_dc_posts" ("id", "${column}") SELECT "id", "${column}" FROM "dc_posts"`,
      `DROP TABLE "dc_posts"`,
      `ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"`,
    ];
    const changes = read("sqlite", ...rebuild("a"), ...rebuild("a"));
    expect(changes.filter(c => c.column === "a").map(c => c.before)).toEqual([
      { table: "dc_posts", column: "a" },
      { table: "dc_posts", column: "a" },
    ]);
  });
});
