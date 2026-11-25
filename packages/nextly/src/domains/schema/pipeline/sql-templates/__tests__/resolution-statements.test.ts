/**
 * A fill a migration file writes for a Required date column is the instant the
 * push binds, in the literal each dialect's date column reads: an ISO
 * timestamp on PostgreSQL, the UTC datetime MySQL's pinned session takes, and
 * the epoch seconds SQLite stores.
 *
 * For a field kept per language, the statements settle the entries without a
 * value in the default language on the translations table: a delete removes
 * such an entry before every language's row of it, and a fill fills the
 * default-language rows holding NULL and adds one where an entry has none,
 * each row it writes stamped.
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

  it("deletes an entry without the value, then every language's row of it", () => {
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
      "DELETE FROM `dc_posts` WHERE `id` NOT IN (SELECT DISTINCT `_parent` FROM `dc_posts_locales` WHERE `_locale` = 'en' AND `note` IS NOT NULL);",
      "DELETE FROM `dc_posts_locales` WHERE `_parent` NOT IN (SELECT `_parent` FROM (SELECT DISTINCT `_parent` FROM `dc_posts_locales` WHERE `_locale` = 'en' AND `note` IS NOT NULL) AS `fitting`) AND `_parent` NOT IN (SELECT `id` FROM `dc_posts`);",
    ]);
  });

  it("fills and stamps the default-language rows without the value, and adds one where an entry has none", () => {
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
      `UPDATE "dc_posts_locales" SET "note" = 'it''s', "_updated_at" = statement_timestamp() WHERE "_locale" = 'en' AND "note" IS NULL;`,
      `INSERT INTO "dc_posts_locales" ("_parent", "_locale", "_updated_at", "note") SELECT "id", 'en', statement_timestamp(), 'it''s' FROM "dc_posts" WHERE "id" NOT IN (SELECT "_parent" FROM (SELECT DISTINCT "_parent" FROM "dc_posts_locales" WHERE "_locale" = 'en') AS "with_row");`,
    ]);
  });

  it.each([
    ["postgresql", "statement_timestamp()"],
    ["mysql", "UTC_TIMESTAMP(3)"],
    ["sqlite", "CAST(strftime('%s', 'now') AS INTEGER)"],
  ] as const)(
    "stamps a fill's rows with %s's clock, read when the statement runs and stored as the runtime stores it",
    (dialect, clock) => {
      const [update, insert] = resolutionStatements(
        {
          tableName: "dc_posts",
          columnName: "note",
          kind: "fill",
          value: "filled",
          perLanguage,
        },
        dialect
      );
      expect(update).toContain(`= ${clock} WHERE`);
      expect(insert).toContain(`, ${clock}, 'filled'`);
    }
  );
});
