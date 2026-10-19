/**
 * A translated field marked Required or Unique becomes shared in one change, keeping its default
 * language's value as the shared one, when the values in place satisfy the setting.
 *
 * The shared column has to be created without its constraint, filled from the default language,
 * and only then constrained: created constrained, every existing row briefly holds the same
 * placeholder or none, which neither setting accepts. When the default language's values do not
 * satisfy the setting (an entry without one, for Required; a value two entries share, for Unique)
 * the change is refused before anything runs, saying how many entries are in the way.
 *
 * Every Builder path that can make the change: a collection's save and schema dialog, a Single's
 * save and schema dialog, and a field group's schema dialog.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

interface Entries {
  createEntry(
    params: {
      collectionName: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
}

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
  updateCollection(
    params: { collectionName: string },
    body: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getEntryService(): Entries;
}

/**
 * The field under test. An email field is stored in a bounded text column on every dialect, so
 * MySQL can make it unique (an unbounded text column it cannot key), and the schema dialogs'
 * fields payload takes it as it is.
 */
const CODE = { name: "code", type: "email" };
const VIEWS = { name: "views", type: "number" };

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "a Required or Unique field that becomes shared",
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

    const q = (name: string) => quote(dialect, name);

    function handler(): CollectionsHandler {
      return current.getService(
        "collectionsHandler"
      ) as unknown as CollectionsHandler;
    }

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    async function schemaVersionOf(
      registry: string,
      slug: string
    ): Promise<number> {
      const [row] = await query<{ version: number | string | null }>(
        `SELECT ${q("schema_version")} AS version FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
      );
      return Number(row?.version ?? 1);
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name);
    }

    /**
     * A translated collection `posts` whose `code` holds, in English, each of `english` (one entry
     * per value; `undefined` writes an entry with no English `code`).
     */
    async function seedCollection(english: (string | undefined)[]) {
      const created = await handler().createCollection({
        name: "posts",
        label: "Post",
        localized: true,
        fields: [CODE, VIEWS],
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
      const entries = handler().getEntryService();
      for (const value of english) {
        const entry = await entries.createEntry(
          { collectionName: "posts", overrideAccess: true, locale: "en" },
          value === undefined ? { views: 1 } : { code: value, views: 1 }
        );
        expect(entry.success, JSON.stringify(entry)).toBe(true);
      }
    }

    /** A translated Single `hero` whose `code` holds `english[0]` in English, or none. */
    async function seedSingle(english: (string | undefined)[]) {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "hero", label: "Hero", localized: true, fields: [CODE, VIEWS] }
      );
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      const [value] = english;
      const written = await singles.update(
        "hero",
        value === undefined ? { views: 1 } : { code: value, views: 1 },
        { locale: "en", overrideAccess: true }
      );
      expect(written.success, JSON.stringify(written)).toBe(true);
    }

    /**
     * A translated field group `promo` with one row per value of `english`. Its rows belong to the
     * entries that embed it, so each is written as an embedding entry would write it.
     */
    async function seedFieldGroup(english: (string | undefined)[]) {
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "promo",
          label: "Promo",
          localized: true,
          fields: [CODE, VIEWS],
        }
      );
      for (const [i, value] of english.entries()) {
        const id = `promo-${i + 1}`;
        await query(
          `INSERT INTO ${q("comp_promo")} (${["id", "_parent_id", "_parent_table", "_parent_field", "views"].map(q).join(", ")}) ` +
            `VALUES ('${id}', 'entry-${i + 1}', 'dc_pages', 'promo', 1)`
        );
        await query(
          `INSERT INTO ${q("comp_promo_locales")} (${["_parent", "_locale", "code"].map(q).join(", ")}) ` +
            `VALUES ('${id}', 'en', ${value === undefined ? "NULL" : `'${value}'`})`
        );
      }
    }

    /** The system columns each table needs a value in, beside `id`, and a value for each. */
    const SYSTEM_COLUMNS: Record<string, Record<string, string>> = {
      dc_posts: { title: "'Extra'", slug: "'extra'" },
      single_hero: { title: "'Extra'", slug: "'extra'" },
      comp_promo: {
        _parent_id: "'entry-extra'",
        _parent_table: "'dc_pages'",
        _parent_field: "'promo'",
        created_at: "'2026-01-01 00:00:00'",
        updated_at: "'2026-01-01 00:00:00'",
      },
    };

    /** A row for `table` beside the entity's own, holding `code` (a SQL literal). */
    function rowFor(table: string, id: string, code: string): string {
      const values = { ...SYSTEM_COLUMNS[table], id: `'${id}'`, code };
      return (
        `INSERT INTO ${q(table)} (${Object.keys(values).map(q).join(", ")}) ` +
        `VALUES (${Object.values(values).join(", ")})`
      );
    }

    /** Every Builder path a translated field can become shared by, with its entity. */
    const PATHS = [
      {
        path: "a collection's builder saves the field alone",
        entity: "collection",
        table: "dc_posts",
        seed: seedCollection,
        save: async (fields: unknown[]) => {
          const saved = await handler().updateCollection(
            { collectionName: "posts" },
            { fields }
          );
          if (!saved.success) throw new Error(JSON.stringify(saved));
        },
        change: async (fields: unknown[]) => {
          const saved = await handler().updateCollection(
            { collectionName: "posts" },
            { fields }
          );
          if (!saved.success) throw new Error(JSON.stringify(saved));
        },
      },
      {
        path: "a collection's change is applied with the schema dialog",
        entity: "collection",
        table: "dc_posts",
        seed: seedCollection,
        save: async (fields: unknown[]) => {
          const saved = await handler().updateCollection(
            { collectionName: "posts" },
            { fields }
          );
          if (!saved.success) throw new Error(JSON.stringify(saved));
        },
        change: async (fields: unknown[]) => {
          await dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: "posts" },
            {
              fields,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf(
                "dynamic_collections",
                "posts"
              ),
            }
          );
        },
      },
      {
        path: "a Single's schema is saved",
        entity: "single",
        table: "single_hero",
        seed: seedSingle,
        save: async (fields: unknown[]) => {
          await dispatchSingles(
            "updateSingleSchema",
            { slug: "hero" },
            { fields }
          );
        },
        change: async (fields: unknown[]) => {
          await dispatchSingles(
            "updateSingleSchema",
            { slug: "hero" },
            { fields }
          );
        },
      },
      {
        path: "a Single's change is applied with the schema dialog",
        entity: "single",
        table: "single_hero",
        seed: seedSingle,
        save: async (fields: unknown[]) => {
          await dispatchSingles(
            "updateSingleSchema",
            { slug: "hero" },
            { fields }
          );
        },
        change: async (fields: unknown[]) => {
          await dispatchSingles(
            "applySingleSchemaChanges",
            { slug: "hero" },
            {
              fields,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
            }
          );
        },
      },
      {
        path: "a field group's change is applied with the schema dialog",
        entity: "fieldGroup",
        table: "comp_promo",
        seed: seedFieldGroup,
        save: async (fields: unknown[]) => {
          await dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: "promo" },
            {
              fields,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf(
                "dynamic_components",
                "promo"
              ),
            }
          );
        },
        change: async (fields: unknown[]) => {
          await dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: "promo" },
            {
              fields,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf(
                "dynamic_components",
                "promo"
              ),
            }
          );
        },
      },
    ];
    type Path = (typeof PATHS)[number];

    const SETTINGS = [
      { setting: "required", flags: { required: true } },
      { setting: "unique", flags: { unique: true } },
    ];

    /**
     * The entity seeded with `english`, then given `flags` while `code` is still translated, as an
     * author would have it.
     */
    async function seedConstrained(
      path: Path,
      flags: Record<string, unknown>,
      english: (string | undefined)[]
    ): Promise<void> {
      await path.seed(english);
      await path.save([{ ...CODE, ...flags }, VIEWS]);
    }

    async function sharedCodes(table: string): Promise<unknown[]> {
      const rows = await query<{ code: unknown }>(
        `SELECT ${q("code")} AS code FROM ${q(table)} ORDER BY ${q("code")}`
      );
      return rows.map(row => row.code);
    }

    /** The English values on the companion, without the entries that have none. */
    async function englishCodes(table: string): Promise<unknown[]> {
      const rows = await query<{ code: unknown }>(
        `SELECT ${q("code")} AS code FROM ${q(`${table}_locales`)} ` +
          `WHERE ${q("_locale")} = 'en' AND ${q("code")} IS NOT NULL ORDER BY ${q("code")}`
      );
      return rows.map(row => row.code);
    }

    /** The error a refused change raised or reported, as text. */
    function reported(refusal: unknown): string {
      return refusal instanceof Error
        ? `${refusal.message} ${JSON.stringify((refusal as { publicData?: unknown }).publicData ?? null)}`
        : String(refusal);
    }

    function attempt(promise: Promise<void>): Promise<unknown> {
      return promise.then(
        () => undefined,
        (error: unknown) => error
      );
    }

    /** True when the row is taken, else the database's reason. */
    async function inserts(sql: string): Promise<true | string> {
      return query(sql).then(
        () => true as const,
        (error: unknown) =>
          error instanceof Error ? error.message.slice(0, 300) : String(error)
      );
    }

    /**
     * Whether the database takes a row that keeps the setting and one that breaks it. The first
     * has to be taken: a row refused for another reason (another column it lacks) is no evidence.
     */
    async function databaseEnforces(
      table: string,
      setting: string
    ): Promise<{ keeps: true | string; breaks: boolean }> {
      const keeps = await inserts(
        rowFor(table, "kept-1", "'kept@example.com'")
      );
      const breaks =
        (await inserts(
          rowFor(
            table,
            "broken-1",
            setting === "unique" ? "'kept@example.com'" : "NULL"
          )
        )) === true;
      return { keeps, breaks };
    }

    it.each(PATHS.flatMap(p => SETTINGS.map(s => ({ ...p, ...s }))))(
      "keeps English's values as the shared ones and enforces $setting when $path",
      async path => {
        // A Single holds one entry; the others hold two with distinct values.
        const english =
          path.entity === "single"
            ? ["a1@example.com"]
            : ["a1@example.com", "b2@example.com"];
        await seedConstrained(path, path.flags, english);

        await path.change([
          { ...CODE, localized: false, ...path.flags },
          VIEWS,
        ]);

        expect(await sharedCodes(path.table)).toEqual(english);
        expect(await databaseEnforces(path.table, path.setting)).toEqual({
          keeps: true,
          breaks: false,
        });
      }
    );

    it.each(PATHS)(
      "refuses a Required field while an entry has no English value, saying how many, when $path",
      async path => {
        const english =
          path.entity === "single"
            ? [undefined]
            : ["a1@example.com", undefined];
        await seedConstrained(path, { required: true }, english);

        const refusal = await attempt(
          path.change([{ ...CODE, localized: false, required: true }, VIEWS])
        );

        expect(reported(refusal)).toMatch(/1 entry has no English code/);
        // Nothing changed: still translated, its English values in place.
        expect(await englishCodes(path.table)).toEqual(
          english.filter(v => v !== undefined)
        );
        expect(await columnsOf(path.table)).not.toContain("code");
      }
    );

    // A Single holds one entry, so no two of its entries can share a value.
    it.each(PATHS.filter(p => p.entity !== "single"))(
      "refuses a Unique field while two entries share an English value, without naming it, when $path",
      async path => {
        await seedConstrained(path, {}, [
          "same@example.com",
          "same@example.com",
        ]);

        const refusal = await attempt(
          path.change([{ ...CODE, localized: false, unique: true }, VIEWS])
        );

        expect(reported(refusal)).toMatch(
          /2 entries share an English value for code, which must be unique/
        );
        expect(reported(refusal)).not.toContain("same@example.com");
        expect(await englishCodes(path.table)).toEqual([
          "same@example.com",
          "same@example.com",
        ]);
        expect(await columnsOf(path.table)).not.toContain("code");
      }
    );
  }
);
