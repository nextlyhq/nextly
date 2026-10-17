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

import { defineCollection, text } from "../../../config";
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
import { CollectionFileManager } from "../../../services/collection-file-manager";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { getI18nArchiveDdl } from "../../../schemas/nextly-i18n-archive/ddl";
import { restoreI18nArchive } from "../migration/restore-archive";

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
      path: "a Single's schema is applied with the schema dialog",
      entity: {
        slug: "hero",
        table: "single_hero",
        registry: "dynamic_singles",
      },
      seed: seedSingle,
      change: async () => {
        await dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields: SHARED,
            confirmed: true,
            localized: true,
            schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
          }
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

  /**
   * Ways an archive can refuse the values a change depends on. Each leaves a table in place, so
   * the create-if-missing leaves it alone and only the write itself can tell.
   */
  const BROKEN_ARCHIVES = [
    {
      archive: "has no columns for the values",
      break: async () => {
        await query(
          `CREATE TABLE ${quote(dialect, "nextly_i18n_archive")} (${quote(dialect, "id")} INTEGER PRIMARY KEY)`
        );
      },
    },
    {
      // The production table with its value column narrowed to one character: a write of NULL
      // succeeds, and a real translation does not.
      archive: "takes a row but not the values",
      break: async () => {
        const narrowed =
          dialect === "mysql"
            ? "`value` VARCHAR(1),"
            : dialect === "sqlite"
              ? `"value" TEXT CHECK (length("value") <= 1),`
              : `"value" VARCHAR(1),`;
        for (const statement of getI18nArchiveDdl(dialect)) {
          await query(
            statement
              .replace('"value" TEXT,', narrowed)
              .replace("`value` LONGTEXT,", narrowed)
          );
        }
      },
    },
  ];

  it.each(
    PATHS.flatMap(path =>
      BROKEN_ARCHIVES.map(broken => ({ ...path, ...broken }))
    )
  )(
    "changes nothing when the archive $archive and $path",
    async ({ entity, seed, change, break: breakArchive }) => {
      const id = await seed();
      await query(
        `DROP TABLE IF EXISTS ${quote(dialect, "nextly_i18n_archive")}`
      );
      await breakArchive();

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

  /** The two ways a collection's fields change, each taking the new field list. */
  const COLLECTION_CHANGES = [
    {
      path: "the builder saves the field alone",
      change: async (fields: unknown[]) => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "the builder applies the change with the schema dialog",
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
  ];

  /** A translated collection whose two entries hold different values of `code`. */
  async function seedCodes(code: Record<string, unknown>): Promise<void> {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: [code],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entries = handler().getEntryService();
    for (const value of ["A-1", "B-2"]) {
      const entry = await entries.createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "en" },
        { code: value }
      );
      expect(entry.success, JSON.stringify(entry)).toBe(true);
    }
  }

  it.each(
    COLLECTION_CHANGES.flatMap(c => [
      { ...c, setting: "required", flags: { required: true } },
      { ...c, setting: "unique", flags: { unique: true } },
    ])
  )(
    "refuses a $setting field and changes nothing when $path",
    async ({ change, flags }) => {
      // The shared column is created before the values are copied into it, so every row would
      // briefly hold the same placeholder or none, which neither setting accepts.
      const code = { name: "code", type: "text", length: 64, ...flags };
      await seedCodes(code);

      const refusal = await change([{ ...code, localized: false }]).then(
        () => undefined,
        (error: unknown) => error
      );

      // The save path reports the refusal in its result, the dialog path throws it; either way it
      // names the field and why.
      const reported =
        refusal instanceof Error
          ? `${refusal.message} ${JSON.stringify((refusal as { publicData?: unknown }).publicData ?? null)}`
          : String(refusal);
      expect(reported).toMatch(/CONSTRAINED_FIELD_LEAVES_TRANSLATION/);
      expect(reported).toMatch(/code\W* is (required|unique)/);

      expect(await columnsOf("dc_posts")).not.toContain("code");
      const kept = await query<{ code: string }>(
        `SELECT ${quote(dialect, "code")} AS code FROM ${quote(dialect, "dc_posts_locales")} ORDER BY ${quote(dialect, "code")}`
      );
      expect(kept.map(row => row.code)).toEqual(["A-1", "B-2"]);
    }
  );

  it("replaces the stale value of a column the main table kept", async () => {
    // Unattended provisioning can seed a companion without dropping the main column it copied
    // from, so this database's main table still has `heading`, holding whatever it held then.
    const id = await seedCollection();
    await query(
      `ALTER TABLE ${quote(dialect, "dc_posts")} ADD COLUMN ${quote(dialect, "heading")} TEXT`
    );
    await query(
      `UPDATE ${quote(dialect, "dc_posts")} SET ${quote(dialect, "heading")} = 'Stale' WHERE ${quote(dialect, "id")} = '${id}'`
    );

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: SHARED }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const [main] = await query<{ heading: string | null }>(
      `SELECT ${quote(dialect, "heading")} AS heading FROM ${quote(dialect, "dc_posts")} WHERE ${quote(dialect, "id")} = '${id}'`
    );
    expect(main?.heading).toBe(VALUES.en);
    expect(await columnsOf("dc_posts_locales")).not.toContain("heading");
  });

  it("writes the archive in its migration before the main table changes", async () => {
    // The save also writes its migration to a file that other databases replay. Replayed where the
    // archive refuses the write, the file must stop before the main table gains the column, since
    // a step that has run is not undone on a dialect without transactional DDL.
    await seedCollection();
    const saved = vi.spyOn(CollectionFileManager.prototype, "saveMigration");

    const result = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: SHARED }
    );
    expect(result.success, JSON.stringify(result)).toBe(true);

    const migration = String(saved.mock.calls.at(-1)?.[0] ?? "");
    const archiveWrite = migration.indexOf(
      `INSERT INTO ${quote(dialect, "nextly_i18n_archive")}`
    );
    const mainChange = migration.indexOf(
      `ALTER TABLE ${quote(dialect, "dc_posts")} ADD COLUMN`
    );
    expect(archiveWrite).toBeGreaterThan(-1);
    expect(mainChange).toBeGreaterThan(-1);
    expect(archiveWrite).toBeLessThan(mainChange);
    saved.mockRestore();
  });

  it.each(
    COLLECTION_CHANGES.flatMap(c => [
      {
        ...c,
        reshape: "a text field becoming a number",
        from: { name: "code", type: "text" },
        to: { name: "code", type: "number", localized: false },
      },
      // The schema dialog's payload has no way to declare a short text field's width (its
      // `options` is a choice list), so the narrowing is made through the save.
      ...(c.path === "the builder saves the field alone"
        ? [
            {
              ...c,
              reshape: "a short text field's maximum length narrowing",
              from: {
                name: "code",
                type: "text",
                options: { variant: "short" },
                validation: { maxLength: 64 },
              },
              to: {
                name: "code",
                type: "text",
                options: { variant: "short" },
                validation: { maxLength: 2 },
                localized: false,
              },
            },
          ]
        : []),
    ])
  )(
    "refuses $reshape as it leaves and changes nothing when $path",
    async ({ change, from, to }) => {
      // The values are copied as they are into a column of another shape: text into a number
      // column fails part-way or is coerced, and "A-1" into a two-character column is refused or
      // truncated.
      await seedCodes(from);

      const refusal = await change([to]).then(
        () => undefined,
        (error: unknown) => error
      );

      const reported =
        refusal instanceof Error
          ? `${refusal.message} ${JSON.stringify((refusal as { publicData?: unknown }).publicData ?? null)}`
          : String(refusal);
      expect(reported).toMatch(/RESHAPED_FIELD_LEAVES_TRANSLATION/);
      expect(await columnsOf("dc_posts")).not.toContain("code");
      const kept = await query<{ code: string }>(
        `SELECT ${quote(dialect, "code")} AS code FROM ${quote(dialect, "dc_posts_locales")} ORDER BY ${quote(dialect, "code")}`
      );
      expect(kept.map(row => row.code)).toEqual(["A-1", "B-2"]);
    }
  );

  it("brings the archived values back once the field is translated again", async () => {
    const id = await seedCollection();
    const shared = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: SHARED }
    );
    expect(shared.success, JSON.stringify(shared)).toBe(true);
    const restore = () =>
      restoreI18nArchive({
        adapter: current.adapter as unknown as Parameters<
          typeof restoreI18nArchive
        >[0]["adapter"],
        collection: "posts",
        kind: "collection",
        companionTableName: "dc_posts_locales",
        field: "heading",
      });

    // While the field is shared its values have nowhere to go, and the restore says so.
    await expect(restore()).rejects.toThrow(/"heading" is not translated now/);

    const translated = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: TRANSLATED }
    );
    expect(translated.success, JSON.stringify(translated)).toBe(true);
    const result = await restore();

    expect(result.locales).toEqual(["ar", "es"]);
    const back = await query<{ locale: string; heading: string | null }>(
      `SELECT ${quote(dialect, "_locale")} AS locale, ${quote(dialect, "heading")} AS heading FROM ${quote(dialect, "dc_posts_locales")} ` +
        `WHERE ${quote(dialect, "_parent")} = '${id}' AND ${quote(dialect, "_locale")} <> 'en' ORDER BY ${quote(dialect, "_locale")}`
    );
    expect(back).toEqual([
      { locale: "ar", heading: VALUES.ar },
      { locale: "es", heading: VALUES.es },
    ]);
  });
  it("restores a field by the name its author knows, not only by its column", async () => {
    // A field defined in code keeps the name its author gave it, so `subTitle` is stored as
    // `sub_title` and archived under that column; the Schema Builder lower-cases names, so only a
    // code-defined field shows the difference.
    await current.destroy();
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: "articles",
          localized: true,
          fields: [text({ name: "subTitle" })],
        }),
      ],
      localization: { locales: LOCALES, defaultLocale: "en" },
    });
    const created = await current.nextly.create({
      collection: "articles",
      data: { subTitle: VALUES.en },
      overrideAccess: true,
    });
    const id = String(created.item.id);
    for (const statement of getI18nArchiveDdl(dialect)) await query(statement);
    await query(
      `INSERT INTO ${quote(dialect, "nextly_i18n_archive")} (${["collection", "entry_id", "locale", "field", "value"].map(c => quote(dialect, c)).join(", ")}) ` +
        `VALUES ('articles', '${id}', 'es', 'sub_title', '${VALUES.es}')`
    );

    const result = await restoreI18nArchive({
      adapter: current.adapter as unknown as Parameters<
        typeof restoreI18nArchive
      >[0]["adapter"],
      collection: "articles",
      kind: "collection",
      companionTableName: "dc_articles_locales",
      field: "subTitle",
    });

    expect(result.rowsRestored).toBe(1);
    const [back] = await query<{ value: string | null }>(
      `SELECT ${quote(dialect, "sub_title")} AS value FROM ${quote(dialect, "dc_articles_locales")} ` +
        `WHERE ${quote(dialect, "_parent")} = '${id}' AND ${quote(dialect, "_locale")} = 'es'`
    );
    expect(back?.value).toBe(VALUES.es);
  });
  it("restores the newest value when a field was archived more than once", async () => {
    // A field made shared, translated again, edited, and made shared again leaves two archive
    // rows for the same entry, language and field; the second is the one to bring back.
    const id = await seedCollection();
    for (const statement of getI18nArchiveDdl(dialect)) await query(statement);
    const archive = quote(dialect, "nextly_i18n_archive");
    const columns = ["id", "collection", "entry_id", "locale", "field", "value"]
      .map(c => quote(dialect, c))
      .join(", ");
    // The newer row (the higher id) is written first, so a read that follows storage order rather
    // than the id meets the older row last; PostgreSQL returns rows in the order they were stored.
    for (const [rowId, value] of [
      [9002, "Newer"],
      [9001, "Older"],
    ] as const) {
      await query(
        `INSERT INTO ${archive} (${columns}) VALUES (${rowId}, 'posts', '${id}', 'es', 'heading', '${value}')`
      );
    }

    await restoreI18nArchive({
      adapter: current.adapter as unknown as Parameters<
        typeof restoreI18nArchive
      >[0]["adapter"],
      collection: "posts",
      kind: "collection",
      companionTableName: "dc_posts_locales",
      field: "heading",
      locale: "es",
    });

    const [back] = await query<{ heading: string | null }>(
      `SELECT ${quote(dialect, "heading")} AS heading FROM ${quote(dialect, "dc_posts_locales")} ` +
        `WHERE ${quote(dialect, "_parent")} = '${id}' AND ${quote(dialect, "_locale")} = 'es'`
    );
    expect(back?.heading).toBe("Newer");
  });
});
