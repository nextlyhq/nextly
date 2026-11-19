/**
 * A Single's schema save changes whether a column may be empty on every dialect: Required turned
 * on makes it NOT NULL, Required turned off makes it nullable, and a Required field leaving
 * translation is NOT NULL once its values are shared.
 *
 * SQLite can't alter a column, so there the save rebuilds the table, with foreign keys off so the
 * translations table's `ON DELETE CASCADE` doesn't fire, keeping every row, key, index and
 * translation. A one-to-one's inline UNIQUE, which the live table spec doesn't carry, is kept as a
 * unique index. A table the rebuild can't reproduce, one with a trigger, is refused unchanged.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

interface CollectionsHandler {
  createCollection(input: Record<string, unknown>): Promise<{
    success: boolean;
  }>;
}

const TABLE = "single_hero";
const COMPANION = `${TABLE}_locales`;
const TITLE = { name: "title", type: "text" };
const BODY = { name: "body", type: "text" };
/** A one-to-one to `people`, whose column the create path makes UNIQUE inline. */
const PROFILE = {
  name: "profile",
  type: "relationship",
  options: { target: "people", relationType: "oneToOne", onDelete: "set null" },
};
/**
 * The same field as a schema save sends it, in the manifest's shape: the editor reads the stored
 * one-to-one with its target and Unique (`withEditorRelationshipShape`) and sends both back.
 */
const PROFILE_SAVED = {
  name: "profile",
  type: "relationship",
  relationTo: "people",
  unique: true,
};

describeEachDialect(
  "a Single's schema save changes whether a column may be empty",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The builder's update path runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    async function notNull(table: string, column: string): Promise<boolean> {
      const [row] = await query<{ required: number | string }>(
        dialect === "sqlite"
          ? `SELECT "notnull" AS required FROM pragma_table_info('${table}') WHERE name = '${column}'`
          : dialect === "mysql"
            ? `SELECT IF(IS_NULLABLE = 'NO', 1, 0) AS required FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`
            : `SELECT CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS required FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = '${column}'`
      );
      return Number(row?.required) === 1;
    }

    async function mainValue(column: string): Promise<unknown> {
      const [row] = await query<{ value: unknown }>(
        `SELECT ${q(column)} AS value FROM ${q(TABLE)}`
      );
      return row?.value;
    }

    async function createHero(
      fields: unknown[],
      localized = false
    ): Promise<void> {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "hero", label: "Hero", localized, fields }
      );
    }

    async function write(
      data: Record<string, unknown>,
      locale = "en"
    ): Promise<void> {
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      const written = await singles.update(
        "hero",
        { ...data, _overwrite: true },
        { locale, overrideAccess: true }
      );
      expect(written.success, JSON.stringify(written)).toBe(true);
    }

    async function save(fields: unknown[]): Promise<void> {
      await dispatchSingles("updateSingleSchema", { slug: "hero" }, { fields });
    }

    function attempt(promise: Promise<void>): Promise<unknown> {
      return promise.then(
        () => undefined,
        (error: unknown) => error
      );
    }

    it("makes a column NOT NULL when Required is turned on, keeping its value", async () => {
      await createHero([TITLE, BODY]);
      await write({ title: "T", body: "Hi" });

      await save([TITLE, { ...BODY, required: true }]);

      expect(await notNull(TABLE, "body")).toBe(true);
      expect(await mainValue("body")).toBe("Hi");
    });

    it("makes a column nullable when Required is turned off", async () => {
      await createHero([TITLE, { ...BODY, required: true }]);
      await write({ title: "T", body: "Hi" });

      await save([TITLE, BODY]);

      expect(await notNull(TABLE, "body")).toBe(false);
      expect(await mainValue("body")).toBe("Hi");
    });

    it.skipIf(dialect !== "sqlite")(
      "keeps a translated Single's translations, keys and indexes through the rebuild, and a delete still cascades",
      async () => {
        await createHero([TITLE, BODY], true);
        await write({ title: "T", body: "Hello" });
        await write({ title: "T-es", body: "Hola" }, "es");
        const indexes = (table: string) =>
          query<{ name: string; unique: number }>(
            `SELECT name, "unique" AS "unique" FROM pragma_index_list('${table}') ORDER BY name`
          );
        const keys = () =>
          query<Record<string, unknown>>(
            `SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('${COMPANION}')`
          );
        const before = {
          main: await indexes(TABLE),
          companion: await indexes(COMPANION),
          keys: await keys(),
        };

        await save([TITLE, { ...BODY, localized: false, required: true }]);

        expect(await notNull(TABLE, "body")).toBe(true);
        expect(await mainValue("body")).toBe("Hello");
        expect(
          await query(
            `SELECT _locale, title FROM ${q(COMPANION)} ORDER BY _locale`
          )
        ).toEqual([
          { _locale: "en", title: "T" },
          { _locale: "es", title: "T-es" },
        ]);
        expect(await indexes(TABLE)).toEqual(before.main);
        expect(await indexes(COMPANION)).toEqual(before.companion);
        expect(await keys()).toEqual(before.keys);
        expect(await query("PRAGMA foreign_key_check")).toEqual([]);

        await query(`DELETE FROM ${q(TABLE)}`);
        expect(await query(`SELECT _locale FROM ${q(COMPANION)}`)).toEqual([]);
      }
    );

    it.skipIf(dialect !== "sqlite")(
      "keeps a one-to-one's column unique through the rebuild",
      async () => {
        const created = await (
          current.getService(
            "collectionsHandler"
          ) as unknown as CollectionsHandler
        ).createCollection({
          name: "people",
          label: "Person",
          fields: [{ name: "name", type: "text" }],
        });
        expect(created.success, JSON.stringify(created)).toBe(true);
        await createHero([TITLE, BODY, PROFILE]);
        await write({ title: "T", body: "Hi" });
        const uniqueOnProfile = () =>
          query<{ name: string }>(
            `SELECT il.name AS name FROM pragma_index_list('${TABLE}') AS il, pragma_index_info(il.name) AS ii ` +
              `WHERE il."unique" = 1 AND ii.name = 'profile'`
          );
        expect(await uniqueOnProfile()).toHaveLength(1);

        await save([TITLE, { ...BODY, required: true }, PROFILE_SAVED]);

        expect(await notNull(TABLE, "body")).toBe(true);
        expect(await uniqueOnProfile()).toHaveLength(1);
      }
    );

    it.skipIf(dialect !== "sqlite")(
      "refuses the change on a Single whose table has a trigger, changing nothing",
      async () => {
        await createHero([TITLE, BODY]);
        await write({ title: "T", body: "Hi" });
        await query(
          `CREATE TRIGGER hero_touched AFTER UPDATE ON ${q(TABLE)} BEGIN SELECT 1; END`
        );

        const refusal = await attempt(
          save([TITLE, { ...BODY, required: true }])
        );

        expect(refusal).toBeInstanceOf(Error);
        expect(
          `${(refusal as Error).message} ${JSON.stringify((refusal as { publicData?: unknown }).publicData ?? null)}`
        ).toMatch(/trigger/);
        expect(await notNull(TABLE, "body")).toBe(false);
        expect(
          await query(
            `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = '${TABLE}'`
          )
        ).toEqual([{ name: "hero_touched" }]);
      }
    );
  }
);
