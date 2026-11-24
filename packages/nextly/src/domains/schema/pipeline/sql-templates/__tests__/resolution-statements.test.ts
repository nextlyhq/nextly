/**
 * A fill a migration file writes for a Required date column is the instant the
 * push binds, in the literal each dialect's date column reads: an ISO
 * timestamp on PostgreSQL, the UTC datetime MySQL's pinned session takes, and
 * the epoch seconds SQLite stores.
 *
 * For a field kept per language, the statements settle the entries without a
 * value in the default language on the translations table: a delete removes
 * every language's row of such an entry before the entry, and a fill fills the
 * default-language rows holding NULL and adds one where an entry has none.
 * Where a statement reads the table it changes, it does so through a derived
 * table of distinct rows, which MySQL requires.
 */
import { describe, expect, it } from "vitest";

import {
  resolutionStatement,
  resolutionStatements,
} from "../resolution-statements";

const at = new Date(Date.UTC(2026, 10, 11, 9, 30, 15, 250));
const fill = (value: unknown) =>
  ({
    tableName: "dc_posts",
    columnName: "published_on",
    kind: "fill",
    value,
  }) as const;

describe("resolutionStatement for a date fill", () => {
  it.each([
    ["postgresql", `'2026-11-11T09:30:15.250Z'`],
    ["mysql", `'2026-11-11 09:30:15.250'`],
    ["sqlite", String(Math.floor(at.getTime() / 1000))],
  ] as const)("writes the instant as %s reads a date", (dialect, literal) => {
    expect(resolutionStatement(fill(at), dialect)).toContain(
      `= ${literal} WHERE`
    );
  });

  it("still refuses a value no column stores", () => {
    expect(() =>
      resolutionStatement(fill(new Date(Number.NaN)), "postgresql")
    ).toThrow(/must be a string, a finite number, a boolean or a date/);
    expect(() =>
      resolutionStatement(fill({ not: "a date" }), "postgresql")
    ).toThrow(/must be a string/);
  });
});

describe("resolutionStatements for a field kept per language", () => {
  const perLanguage = { companionTable: "dc_posts_locales", locale: "en" };

  it("deletes every language's row of an entry without the value, then the entry", () => {
    expect(
      resolutionStatements(
        {
          tableName: "dc_posts",
          columnName: "note",
          kind: "delete_nonconforming",
          perLanguage,
        },
        "mysql"
      )
    ).toEqual([
      "DELETE FROM `dc_posts_locales` WHERE `_parent` NOT IN (SELECT `_parent` FROM (SELECT DISTINCT `_parent` FROM `dc_posts_locales` WHERE `_locale` = 'en' AND `note` IS NOT NULL) AS `fitting`);",
      "DELETE FROM `dc_posts` WHERE `id` NOT IN (SELECT DISTINCT `_parent` FROM `dc_posts_locales` WHERE `_locale` = 'en' AND `note` IS NOT NULL);",
    ]);
  });

  it("fills the default-language rows without the value, and adds one where an entry has none", () => {
    expect(
      resolutionStatements(
        {
          tableName: "dc_posts",
          columnName: "note",
          kind: "fill",
          value: "it's",
          perLanguage,
        },
        "postgresql"
      )
    ).toEqual([
      `UPDATE "dc_posts_locales" SET "note" = 'it''s' WHERE "_locale" = 'en' AND "note" IS NULL;`,
      `INSERT INTO "dc_posts_locales" ("_parent", "_locale", "note") SELECT "id", 'en', 'it''s' FROM "dc_posts" WHERE "id" NOT IN (SELECT "_parent" FROM (SELECT DISTINCT "_parent" FROM "dc_posts_locales" WHERE "_locale" = 'en') AS "with_row");`,
    ]);
  });
});
