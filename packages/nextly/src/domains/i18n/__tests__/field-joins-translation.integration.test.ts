/**
 * A shared field that becomes translated keeps its value, as the default language's value,
 * through every path that can make the change, on every dialect.
 *
 * In a translated entity a shared field's value lives on the main table, and a translated
 * field's values live in the companion `<table>_locales`, one row per language. Making a shared
 * field translated adds its companion column and drops its main-table column, so the value the
 * field held has to move to the default language's row first; a translation that does not exist
 * yet stays empty rather than being invented from it.
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
const SHARED = [
  { name: "heading", type: "text", localized: false },
  { name: "views", type: "number" },
];
const TRANSLATED = [
  { name: "heading", type: "text" },
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
  getEntry(params: {
    collectionName: string;
    entryId: string;
    overrideAccess?: boolean;
    locale?: string;
  }): Promise<{ success: boolean; data: unknown }>;
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

describeEachDialect("a shared field that becomes translated", dialect => {
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

  /** A table's column names, as the database reports them. */
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

  /** The value each language's companion row holds for `heading`, by language. */
  async function companionHeadings(
    table: string,
    id: string
  ): Promise<Record<string, string | null>> {
    const rows = await query<{ locale: string; heading: string | null }>(
      `SELECT ${quote(dialect, "_locale")} AS locale, ${quote(dialect, "heading")} AS heading FROM ${quote(dialect, `${table}_locales`)} ` +
        `WHERE ${quote(dialect, "_parent")} = '${id}'`
    );
    return Object.fromEntries(rows.map(row => [row.locale, row.heading]));
  }

  /** A translated collection whose `heading` is shared, with one entry holding a value. */
  async function seedCollection(): Promise<string> {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: SHARED,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entry = await handler()
      .getEntryService()
      .createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "en" },
        { heading: "Hello", views: 7 }
      );
    expect(entry.success, JSON.stringify(entry)).toBe(true);
    return String((entry.data as { id: unknown }).id);
  }

  /** A translated Single whose `heading` is shared, holding a value. */
  async function seedSingle(): Promise<string> {
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "hero", label: "Hero", localized: true, fields: SHARED }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    const written = await singles.update(
      "hero",
      { heading: "Hello", views: 7 },
      { locale: "en", overrideAccess: true }
    );
    expect(written.success, JSON.stringify(written)).toBe(true);
    const [row] = await query<{ id: string }>(
      `SELECT ${quote(dialect, "id")} AS id FROM ${quote(dialect, "single_hero")}`
    );
    return String(row.id);
  }

  /** The field's value as an English reader is served it. */
  async function readCollection(id: string): Promise<unknown> {
    const read = await handler().getEntryService().getEntry({
      collectionName: "posts",
      entryId: id,
      overrideAccess: true,
      locale: "en",
    });
    expect(read.success, JSON.stringify(read)).toBe(true);
    return (read.data as { heading?: unknown }).heading;
  }

  async function readSingle(): Promise<unknown> {
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    const read = await singles.get("hero", {
      locale: "en",
      overrideAccess: true,
    });
    expect(read.success, JSON.stringify(read)).toBe(true);
    return (read.data as { heading?: unknown }).heading;
  }

  /**
   * A translated field group whose `heading` is shared, with one row holding a value. Its rows
   * belong to the entries that embed it, so the row is written as an embedding entry would write it.
   */
  async function seedFieldGroup(): Promise<string> {
    await dispatchComponents(
      "createComponent",
      {},
      { slug: "banner", label: "Banner", localized: true, fields: SHARED }
    );
    const id = "banner-1";
    await query(
      `INSERT INTO ${quote(dialect, "comp_banner")} (${["id", "_parent_id", "_parent_table", "_parent_field", "heading", "views"].map(c => quote(dialect, c)).join(", ")}) ` +
        `VALUES ('${id}', 'entry-1', 'dc_pages', 'banner', 'Hello', 7)`
    );
    return id;
  }

  /** Every path that can make a shared field translated. */
  const PATHS = [
    {
      path: "the builder saves the field alone",
      table: "dc_posts",
      seed: seedCollection,
      read: readCollection,
      change: async (fields: unknown[]) => {
        // A settings-only save: the builder sends no schema dialog for it.
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "the builder applies the change with the schema dialog",
      table: "dc_posts",
      seed: seedCollection,
      read: readCollection,
      change: async (fields: unknown[]) => {
        // The builder sends the schema version it previewed against, and confirms no drop: the
        // field is not removed, so its dialog lists nothing to confirm, and its value moves rather
        // than goes.
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
      path: "a Single's schema is saved with the field translated",
      table: "single_hero",
      seed: seedSingle,
      read: () => readSingle(),
      change: async (fields: unknown[]) => {
        await dispatchSingles(
          "updateSingleSchema",
          { slug: "hero" },
          { fields }
        );
      },
    },
    {
      path: "a Single's schema is applied with the schema dialog",
      table: "single_hero",
      seed: seedSingle,
      read: () => readSingle(),
      change: async (fields: unknown[]) => {
        // As the collection's apply: no drop is confirmed, since nothing is removed.
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
      path: "a field group's schema is applied with the schema dialog",
      table: "comp_banner",
      seed: seedFieldGroup,
      // A field group has no reader of its own: its rows are read through the entries embedding
      // them, from the default language's companion row.
      read: async (id: string) =>
        (await companionHeadings("comp_banner", id)).en,
      change: async (fields: unknown[]) => {
        await dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields,
            confirmed: true,
            localized: true,
            schemaVersion: await schemaVersionOf(
              "dynamic_components",
              "banner"
            ),
          }
        );
      },
    },
  ];

  it.each(PATHS)(
    "keeps the value as English's when $path",
    async ({ table, seed, read, change }) => {
      const id = await seed();

      await change(TRANSLATED);

      // The shared value is now the default language's translation, and no other language is
      // given one it never had.
      const headings = await companionHeadings(table, id);
      expect(headings.en).toBe("Hello");
      expect(headings.es ?? null).toBeNull();
      expect(headings.ar ?? null).toBeNull();
      expect(await read(id)).toBe("Hello");
    }
  );

  it.each(PATHS)(
    "refuses a field whose type changes as it becomes translated, and changes nothing, when $path",
    async ({ table, seed, change }) => {
      // The shared value would be copied as it is into a companion column of the new type: text
      // into a number column fails part-way on PostgreSQL and is coerced on MySQL.
      const id = await seed();

      const refusal = await change([
        { name: "heading", type: "number", localized: true },
        { name: "views", type: "number" },
      ]).then(
        () => undefined,
        (error: unknown) => error
      );

      const reported =
        refusal instanceof Error
          ? `${refusal.message} ${JSON.stringify((refusal as { publicData?: unknown }).publicData ?? null)}`
          : String(refusal);
      expect(reported).toMatch(/RESHAPED_FIELD_JOINS_TRANSLATION/);
      // The value stays shared, where it was, and the companion gains no column for it.
      expect(await columnsOf(`${table}_locales`)).not.toContain("heading");
      const [row] = await query<{ heading: string }>(
        `SELECT ${quote(dialect, "heading")} AS heading FROM ${quote(dialect, table)} WHERE ${quote(dialect, "id")} = '${id}'`
      );
      expect(row?.heading).toBe("Hello");
    }
  );

  it("keeps the value where it was when moving it fails, and moves it on the next try", async () => {
    // The move runs statement by statement, and MySQL commits each schema statement, so a copy
    // refused part-way can leave the companion holding a new, empty column. The value stays on
    // main, where readers still find it, and the next apply takes the companion as it is.
    const id = await seedCollection();
    const dialog = PATHS.find(p => p.path.includes("schema dialog"));
    if (!dialog) throw new Error("the collection dialog path is missing");
    const adapter = current.adapter as unknown as {
      executeQuery(statement: string, params?: unknown[]): Promise<unknown[]>;
    };
    const original = adapter.executeQuery.bind(adapter);
    const injected = vi
      .spyOn(adapter, "executeQuery")
      .mockImplementation((statement, params) =>
        statement.startsWith("INSERT INTO") &&
        statement.includes("dc_posts_locales")
          ? Promise.reject(new Error("injected copy failure"))
          : original(statement, params)
      );

    const failed = await dialog.change(TRANSLATED).then(
      () => undefined,
      (error: unknown) => error
    );
    injected.mockRestore();

    expect(String(failed)).toMatch(/injected copy failure/);
    expect(await readCollection(id)).toBe("Hello");

    await dialog.change(TRANSLATED);

    expect((await companionHeadings("dc_posts", id)).en).toBe("Hello");
    expect(await readCollection(id)).toBe("Hello");
  });

  it("keeps English's value when a field that left translation comes back", async () => {
    // A translated field made shared keeps English's value as the shared one; made translated
    // again, that value has to come back as English's, beside the archive restoring the rest.
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: TRANSLATED,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entry = await handler()
      .getEntryService()
      .createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "en" },
        { heading: "Hello", views: 7 }
      );
    expect(entry.success, JSON.stringify(entry)).toBe(true);
    const id = String((entry.data as { id: unknown }).id);

    for (const fields of [SHARED, TRANSLATED]) {
      const saved = await handler().updateCollection(
        { collectionName: "posts" },
        { fields }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
    }

    expect((await companionHeadings("dc_posts", id)).en).toBe("Hello");
    expect(await readCollection(id)).toBe("Hello");
  });

  it("keeps later entries writable when a Required field becomes translated", async () => {
    // A Required shared field is NOT NULL on the main table. Once it is translated its value lives
    // in the companion and the main insert no longer names it, so a column left behind on main
    // would refuse every later entry.
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: [
        { name: "heading", type: "text", localized: false, required: true },
        { name: "views", type: "number" },
      ],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entries = handler().getEntryService();
    const first = await entries.createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { heading: "Hello", views: 1 }
    );
    expect(first.success, JSON.stringify(first)).toBe(true);
    const firstId = String((first.data as { id: unknown }).id);

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      {
        fields: [
          { name: "heading", type: "text", required: true },
          { name: "views", type: "number" },
        ],
      }
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    const later = await entries.createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { heading: "Later", views: 2 }
    );
    expect(later.success, JSON.stringify(later)).toBe(true);
    const laterId = String((later.data as { id: unknown }).id);
    expect(await readCollection(laterId)).toBe("Later");
    expect(await readCollection(firstId)).toBe("Hello");
  });
});
