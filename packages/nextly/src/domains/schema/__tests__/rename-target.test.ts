/**
 * The check every rename road asks before it runs, and the reading that keeps a runner from passing
 * over a refused rename.
 *
 * A rename is a move of a field's values from one column to another, within a table or between the
 * main table and its companion. The decision refuses a move whose new column is already there
 * beside its old one, on the table it ends on or, between tables, the one it starts from; and
 * passes one whose old column is gone, which an earlier stopped run already made. Names are
 * compared as each database compares them.
 *
 * `isRenameStatement` reads a statement's keywords only: a rename-like phrase inside a string
 * literal (a column's default), a comment or a quoted name is not a rename, or a runner would stop
 * passing over the re-run of an ordinary ADD whose default happens to read like one.
 */
import { describe, expect, it } from "vitest";

import {
  identifierKey,
  isRenameStatement,
  movesOntoTakenColumns,
  renameTargetTakenMessage,
  type ColumnMove,
} from "../rename-target";

describe("isRenameStatement", () => {
  it.each([
    `ALTER TABLE "t" RENAME COLUMN "a" TO "b"`,
    "ALTER TABLE `t` RENAME COLUMN `a` TO `b`",
    `ALTER TABLE "t" RENAME TO "u"`,
    "RENAME TABLE `t` TO `u`",
    `ALTER INDEX "i" RENAME TO "j"`,
    `-- Update dynamic collection: t\nALTER TABLE "t" RENAME COLUMN "a" TO "b"`,
  ])("names %j a rename", statement => {
    expect(isRenameStatement(statement)).toBe(true);
  });

  it.each([
    ["an ADD", `ALTER TABLE "t" ADD COLUMN "b" text`],
    [
      "an ADD whose default reads like a rename",
      "ALTER TABLE `t` ADD COLUMN `b` text DEFAULT 'ALTER TABLE t RENAME COLUMN id TO title'",
    ],
    [
      "an ADD whose default is the word rename",
      "ALTER TABLE `t` ADD COLUMN `b` varchar(20) DEFAULT 'rename'",
    ],
    [
      "an ADD of a column named rename",
      `ALTER TABLE "t" ADD COLUMN "rename" text`,
    ],
    [
      "an ADD after a comment that mentions a rename",
      `-- rename heading later\nALTER TABLE "t" ADD COLUMN "b" text`,
    ],
    ["a CREATE TABLE", `CREATE TABLE "renamed" ("id" integer)`],
    [
      "an ADD whose default holds a doubled quote and a rename",
      "ALTER TABLE `t` ADD COLUMN `b` text DEFAULT 'it''s RENAME time'",
    ],
  ])("does not name %s a rename", (_label, statement) => {
    expect(isRenameStatement(statement)).toBe(false);
  });
});

describe("identifierKey", () => {
  it("keeps a PostgreSQL name as it is spelled", () => {
    expect(identifierKey("postgresql", "HEADLINE")).toBe("HEADLINE");
  });

  it.each(["mysql", "sqlite"] as const)(
    "compares a %s name without regard to case",
    dialect => {
      expect(identifierKey(dialect, "HEADLINE")).toBe(
        identifierKey(dialect, "headline")
      );
    }
  );
});

describe("movesOntoTakenColumns", () => {
  const inTable: ColumnMove = {
    field: "headline",
    fromTable: "single_hero",
    fromColumn: "heading",
    toTable: "single_hero",
    toColumn: "headline",
  };
  const leaving: ColumnMove = {
    field: "headline",
    fromTable: "single_hero_locales",
    fromColumn: "heading",
    toTable: "single_hero",
    toColumn: "headline",
  };
  const live = (tables: Record<string, string[]>) =>
    new Map(
      Object.entries(tables).map(([table, columns]) => [
        table,
        new Set(columns.map(column => identifierKey("mysql", column))),
      ])
    );

  it("refuses a rename whose new column is there beside its old one", () => {
    expect(
      movesOntoTakenColumns(
        [inTable],
        live({ single_hero: ["heading", "headline"] }),
        "mysql"
      )
    ).toEqual([{ move: inTable, table: "single_hero" }]);
  });

  it("passes a rename an earlier run already made: the new column there, the old one gone", () => {
    expect(
      movesOntoTakenColumns(
        [inTable],
        live({ single_hero: ["headline"] }),
        "mysql"
      )
    ).toEqual([]);
  });

  it("passes a rename onto a free name", () => {
    expect(
      movesOntoTakenColumns(
        [inTable],
        live({ single_hero: ["heading"] }),
        "mysql"
      )
    ).toEqual([]);
  });

  it("refuses a move between tables onto a column the table it ends on has", () => {
    expect(
      movesOntoTakenColumns(
        [leaving],
        live({
          single_hero: ["headline"],
          single_hero_locales: ["heading"],
        }),
        "mysql"
      )
    ).toEqual([{ move: leaving, table: "single_hero" }]);
  });

  it("refuses a move between tables onto a column the table it starts from has, where its rename runs first", () => {
    expect(
      movesOntoTakenColumns(
        [leaving],
        live({
          single_hero: [],
          single_hero_locales: ["heading", "headline"],
        }),
        "mysql"
      )
    ).toEqual([{ move: leaving, table: "single_hero_locales" }]);
  });

  it("passes a move between tables that an earlier run already made", () => {
    expect(
      movesOntoTakenColumns(
        [leaving],
        live({ single_hero: ["headline"], single_hero_locales: [] }),
        "mysql"
      )
    ).toEqual([]);
  });

  it("finds a column spelled in another case on MySQL and SQLite, and not on PostgreSQL", () => {
    const spelled = new Set(["heading", "HEADLINE"]);
    expect(
      movesOntoTakenColumns(
        [inTable],
        new Map([
          [
            "single_hero",
            new Set([...spelled].map(c => identifierKey("sqlite", c))),
          ],
        ]),
        "sqlite"
      )
    ).toHaveLength(1);
    expect(
      movesOntoTakenColumns(
        [inTable],
        new Map([
          [
            "single_hero",
            new Set([...spelled].map(c => identifierKey("postgresql", c))),
          ],
        ]),
        "postgresql"
      )
    ).toEqual([]);
  });
});

describe("renameTargetTakenMessage", () => {
  it("names the table holding the column and both columns", () => {
    expect(
      renameTargetTakenMessage({
        move: {
          field: "headline",
          fromTable: "single_hero_locales",
          fromColumn: "heading",
          toTable: "single_hero",
          toColumn: "headline",
        },
        table: "single_hero",
      })
    ).toBe(
      "Column 'heading' cannot be renamed to 'headline': table 'single_hero' already has a column 'headline'. Remove or rename that column first, then save again."
    );
  });
});
