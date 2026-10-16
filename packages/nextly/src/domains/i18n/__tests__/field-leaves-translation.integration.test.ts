/**
 * A field that stops being translated keeps its translations, through every path that can make
 * the change, on every dialect.
 *
 * A translated field's values live in the companion `<table>_locales`, one row per language.
 * Making the field shared drops its companion column, which lost every language. Now the default
 * language's value becomes the shared value on the main table and every other language's value
 * goes to `nextly_i18n_archive`, before the column is dropped; and if the archive cannot be
 * written, nothing changes at all.
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

const LOCALES = ["en", "es", "ar"];
const VALUES: Record<string, string> = {
  en: "Hello",
  es: "Hola",
  ar: "مرحبا",
};
const TRANSLATED = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];
const SHARED = [
  { name: "heading", type: "text", localized: false },
  { name: "views", type: "number" },
];

interface Entries {
  createEntry(
    params: {
      collectionName: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
  updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean }>;
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

/** A dialect's identifier quoting, for the few raw reads below. */
function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect("a field that stops being translated", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    // The builder's update path runs its migration in development only.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({
      dialect,
      collections: [],
      localization: { locales: LOCALES, defaultLocale: "en" },
    });
  });

  afterEach(async () => {
    await current.destroy();
    vi.unstubAllEnvs();
  });

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

  async function columnsOf(table: string): Promise<string[]> {
    if (dialect === "sqlite") {
      const rows = await query<{ name: string }>(
        `PRAGMA table_info("${table}")`
      );
      return rows.map(row => row.name);
    }
    const rows = await query<{ name: string }>(
      dialect === "mysql"
        ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
        : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    return rows.map(row => row.name);
  }

  async function schemaVersionOf(
    registry: string,
    slug: string
  ): Promise<number> {
    const [row] = await query<{ version: number | string | null }>(
      `SELECT ${quote(dialect, "schema_version")} AS version FROM ${quote(dialect, registry)} WHERE ${quote(dialect, "slug")} = '${slug}'`
    );
    return Number(row?.version ?? 1);
  }

  /** A translated collection with one entry holding a value in every language. */
  async function seedCollection(): Promise<string> {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: TRANSLATED,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entries = handler().getEntryService();
    const entry = await entries.createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { heading: VALUES.en, views: 7 }
    );
    expect(entry.success, JSON.stringify(entry)).toBe(true);
    const id = String((entry.data as { id: unknown }).id);
    for (const locale of ["es", "ar"]) {
      const translated = await entries.updateEntry(
        { collectionName: "posts", entryId: id, overrideAccess: true, locale },
        { heading: VALUES[locale] }
      );
      expect(translated.success, JSON.stringify(translated)).toBe(true);
    }
    return id;
  }

  /** A translated Single holding a value in every language. */
  async function seedSingle(): Promise<string> {
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "hero", label: "Hero", localized: true, fields: TRANSLATED }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    for (const locale of LOCALES) {
      const written = await singles.update(
        "hero",
        locale === "en"
          ? { heading: VALUES.en, views: 7 }
          : { heading: VALUES[locale] },
        { locale, overrideAccess: true }
      );
      expect(written.success, JSON.stringify(written)).toBe(true);
    }
    const [row] = await query<{ id: string }>(
      `SELECT ${quote(dialect, "id")} AS id FROM ${quote(dialect, "single_hero")}`
    );
    return String(row.id);
  }

  /**
   * A translated field group with one row holding a value in every language. Its rows belong to
   * the entries that embed it, so the row is written as an embedding entry would write it.
   */
  async function seedFieldGroup(): Promise<string> {
    await dispatchComponents(
      "createComponent",
      {},
      { slug: "promo", label: "Promo", localized: true, fields: TRANSLATED }
    );
    const id = "promo-1";
    await query(
      `INSERT INTO ${quote(dialect, "comp_promo")} (${["id", "_parent_id", "_parent_table", "_parent_field", "views"].map(c => quote(dialect, c)).join(", ")}) ` +
        `VALUES ('${id}', 'entry-1', 'dc_pages', 'promo', 7)`
    );
    for (const locale of LOCALES) {
      await query(
        `INSERT INTO ${quote(dialect, "comp_promo_locales")} (${["_parent", "_locale", "heading"].map(c => quote(dialect, c)).join(", ")}) ` +
          `VALUES ('${id}', '${locale}', '${VALUES[locale]}')`
      );
    }
    return id;
  }

  /** Every path that can make a translated field shared, and what it changes. */
  const PATHS = [
    {
      path: "the builder saves the field alone",
      entity: {
        slug: "posts",
        table: "dc_posts",
        registry: "dynamic_collections",
      },
      seed: seedCollection,
      change: async () => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields: SHARED }
        );
        if (!saved.success) throw new Error(saved.message);
      },
    },
    {
      path: "the builder applies the change with the schema dialog",
      entity: {
        slug: "posts",
        table: "dc_posts",
        registry: "dynamic_collections",
      },
      seed: seedCollection,
      change: async () => {
        // The builder sends the schema version it previewed against.
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: SHARED,
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
      path: "a Single's schema is saved with the field shared",
      entity: {
        slug: "hero",
        table: "single_hero",
        registry: "dynamic_singles",
      },
      seed: seedSingle,
      change: async () => {
        await dispatchSingles(
          "updateSingleSchema",
          { slug: "hero" },
          { fields: SHARED }
        );
      },
    },
    {
      path: "a field group's schema is applied with the field shared",
      entity: {
        slug: "promo",
        table: "comp_promo",
        registry: "dynamic_components",
      },
      seed: seedFieldGroup,
      change: async () => {
        // A field change that alters the group's table goes through its schema apply.
        await dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "promo" },
          {
            fields: SHARED,
            confirmed: true,
            localized: true,
            schemaVersion: await schemaVersionOf("dynamic_components", "promo"),
          }
        );
      },
    },
  ];

  it.each(PATHS)("keeps them when $path", async ({ entity, seed, change }) => {
    const id = await seed();

    await change();

    const [main] = await query<{ heading: string | null }>(
      `SELECT ${quote(dialect, "heading")} AS heading FROM ${quote(dialect, entity.table)} WHERE ${quote(dialect, "id")} = '${id}'`
    );
    expect(main?.heading).toBe(VALUES.en);
    const archived = await query<{ locale: string; value: string }>(
      `SELECT ${quote(dialect, "locale")} AS locale, ${quote(dialect, "value")} AS value FROM ${quote(dialect, "nextly_i18n_archive")} ` +
        `WHERE ${quote(dialect, "collection")} = '${entity.slug}' AND ${quote(dialect, "field")} = 'heading' AND ${quote(dialect, "entry_id")} = '${id}' ` +
        `ORDER BY ${quote(dialect, "locale")}`
    );
    expect(archived).toEqual([
      { locale: "ar", value: VALUES.ar },
      { locale: "es", value: VALUES.es },
    ]);
    expect(await columnsOf(`${entity.table}_locales`)).not.toContain("heading");
    expect(await columnsOf(entity.table)).toContain("heading");
  });

  it.each(PATHS)(
    "changes nothing when the archive cannot be written and $path",
    async ({ entity, seed, change }) => {
      const id = await seed();
      // An archive that exists but cannot take a row: the create-if-missing leaves it alone,
      // and the write the change depends on fails.
      await query(
        `DROP TABLE IF EXISTS ${quote(dialect, "nextly_i18n_archive")}`
      );
      await query(
        `CREATE TABLE ${quote(dialect, "nextly_i18n_archive")} (${quote(dialect, "id")} INTEGER PRIMARY KEY)`
      );

      await expect(change()).rejects.toThrow(/nothing was changed/);

      // Still translated: every language in the companion, no shared column on main, and the
      // registry still describes the field as translated.
      const kept = await query<{ locale: string; heading: string }>(
        `SELECT ${quote(dialect, "_locale")} AS locale, ${quote(dialect, "heading")} AS heading FROM ${quote(dialect, `${entity.table}_locales`)} ` +
          `WHERE ${quote(dialect, "_parent")} = '${id}' ORDER BY ${quote(dialect, "_locale")}`
      );
      expect(kept).toEqual([
        { locale: "ar", heading: VALUES.ar },
        { locale: "en", heading: VALUES.en },
        { locale: "es", heading: VALUES.es },
      ]);
      expect(await columnsOf(entity.table)).not.toContain("heading");
      const [registered] = await query<{ fields: string | unknown[] }>(
        `SELECT ${quote(dialect, "fields")} AS fields FROM ${quote(dialect, entity.registry)} WHERE ${quote(dialect, "slug")} = '${entity.slug}'`
      );
      const fields = (
        typeof registered.fields === "string"
          ? JSON.parse(registered.fields)
          : registered.fields
      ) as { name: string; localized?: boolean }[];
      expect(fields.find(f => f.name === "heading")?.localized).not.toBe(false);
    }
  );
});
