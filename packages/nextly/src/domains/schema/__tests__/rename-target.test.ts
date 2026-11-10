/**
 * The check every rename road asks before it runs: which column renames a change makes, and which
 * of them land on a column the table already has.
 *
 * The renames are read from the statements a change is about to run, so the reader must find each
 * as every generator writes it (PostgreSQL's and SQLite's quotes, MySQL's backticks), among other
 * statements and comments, and nothing else. The decision refuses a rename whose new column is
 * there beside its old one, and passes one whose old column is gone, which an earlier stopped run
 * already made.
 */
import { describe, expect, it } from "vitest";

import {
  columnRenamesIn,
  isRenameStatement,
  renamesOntoTakenColumns,
  renameTargetTakenMessage,
} from "../rename-target";

describe("columnRenamesIn", () => {
  it.each([
    [
      "PostgreSQL and SQLite quotes",
      `ALTER TABLE "single_hero" RENAME COLUMN "heading" TO "headline"`,
    ],
    [
      "MySQL backticks",
      "ALTER TABLE `single_hero` RENAME COLUMN `heading` TO `headline`",
    ],
    ["bare names", "alter table single_hero rename column heading to headline"],
  ])("reads a rename written with %s", (_label, sql) => {
    expect(columnRenamesIn(sql)).toEqual([
      { table: "single_hero", from: "heading", to: "headline" },
    ]);
  });

  it("reads every rename among other statements and comments, in order", () => {
    const sql = [
      "-- Update dynamic collection: single_hero",
      `ALTER TABLE "single_hero" ADD COLUMN "summary" text;`,
      `ALTER TABLE "single_hero" RENAME COLUMN "heading" TO "headline";`,
      `ALTER TABLE "single_hero_locales" RENAME COLUMN "title" TO "name";`,
      `CREATE INDEX "idx" ON "single_hero" ("summary");`,
    ].join("\n");
    expect(columnRenamesIn(sql)).toEqual([
      { table: "single_hero", from: "heading", to: "headline" },
      { table: "single_hero_locales", from: "title", to: "name" },
    ]);
  });

  it("reads statements handed as a list", () => {
    expect(
      columnRenamesIn([
        `ALTER TABLE "a" RENAME COLUMN "x" TO "y"`,
        "ALTER TABLE `b` RENAME COLUMN `p` TO `q`",
      ])
    ).toEqual([
      { table: "a", from: "x", to: "y" },
      { table: "b", from: "p", to: "q" },
    ]);
  });

  it("unquotes a doubled quote inside a name", () => {
    expect(
      columnRenamesIn(`ALTER TABLE "t" RENAME COLUMN "a""b" TO "c"`)
    ).toEqual([{ table: "t", from: 'a"b', to: "c" }]);
  });

  it.each([
    `ALTER TABLE "t" ADD COLUMN "headline" text`,
    `ALTER TABLE "t" RENAME TO "u"`,
    `ALTER TABLE "t" DROP COLUMN "heading"`,
  ])("reads no column rename in %s", sql => {
    expect(columnRenamesIn(sql)).toEqual([]);
  });
});

describe("isRenameStatement", () => {
  it.each([
    `ALTER TABLE "t" RENAME COLUMN "a" TO "b"`,
    `ALTER TABLE "t" RENAME TO "u"`,
    "RENAME TABLE `t` TO `u`",
    `ALTER INDEX "i" RENAME TO "j"`,
    `-- Update dynamic collection: t\nALTER TABLE "t" RENAME COLUMN "a" TO "b"`,
  ])("names %j a rename", statement => {
    expect(isRenameStatement(statement)).toBe(true);
  });

  it.each([
    `ALTER TABLE "t" ADD COLUMN "b" text`,
    `CREATE TABLE "renamed" ("id" integer)`,
    `CREATE INDEX "idx" ON "t" ("a")`,
  ])("does not name %j a rename", statement => {
    expect(isRenameStatement(statement)).toBe(false);
  });
});

describe("renamesOntoTakenColumns", () => {
  const rename = { table: "single_hero", from: "heading", to: "headline" };

  it("refuses a rename whose new column is there beside its old one", () => {
    const live = new Map([["single_hero", new Set(["heading", "headline"])]]);
    expect(renamesOntoTakenColumns([rename], live)).toEqual([rename]);
  });

  it("passes a rename an earlier run already made: the new column there, the old one gone", () => {
    const live = new Map([["single_hero", new Set(["headline"])]]);
    expect(renamesOntoTakenColumns([rename], live)).toEqual([]);
  });

  it("passes a rename onto a free name", () => {
    const live = new Map([["single_hero", new Set(["heading"])]]);
    expect(renamesOntoTakenColumns([rename], live)).toEqual([]);
  });

  it("judges each rename against its own table", () => {
    const other = { table: "single_hero_locales", from: "a", to: "b" };
    const live = new Map([
      ["single_hero", new Set(["heading"])],
      ["single_hero_locales", new Set(["a", "b"])],
    ]);
    expect(renamesOntoTakenColumns([rename, other], live)).toEqual([other]);
  });
});

describe("renameTargetTakenMessage", () => {
  it("names the table and both columns", () => {
    expect(
      renameTargetTakenMessage({
        table: "single_hero",
        from: "heading",
        to: "headline",
      })
    ).toBe(
      "Column 'heading' cannot be renamed to 'headline': table 'single_hero' already has a column 'headline'. Remove or rename that column first, then save again."
    );
  });
});
