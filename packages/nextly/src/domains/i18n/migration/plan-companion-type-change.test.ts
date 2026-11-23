// A `retypes` file gives a translated field's translations column the type its new field type
// makes there, on each database, naming that column alone: a column it does not know of (a
// translated repeater's values kept beside the fields' columns) is never read or changed.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { splitSqlStatements } from "../../schema/migrate/split-sql";

import { planCompanionTypeChange } from "./plan-companion-type-change";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** The `retypes` file for `price`, a translated text becoming a number, beside an unchanged `title`. */
function plan(dialect: SupportedDialect, extra: { unique?: boolean } = {}) {
  return planCompanionTypeChange({
    slug: "docs",
    kind: "collection",
    tableName: "dc_docs",
    dialect,
    defaultLocale: "en",
    fields: [
      {
        from: { name: "title", type: "text", localized: true },
        to: { name: "title", type: "text", localized: true },
      },
      {
        from: { name: "price", type: "text", localized: true, ...extra },
        to: { name: "price", type: "number", localized: true, ...extra },
      },
    ],
    builtBy: "collection",
  });
}

describe("planCompanionTypeChange", () => {
  it.each(DIALECTS)(
    "retypes only the changing field's column on %s, and records it with its field",
    dialect => {
      const found = plan(dialect);

      expect(found?.spec.retyped).toEqual([
        { field: "price", column: "price" },
      ]);
      expect(found?.spec.columns.map(column => column.name)).toEqual(["price"]);
      expect(found?.spec.companionTable).toBe("dc_docs_locales");
      const up = splitSqlStatements(found?.upSql ?? "", dialect);
      expect(up.length).toBeGreaterThan(0);
      // Every statement names the changing column and the translations table alone.
      for (const statement of up) {
        expect(statement).toMatch(/dc_docs_locales/);
        expect(statement).toMatch(/price/);
        expect(statement).not.toMatch(/title/);
      }
    }
  );

  it("casts the column as each database's main-table change does", () => {
    expect(plan("postgresql")?.upSql).toMatch(
      /ALTER TABLE "dc_docs_locales" ALTER COLUMN "price" TYPE INTEGER USING "price"::INTEGER/
    );
    expect(plan("mysql")?.upSql).toMatch(
      /ALTER TABLE `dc_docs_locales` MODIFY COLUMN `price` INT NULL/
    );
    const sqlite = splitSqlStatements(plan("sqlite")?.upSql ?? "", "sqlite");
    expect(sqlite).toEqual([
      'ALTER TABLE "dc_docs_locales" ADD COLUMN "__retype_price" INTEGER',
      'UPDATE "dc_docs_locales" SET "__retype_price" = CAST("price" AS INTEGER)',
      'ALTER TABLE "dc_docs_locales" DROP COLUMN "price"',
      'ALTER TABLE "dc_docs_locales" RENAME COLUMN "__retype_price" TO "price"',
    ]);
  });

  it("goes back to the old type on the way down", () => {
    expect(plan("postgresql")?.downSql).toMatch(
      /ALTER COLUMN "price" TYPE TEXT USING "price"::TEXT/
    );
  });

  // The index's key depends on the column's type (a text leaves its blank out), so a field unique
  // in each language before and after has its index dropped first and made again on the new type.
  it.each(DIALECTS)(
    "drops a unique field's per-language index before the change and makes it again after on %s",
    dialect => {
      const up = splitSqlStatements(
        plan(dialect, { unique: true })?.upSql ?? "",
        dialect
      );

      expect(up[0]).toMatch(/^DROP INDEX/);
      expect(up.at(-1)).toMatch(/^CREATE UNIQUE INDEX/);
      // On the new column a number is keyed as it is, with no blank to leave out.
      expect(up.at(-1)).not.toMatch(/NULLIF|<> ''/);
    }
  );

  it("plans nothing where no translations column takes another type here", () => {
    expect(
      planCompanionTypeChange({
        slug: "docs",
        kind: "collection",
        tableName: "dc_docs",
        dialect: "sqlite",
        defaultLocale: "en",
        // A checkbox and a number are both an integer column on SQLite.
        fields: [
          {
            from: { name: "flag", type: "checkbox", localized: true },
            to: { name: "flag", type: "number", localized: true },
          },
        ],
        builtBy: "collection",
      })
    ).toBeUndefined();
  });
});
