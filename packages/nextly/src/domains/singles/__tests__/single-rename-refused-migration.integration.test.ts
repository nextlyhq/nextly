/**
 * A Single's settings save that renames a translated field and changes the main table too, when
 * the main table's migration is refused.
 *
 * The save renames the companion column before the main migration, so a refused RENAME fails the
 * save with the old field still recorded. When it is the main migration that is refused instead,
 * the column has to go back to the old name with the record, or the Single's reads ask for a column
 * that is no longer there until it is saved again.
 *
 * The refusal is staged by holding the migration runner, since what a database refuses differs by
 * dialect and the point is what happens after any refusal, not which one.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

/** Whether the main table's migration is refused, for the test that stages it. */
const refusal = vi.hoisted(() => ({ on: false }));

vi.mock("../../schema/services/apply-migration-statements", async original => {
  const actual =
    await original<
      typeof import("../../schema/services/apply-migration-statements")
    >();
  return {
    ...actual,
    applyMigrationWhole: async (
      args: Parameters<typeof actual.applyMigrationWhole>[0]
    ) => {
      if (refusal.on) throw new Error("the database refused the migration");
      return actual.applyMigrationWhole(args);
    },
  };
});

const LOCALES = ["en", "es"];
const TRANSLATED = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];
/** `heading` renamed to `title2`, still translated. Only one field may change for a rename. */
const RENAMED = [
  { name: "title2", type: "text" },
  { name: "views", type: "number" },
];
/**
 * The save: the rename, and Draft/Published turned on, which changes the main table without
 * adding a field (an added field beside the rename would read as a drop and two adds).
 */
const RENAME_AND_STATUS = { fields: RENAMED, status: true };

/** A dialect's identifier quoting, for the raw reads below. */
function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "a Single's rename when its main migration is refused",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The Single's update path runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      refusal.on = false;
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: LOCALES, defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      refusal.on = false;
      await current.destroy();
      vi.unstubAllEnvs();
    });

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    /** Each language's value of one companion column, by language. */
    async function companionValues(
      column: string
    ): Promise<Record<string, unknown>> {
      const rows = await query<{ locale: string; value: unknown }>(
        `SELECT ${quote(dialect, "_locale")} AS locale, ${quote(dialect, column)} AS value FROM ${quote(dialect, "single_hero_locales")}`
      );
      return Object.fromEntries(rows.map(row => [row.locale, row.value]));
    }

    /** A translated Single whose `heading` holds "Hello" in English and "Hola" in Spanish. */
    async function seedSingle(): Promise<void> {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "hero", label: "Hero", localized: true, fields: TRANSLATED }
      );
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      for (const [locale, heading] of [
        ["en", "Hello"],
        ["es", "Hola"],
      ]) {
        const written = await singles.update(
          "hero",
          { heading, views: 7 },
          { locale, overrideAccess: true }
        );
        expect(written.success, JSON.stringify(written)).toBe(true);
      }
    }

    it("leaves the translations under the old name, readable, and finishes the rename when saved again", async () => {
      await seedSingle();

      refusal.on = true;
      const refused = await dispatchSingles(
        "updateSingleSchema",
        { slug: "hero" },
        RENAME_AND_STATUS
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refused).toBeDefined();
      expect(await companionValues("heading")).toEqual({
        en: "Hello",
        es: "Hola",
      });

      refusal.on = false;
      await dispatchSingles(
        "updateSingleSchema",
        { slug: "hero" },
        RENAME_AND_STATUS
      );

      expect(await companionValues("title2")).toEqual({
        en: "Hello",
        es: "Hola",
      });
    });
  }
);
