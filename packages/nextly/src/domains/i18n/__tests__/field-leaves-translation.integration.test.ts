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
import { afterEach, beforeEach, expect, it } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

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
  let previousNodeEnv: string | undefined;

  beforeEach(async () => {
    // The builder's update path runs its migration in development only.
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    current = await createTestNextly({
      dialect,
      collections: [],
      localization: { locales: LOCALES, defaultLocale: "en" },
    });
  });

  afterEach(async () => {
    await current.destroy();
    process.env.NODE_ENV = previousNodeEnv;
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

  /** A translated collection with one entry holding a value in every language. */
  async function seed(): Promise<string> {
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
        {
          collectionName: "posts",
          entryId: id,
          overrideAccess: true,
          locale,
        },
        { heading: VALUES[locale] }
      );
      expect(translated.success, JSON.stringify(translated)).toBe(true);
    }
    return id;
  }

  async function expectKept(id: string): Promise<void> {
    const [main] = await query<{ heading: string | null }>(
      `SELECT ${quote(dialect, "heading")} AS heading FROM ${quote(dialect, "dc_posts")} WHERE ${quote(dialect, "id")} = '${id}'`
    );
    expect(main?.heading).toBe(VALUES.en);

    const archived = await query<{ locale: string; value: string }>(
      `SELECT ${quote(dialect, "locale")} AS locale, ${quote(dialect, "value")} AS value FROM ${quote(dialect, "nextly_i18n_archive")} ` +
        `WHERE ${quote(dialect, "collection")} = 'posts' AND ${quote(dialect, "field")} = 'heading' AND ${quote(dialect, "entry_id")} = '${id}' ` +
        `ORDER BY ${quote(dialect, "locale")}`
    );
    expect(archived).toEqual([
      { locale: "ar", value: VALUES.ar },
      { locale: "es", value: VALUES.es },
    ]);

    expect(await columnsOf("dc_posts_locales")).not.toContain("heading");
    expect(await columnsOf("dc_posts")).toContain("heading");
  }

  it("keeps them when the builder saves the field alone", async () => {
    const id = await seed();

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: SHARED }
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    await expectKept(id);
  });

  it("keeps them when the builder applies the change with the schema dialog", async () => {
    const id = await seed();

    await dispatchCollections(
      {} as ServiceContainer,
      "applySchemaChanges",
      { collectionName: "posts" },
      { fields: SHARED, confirmed: true, localized: true }
    ).catch((error: { data?: unknown; logContext?: unknown }) => {
      throw new Error(
        JSON.stringify({ data: error.data, log: error.logContext })
      );
    });

    await expectKept(id);
  });
});
