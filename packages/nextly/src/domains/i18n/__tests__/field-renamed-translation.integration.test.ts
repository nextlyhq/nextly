/**
 * A translated field that is renamed keeps every language's value, through every path that can
 * rename it, on every dialect.
 *
 * A translated field's values live in the companion `<table>_locales`, one row per language. A
 * rename used to read there as one translated field removed and another added: the old companion
 * column was dropped and an empty one added, and nothing was archived. Renamed while it stays
 * translated, the values now move with the column; renamed and made shared in the same change, the
 * default language's value becomes the shared one and the others go to the archive, as for a field
 * that keeps its name.
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
import { restoreI18nArchive } from "../migration/restore-archive";
import { reconcileCompanionColumns } from "../runtime/companion-io";

const LOCALES = ["en", "es"];
const TRANSLATED = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];
/** `heading` renamed to `title2`, still translated. */
const RENAMED = [
  { name: "title2", type: "text" },
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
  ): Promise<{ success: boolean; message?: string }>;
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

/** A dialect's identifier quoting, for the raw reads below. */
function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect("a translated field that is renamed", dialect => {
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

  async function schemaVersionOf(
    registry: string,
    slug: string
  ): Promise<number> {
    const [row] = await query<{ version: number | string | null }>(
      `SELECT ${quote(dialect, "schema_version")} AS version FROM ${quote(dialect, registry)} WHERE ${quote(dialect, "slug")} = '${slug}'`
    );
    return Number(row?.version ?? 1);
  }

  /** Each language's value of one companion column, by language. */
  async function companionValues(
    table: string,
    column: string,
    id: string
  ): Promise<Record<string, unknown>> {
    const rows = await query<{ locale: string; value: unknown }>(
      `SELECT ${quote(dialect, "_locale")} AS locale, ${quote(dialect, column)} AS value FROM ${quote(dialect, `${table}_locales`)} ` +
        `WHERE ${quote(dialect, "_parent")} = '${id}'`
    );
    return Object.fromEntries(rows.map(row => [row.locale, row.value]));
  }

  /** A translated collection whose `heading` holds "Hello" in English and "Hola" in Spanish. */
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
      { heading: "Hello", views: 7 }
    );
    expect(entry.success, JSON.stringify(entry)).toBe(true);
    const id = String((entry.data as { id: unknown }).id);
    const spanish = await entries.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { heading: "Hola" }
    );
    expect(spanish.success, JSON.stringify(spanish)).toBe(true);
    return id;
  }

  /** The same, for a translated Single. */
  async function seedSingle(): Promise<string> {
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
    const [row] = await query<{ id: string }>(
      `SELECT ${quote(dialect, "id")} AS id FROM ${quote(dialect, "single_hero")}`
    );
    return String(row.id);
  }

  /**
   * The same, for a translated field group. Its rows belong to the entries that embed it, so the
   * row and its translations are written as an embedding entry's save writes them.
   */
  async function seedFieldGroup(): Promise<string> {
    await dispatchComponents(
      "createComponent",
      {},
      { slug: "banner", label: "Banner", localized: true, fields: TRANSLATED }
    );
    const id = "banner-1";
    await query(
      `INSERT INTO ${quote(dialect, "comp_banner")} (${["id", "_parent_id", "_parent_table", "_parent_field", "views"].map(c => quote(dialect, c)).join(", ")}) ` +
        `VALUES ('${id}', 'entry-1', 'dc_pages', 'banner', 7)`
    );
    await query(
      `INSERT INTO ${quote(dialect, "comp_banner_locales")} (${["_parent", "_locale", "heading"].map(c => quote(dialect, c)).join(", ")}) ` +
        `VALUES ('${id}', 'en', 'Hello'), ('${id}', 'es', 'Hola')`
    );
    return id;
  }

  /** The schema dialog's answer that `heading` became `title2` on `table`'s companion. */
  function renamedOnCompanion(table: string) {
    return [
      {
        tableName: `${table}_locales`,
        fromColumn: "heading",
        toColumn: "title2",
        choice: "rename" as const,
      },
    ];
  }

  /** Every path that can rename a translated field. */
  const PATHS = [
    {
      path: "the builder saves the collection",
      table: "dc_posts",
      seed: seedCollection,
      change: async () => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields: RENAMED }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "the collection's schema dialog applies it as a rename",
      table: "dc_posts",
      seed: seedCollection,
      change: async () => {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: RENAMED,
            confirmed: true,
            localized: true,
            renameResolutions: renamedOnCompanion("dc_posts"),
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
      table: "single_hero",
      seed: seedSingle,
      change: async () => {
        await dispatchSingles(
          "updateSingleSchema",
          { slug: "hero" },
          { fields: RENAMED }
        );
      },
    },
    {
      path: "a Single's schema dialog applies it as a rename",
      table: "single_hero",
      seed: seedSingle,
      change: async () => {
        await dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields: RENAMED,
            confirmed: true,
            localized: true,
            renameResolutions: renamedOnCompanion("single_hero"),
            schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
          }
        );
      },
    },
    {
      path: "a field group's schema dialog applies it as a rename",
      table: "comp_banner",
      seed: seedFieldGroup,
      change: async () => {
        await dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields: RENAMED,
            confirmed: true,
            localized: true,
            renameResolutions: renamedOnCompanion("comp_banner"),
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
    "keeps every language's value under the new name when $path",
    async ({ table, seed, change }) => {
      const id = await seed();

      await change();

      expect(await companionValues(table, "title2", id)).toEqual({
        en: "Hello",
        es: "Hola",
      });
    }
  );

  it("offers the rename in the collection's schema dialog", async () => {
    await seedCollection();

    const response = (await dispatchCollections(
      {} as ServiceContainer,
      "previewSchemaChanges",
      { collectionName: "posts" },
      { fields: RENAMED, localized: true }
    )) as Response;
    const preview = (await response.json()) as { renamed?: unknown[] };

    expect(preview.renamed).toContainEqual(
      expect.objectContaining({
        table: "dc_posts_locales",
        from: "heading",
        to: "title2",
      })
    );
  });

  it("leaves the old column and its values in place when a config rename is reconciled", async () => {
    // The code-first path does not yet decide renames: `db:sync` reconciles the companion against
    // the config's field names alone, so the renamed field reads as a new one. Its old column has
    // to stay, every language's value intact, rather than be dropped as a removed field's.
    const id = await seedCollection();

    await reconcileCompanionColumns(
      current.adapter as unknown as Parameters<
        typeof reconcileCompanionColumns
      >[0],
      {
        builtBy: "collection",
        slug: "posts",
        tableName: "dc_posts",
        fields: RENAMED,
        dialect,
      }
    );

    expect(await companionValues("dc_posts", "heading", id)).toEqual({
      en: "Hello",
      es: "Hola",
    });
    expect(await companionValues("dc_posts", "title2", id)).toEqual({
      en: null,
      es: null,
    });
  });

  it("keeps English's value and archives Spanish when the renamed field is made shared", async () => {
    const id = await seedCollection();

    const shared = await handler().updateCollection(
      { collectionName: "posts" },
      {
        fields: [
          { name: "title2", type: "text", localized: false },
          { name: "views", type: "number" },
        ],
      }
    );
    expect(shared.success, JSON.stringify(shared)).toBe(true);

    const [row] = await query<{ value: unknown }>(
      `SELECT ${quote(dialect, "title2")} AS value FROM ${quote(dialect, "dc_posts")} WHERE ${quote(dialect, "id")} = '${id}'`
    );
    expect(row?.value).toBe("Hello");

    // Made translated again under the new name, the archive brings Spanish back to it.
    const translated = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: RENAMED }
    );
    expect(translated.success, JSON.stringify(translated)).toBe(true);
    const result = await restoreI18nArchive({
      adapter: current.adapter as unknown as Parameters<
        typeof restoreI18nArchive
      >[0]["adapter"],
      collection: "posts",
      kind: "collection",
      companionTableName: "dc_posts_locales",
      field: "title2",
    });

    expect(result.locales).toEqual(["es"]);
    expect(await companionValues("dc_posts", "title2", id)).toEqual({
      en: "Hello",
      es: "Hola",
    });
  });
});
