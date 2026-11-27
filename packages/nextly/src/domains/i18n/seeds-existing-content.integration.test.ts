/**
 * Enabling localization on an entity that already has content must not hide it, on every dialect.
 *
 * The `db:sync` reproduction for this runs against SQLite only — it builds a SQLite adapter
 * directly — so the copy itself had never executed against PostgreSQL or MySQL. The statements are
 * dialect-specific in identifier quoting and in how a status column is carried across, and this is
 * a path that moves a user's content, so "the generator is unit-tested per dialect" is not the same
 * claim as "the copy works there".
 *
 * Drives `ensureCompanionTable` rather than the CLI sequence: the orchestration is already covered
 * on SQLite, and what was unproven is the seed reaching a real server.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../collections/config/define-collection";
import { number, repeater, text } from "../../collections/fields";
import { parsedValue } from "../../shared/lib/json-column-value";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";

import { buildLocalizationDownStatements } from "./migration/generate-down";
import {
  ensureCompanionTable,
  localizedColumnsOnMain,
  reconcileCompanionColumns,
} from "./runtime/companion-io";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "seeding existing content into a companion on %s (integration)",
  dialect => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);

    /**
     * Boot with the entity NOT localized, so its translatable values land on the main table the
     * way they would for content written before localization was turned on.
     */
    async function bootUnlocalized(
      fields: (ReturnType<typeof text> | ReturnType<typeof repeater>)[]
    ): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: "seedsrc", fields })],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      return current;
    }

    it("copies the existing values in as the recorded locale's rows", async () => {
      const t = await bootUnlocalized([text({ name: "title" })]);
      const adapter = t.adapter as unknown as {
        executeQuery: <T = unknown>(sql: string) => Promise<T[]>;
      };
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_seedsrc")} (${q("id")}, ${q("slug")}, ${q("title")}) ` +
          `VALUES ('row1', 'r1', 'Written before')`
      );

      const created = await ensureCompanionTable(
        t.adapter as Parameters<typeof ensureCompanionTable>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "seedsrc",
          tableName: "dc_seedsrc",
          fields: [{ name: "title", type: "text", localized: true }],
          dialect,
          sourceLocale: "en",
        }
      );

      expect(created).toBe(true);
      const rows = await adapter.executeQuery<{ title: string }>(
        `SELECT ${q("title")} FROM ${q("dc_seedsrc_locales")} ` +
          `WHERE ${q("_locale")} = 'en'`
      );
      expect(rows).toEqual([{ title: "Written before" }]);
    });

    it("leaves the source column in place, since unattended provisioning is additive", async () => {
      const t = await bootUnlocalized([text({ name: "title" })]);
      const adapter = t.adapter as unknown as {
        executeQuery: <T = unknown>(sql: string) => Promise<T[]>;
      };
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_seedsrc")} (${q("id")}, ${q("slug")}, ${q("title")}) ` +
          `VALUES ('row1', 'r1', 'Still here')`
      );

      await ensureCompanionTable(
        t.adapter as Parameters<typeof ensureCompanionTable>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "seedsrc",
          tableName: "dc_seedsrc",
          fields: [{ name: "title", type: "text", localized: true }],
          dialect,
          sourceLocale: "en",
        }
      );

      // A dropped column is not something the next boot can put back, so the copy leaves the
      // original where it is and the schema apply removes it under its own rules.
      const main = await adapter.executeQuery<{ title: string }>(
        `SELECT ${q("title")} FROM ${q("dc_seedsrc")} WHERE ${q("id")} = 'row1'`
      );
      expect(main).toEqual([{ title: "Still here" }]);
    });

    it("creates an empty companion when the entity holds nothing", async () => {
      // Nothing to hide means nothing to defer over. This is the ordinary case for a new entity,
      // and refusing it would leave every one of them without a companion.
      const t = await bootUnlocalized([text({ name: "title" })]);

      const created = await ensureCompanionTable(
        t.adapter as Parameters<typeof ensureCompanionTable>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "seedsrc",
          tableName: "dc_seedsrc",
          fields: [{ name: "title", type: "text", localized: true }],
          dialect,
        }
      );

      expect(created).toBe(true);
    });

    it("declines to create over content when the caller cannot name the language", async () => {
      const t = await bootUnlocalized([text({ name: "title" })]);
      const adapter = t.adapter as unknown as {
        executeQuery: <T = unknown>(sql: string) => Promise<T[]>;
      };
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_seedsrc")} (${q("id")}, ${q("slug")}, ${q("title")}) ` +
          `VALUES ('row1', 'r1', 'Do not hide me')`
      );

      const reported: unknown[] = [];
      const created = await ensureCompanionTable(
        t.adapter as Parameters<typeof ensureCompanionTable>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "seedsrc",
          tableName: "dc_seedsrc",
          fields: [{ name: "title", type: "text", localized: true }],
          dialect,
        },
        error => reported.push(error)
      );

      expect(created).toBe(false);
      expect(reported).toHaveLength(1);
    });

    it("survives the whole round trip: enable, edit, disable", async () => {
      // The journey a user actually takes, which no test covered while every part of it was
      // proven separately. An edit made while localized lives only in the companion, so a disable
      // that trusts the retained main column instead of reading the companion silently reverts it.
      const t = await bootUnlocalized([text({ name: "title" })]);
      const adapter = t.adapter as unknown as {
        executeQuery: <T = unknown>(sql: string) => Promise<T[]>;
      };
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_seedsrc")} (${q("id")}, ${q("slug")}, ${q("title")}) ` +
          `VALUES ('row1', 'r1', 'Before localization')`
      );

      // ENABLE — the existing value is copied in and the source column is retained.
      await ensureCompanionTable(
        t.adapter as Parameters<typeof ensureCompanionTable>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "seedsrc",
          tableName: "dc_seedsrc",
          fields: [{ name: "title", type: "text", localized: true }],
          dialect,
          sourceLocale: "en",
        }
      );

      // EDIT — a localized write touches the companion only, which is what leaves the retained
      // main column stale and is the whole reason the disable cannot trust it.
      await adapter.executeQuery(
        `UPDATE ${q("dc_seedsrc_locales")} SET ${q("title")} = 'Edited while localized' ` +
          `WHERE ${q("_parent")} = 'row1' AND ${q("_locale")} = 'en'`
      );

      // DISABLE — restore from the companion, skipping the re-add of a column already present.
      const present = await localizedColumnsOnMain(
        t.adapter as Parameters<typeof localizedColumnsOnMain>[0],
        "dc_seedsrc",
        [{ name: "title", type: "text", localized: true }]
      );
      for (const statement of buildLocalizationDownStatements(
        {
          dialect,
          collection: "seedsrc",
          kind: "collection" as const,
          mainTable: "dc_seedsrc",
          companionTable: "dc_seedsrc_locales",
          defaultLocale: "en",
          parentIdType: dialect === "mysql" ? "VARCHAR(36)" : "TEXT",
          columns: [{ name: "title", kind: "text" }],
        },
        { existingMainColumns: present.map(c => c.name) }
      )) {
        await adapter.executeQuery(statement);
      }

      const main = await adapter.executeQuery<{ title: string }>(
        `SELECT ${q("title")} FROM ${q("dc_seedsrc")} WHERE ${q("id")} = 'row1'`
      );
      expect(main).toEqual([{ title: "Edited while localized" }]);
    });

    // A repeater keeping one structure in every language: its structure stays in its main column
    // and each language's text sits in its overlay column on the translations table. Its text on
    // the main table already is the default language's: copied in as that language's overlay, so a
    // first save in another language, which writes the structure without its text, keeps it.
    const SLIDES = repeater({
      name: "slides",
      fields: [text({ name: "caption" }), number({ name: "rank" })],
    });
    const SLIDES_FIELD = {
      name: "slides",
      type: "repeater",
      fields: [
        { name: "caption", type: "text" },
        { name: "rank", type: "number" },
      ],
    };
    const STORED = [{ id: "s1", caption: "Hello", rank: 1 }];

    async function withSlides(t: TestNextly) {
      const adapter = t.adapter as unknown as {
        executeQuery: <T = unknown>(sql: string) => Promise<T[]>;
      };
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_seedsrc")} (${q("id")}, ${q("slug")}, ${q("title")}, ${q("slides")}) ` +
          `VALUES ('row1', 'r1', 'Hi', '${JSON.stringify(STORED)}')`
      );
      return adapter;
    }

    async function defaultOverlay(adapter: {
      executeQuery: <T = unknown>(sql: string) => Promise<T[]>;
    }) {
      const rows = await adapter.executeQuery<{ slides: unknown }>(
        `SELECT ${q("slides")} FROM ${q("dc_seedsrc_locales")} ` +
          `WHERE ${q("_parent")} = 'row1' AND ${q("_locale")} = 'en'`
      );
      return rows.map(row => parsedValue(row.slides));
    }

    it("copies a repeater's text in as the recorded locale's overlay, keeping its structure on main", async () => {
      const t = await bootUnlocalized([text({ name: "title" }), SLIDES]);
      const adapter = await withSlides(t);

      await ensureCompanionTable(
        t.adapter as Parameters<typeof ensureCompanionTable>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "seedsrc",
          tableName: "dc_seedsrc",
          fields: [
            { name: "title", type: "text", localized: true },
            SLIDES_FIELD,
          ],
          dialect,
          sourceLocale: "en",
        }
      );

      expect(await defaultOverlay(adapter)).toEqual([STORED]);
      const main = await adapter.executeQuery<{ slides: unknown }>(
        `SELECT ${q("slides")} FROM ${q("dc_seedsrc")} WHERE ${q("id")} = 'row1'`
      );
      expect(main.map(row => parsedValue(row.slides))).toEqual([STORED]);
    });

    it("copies a repeater's text in as the default language's overlay when its column joins an existing translations table", async () => {
      const t = await bootUnlocalized([text({ name: "title" }), SLIDES]);
      const adapter = await withSlides(t);
      // The translations table as an earlier release made it: the translated title alone.
      await ensureCompanionTable(
        t.adapter as Parameters<typeof ensureCompanionTable>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "seedsrc",
          tableName: "dc_seedsrc",
          fields: [{ name: "title", type: "text", localized: true }],
          dialect,
          sourceLocale: "en",
        }
      );

      await reconcileCompanionColumns(
        t.adapter as Parameters<typeof reconcileCompanionColumns>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "seedsrc",
          tableName: "dc_seedsrc",
          fields: [
            { name: "title", type: "text", localized: true },
            SLIDES_FIELD,
          ],
          dialect,
          defaultLocale: "en",
        }
      );

      expect(await defaultOverlay(adapter)).toEqual([STORED]);
    });

    // The column and its seed are two steps. When the column lands and the seed does not, the run
    // must say so, and the next run must seed it: left to the column's presence alone, every later
    // run sees the companion in step and the default language's text is lost at the next save in
    // another language.
    it("fails the run when the overlay's seed fails, and seeds it on the next run", async () => {
      const t = await bootUnlocalized([text({ name: "title" }), SLIDES]);
      const adapter = await withSlides(t);
      await ensureCompanionTable(
        t.adapter as Parameters<typeof ensureCompanionTable>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "seedsrc",
          tableName: "dc_seedsrc",
          fields: [{ name: "title", type: "text", localized: true }],
          dialect,
          sourceLocale: "en",
        }
      );
      const args = {
        builtBy: "codeFirst" as const,
        slug: "seedsrc",
        tableName: "dc_seedsrc",
        fields: [
          { name: "title", type: "text", localized: true },
          SLIDES_FIELD,
        ],
        dialect,
        defaultLocale: "en",
      };
      // The seed's first statement fails, as a lost connection would fail it; everything else,
      // the column's addition included, runs as it would.
      const real = t.adapter as Parameters<typeof reconcileCompanionColumns>[0];
      const failingSeed = new Proxy(real, {
        get(target, prop, receiver) {
          if (prop !== "executeQuery") {
            const value: unknown = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (sql: string) =>
            sql.startsWith(`UPDATE ${q("dc_seedsrc_locales")}`)
              ? Promise.reject(new Error("connection lost"))
              : real.executeQuery(sql);
        },
      });
      const errors: unknown[] = [];

      const first = await reconcileCompanionColumns(failingSeed, args, error =>
        errors.push(error)
      );

      expect(first).toBe(false);
      expect(errors).toHaveLength(1);
      expect(await reconcileCompanionColumns(real, args)).toBe(true);
      expect(await defaultOverlay(adapter)).toEqual([STORED]);
    });
  }
);
