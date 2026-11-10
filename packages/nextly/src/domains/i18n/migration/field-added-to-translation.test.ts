// An `adds` file leaves out the ADD of a column its translations table already has, read off the
// statements the file is written with on each dialect, so the run adopts the column instead of
// failing on a duplicate column name.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { splitSqlStatements } from "../../schema/migrate/split-sql";

import {
  planFieldAddedToTranslationMigration,
  withoutColumnsAlreadyThere,
} from "./field-added-to-translation";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** The UP statements of the `adds` file for `code` and `note` added beside `title`. */
function addsStatements(dialect: SupportedDialect): string[] {
  const plan = planFieldAddedToTranslationMigration({
    slug: "docs",
    kind: "collection",
    tableName: "dc_docs",
    dialect,
    defaultLocale: "en",
    status: false,
    recorded: [{ name: "title", type: "text", localized: true }],
    added: [
      { name: "code", type: "text", localized: true },
      { name: "note", type: "text", localized: true },
    ],
  });
  return splitSqlStatements(plan.upSql, dialect);
}

describe.each(DIALECTS)(
  "an adds file's columns already there (%s)",
  dialect => {
    it("adds one statement per column, so each can be left out alone", () => {
      expect(addsStatements(dialect)).toHaveLength(2);
    });

    it("leaves out the ADD of a column the translations table has", () => {
      const statements = addsStatements(dialect);
      const kept = withoutColumnsAlreadyThere(
        statements,
        "dc_docs_locales",
        new Set(["_parent", "_locale", "title", "code"])
      );
      expect(kept).toHaveLength(1);
      expect(kept[0]).toMatch(/note/);
      expect(kept[0]).not.toMatch(/code/);
    });

    it("keeps every ADD when none of the columns is there", () => {
      const statements = addsStatements(dialect);
      expect(
        withoutColumnsAlreadyThere(
          statements,
          "dc_docs_locales",
          new Set(["_parent", "_locale", "title"])
        )
      ).toEqual(statements);
    });

    it("keeps an ADD to another table whose column has the same name", () => {
      const statements = addsStatements(dialect);
      expect(
        withoutColumnsAlreadyThere(
          statements,
          "dc_other_locales",
          new Set(["code", "note"])
        )
      ).toEqual(statements);
    });
  }
);
