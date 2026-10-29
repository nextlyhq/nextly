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
import { archiveFieldsLeavingTranslation } from "../migration/archive-preflight";
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

  /** A table's column names, read from the database rather than the registry. */
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

  // An apply that renamed the companion column and then stopped (MySQL commits each schema
  // statement; the registry write comes last everywhere) leaves the column renamed while the
  // registry still records the old field. Retried, the save has to finish rather than rename again.
  it.each(PATHS)(
    "finishes a rename an earlier apply already made on the companion when $path",
    async ({ table, seed, change }) => {
      const id = await seed();
      await query(
        `ALTER TABLE ${quote(dialect, `${table}_locales`)} RENAME COLUMN ${quote(dialect, "heading")} TO ${quote(dialect, "title2")}`
      );

      await change();

      expect(await companionValues(table, "title2", id)).toEqual({
        en: "Hello",
        es: "Hola",
      });
      expect(await columnsOf(`${table}_locales`)).not.toContain("heading");
    }
  );

  /** `heading` removed and two translated fields added: no rename the rule can pick, so none is offered. */
  const TWO_ADDED = [
    { name: "title2", type: "text" },
    { name: "title3", type: "text" },
    { name: "views", type: "number" },
  ];

  /** An answer the server never offered: `heading` renamed to `title3`. */
  const unoffered = (table: string) => [
    {
      tableName: `${table}_locales`,
      fromColumn: "heading",
      toColumn: "title3",
      choice: "rename" as const,
    },
  ];

  /**
   * Saves that take a translated field away and add another without a rename the rule can pick,
   * so none is offered: read by name alone, each drops the old companion column and every
   * language's value with it, and nothing in the change asked the admin about that column.
   */
  const NO_RENAME_PICKED = [
    {
      shape: "two translated fields renamed",
      fields: [
        { name: "title2", type: "text" },
        { name: "count2", type: "number" },
      ],
    },
    { shape: "a translated field renamed beside a new one", fields: TWO_ADDED },
    {
      shape: "a translated field renamed to another type",
      fields: [
        { name: "title2", type: "number" },
        { name: "views", type: "number" },
      ],
    },
  ];

  /** Every path that saves a translated entity's fields, given no rename answer. */
  const UNANSWERED_SAVES = [
    {
      path: "the builder saves the collection",
      table: "dc_posts",
      seed: seedCollection,
      save: async (fields: unknown[]) => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "the collection's schema dialog applies it",
      table: "dc_posts",
      seed: seedCollection,
      save: async (fields: unknown[]) =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields,
            confirmed: true,
            localized: true,
            renameResolutions: [],
            schemaVersion: await schemaVersionOf(
              "dynamic_collections",
              "posts"
            ),
          }
        ),
    },
    {
      path: "a Single's schema is saved",
      table: "single_hero",
      seed: seedSingle,
      save: async (fields: unknown[]) =>
        dispatchSingles("updateSingleSchema", { slug: "hero" }, { fields }),
    },
    {
      path: "a Single's schema dialog applies it",
      table: "single_hero",
      seed: seedSingle,
      save: async (fields: unknown[]) =>
        dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields,
            confirmed: true,
            localized: true,
            renameResolutions: [],
            schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
          }
        ),
    },
    {
      path: "a field group's schema dialog applies it",
      table: "comp_banner",
      seed: seedFieldGroup,
      save: async (fields: unknown[]) =>
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields,
            confirmed: true,
            localized: true,
            renameResolutions: [],
            schemaVersion: await schemaVersionOf(
              "dynamic_components",
              "banner"
            ),
          }
        ),
    },
  ];

  it.each(
    NO_RENAME_PICKED.flatMap(shape =>
      UNANSWERED_SAVES.map(save => ({ ...shape, ...save }))
    )
  )(
    "refuses $shape in one change when $path, keeping every language",
    async ({ table, seed, save, fields }) => {
      const id = await seed();

      const refusal = await save(fields).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(reported(refusal)).toMatch(
        /TRANSLATED_FIELD_REMOVED_BESIDE_ADDED/
      );
      expect(reported(refusal)).toMatch(/heading/);
      expect(await companionValues(table, "heading", id)).toEqual({
        en: "Hello",
        es: "Hola",
      });
      expect(await columnsOf(`${table}_locales`)).not.toContain("title2");
      // Nor did the main table change: a new shared field would have its column there.
      const mainColumns = await columnsOf(table);
      for (const added of ["title2", "title3", "count2"]) {
        expect(mainColumns).not.toContain(added);
      }
    }
  );

  // Turning translation off restores each field from the companion under the name it had, so a
  // translated field removed beside an added one in that save would come back under a name no
  // field has.
  it.each([
    {
      path: "the builder saves the collection",
      table: "dc_posts",
      seed: seedCollection,
      save: async () => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { localized: false, fields: TWO_ADDED }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "a Single's schema is saved",
      table: "single_hero",
      seed: seedSingle,
      save: async () =>
        dispatchSingles(
          "updateSingleSchema",
          { slug: "hero" },
          { localized: false, fields: TWO_ADDED }
        ),
    },
  ])(
    "refuses a translated field removed beside added ones in the save that turns translation off, when $path",
    async ({ table, seed, save }) => {
      const id = await seed();

      const refusal = await save().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(reported(refusal)).toMatch(
        /TRANSLATED_FIELD_REMOVED_BESIDE_ADDED/
      );
      expect(await companionValues(table, "heading", id)).toEqual({
        en: "Hello",
        es: "Hola",
      });
    }
  );

  /** A shared collection whose `heading` holds "Hello" on its main table. */
  async function seedSharedCollection(): Promise<string> {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      fields: TRANSLATED,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entry = await handler()
      .getEntryService()
      .createEntry(
        { collectionName: "posts", overrideAccess: true },
        { heading: "Hello", views: 7 }
      );
    expect(entry.success, JSON.stringify(entry)).toBe(true);
    return String((entry.data as { id: unknown }).id);
  }

  /** The same, for a shared Single. */
  async function seedSharedSingle(): Promise<string> {
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "hero", label: "Hero", fields: TRANSLATED }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    const written = await singles.update(
      "hero",
      { heading: "Hello", views: 7 },
      { overrideAccess: true }
    );
    expect(written.success, JSON.stringify(written)).toBe(true);
    const [row] = await query<{ id: string }>(
      `SELECT ${quote(dialect, "id")} AS id FROM ${quote(dialect, "single_hero")}`
    );
    return String(row.id);
  }

  /** The settings saves that turn translation on, given the new field list. */
  const ENABLING_SAVES = [
    {
      path: "the builder saves the collection",
      table: "dc_posts",
      seed: seedSharedCollection,
      save: async (fields: unknown[]) => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { localized: true, fields }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "a Single's schema is saved",
      table: "single_hero",
      seed: seedSharedSingle,
      save: async (fields: unknown[]) =>
        dispatchSingles(
          "updateSingleSchema",
          { slug: "hero" },
          { localized: true, fields }
        ),
    },
  ];

  // Turning translation on moves each field's main column to the companion only under a name the
  // field has before and after the save, so a field that will be translated, taken away beside an
  // added one, would have its value dropped with its main column and nothing seeded in its place.
  it.each(
    [
      {
        shape: "replaced by two fields",
        fields: [
          { name: "headline", type: "text" },
          { name: "teaser", type: "text" },
          { name: "views", type: "number" },
        ],
      },
      {
        shape: "renamed",
        fields: [
          { name: "headline", type: "text" },
          { name: "views", type: "number" },
        ],
      },
    ].flatMap(shape => ENABLING_SAVES.map(save => ({ ...shape, ...save })))
  )(
    "refuses a field $shape in the save that turns translation on, keeping its value, when $path",
    async ({ table, seed, save, fields }) => {
      const id = await seed();

      const refusal = await save(fields).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(reported(refusal)).toMatch(
        /TRANSLATED_FIELD_REMOVED_BESIDE_ADDED/
      );
      expect(reported(refusal)).toMatch(/heading/);
      expect(reported(refusal)).toMatch(/Turn translation on/);
      expect(await mainValue(table, "heading", id)).toBe("Hello");
      expect(await columnsOf(`${table}_locales`)).toEqual([]);
    }
  );

  /** The schema dialogs' applies that turn translation on, given the admin's answers. */
  const ENABLING_DIALOGS = [
    {
      path: "the collection's schema dialog",
      table: "dc_posts",
      seed: seedSharedCollection,
      apply: async (fields: unknown[], resolutions: Record<string, unknown>) =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields,
            confirmed: true,
            localized: true,
            renameResolutions: [],
            resolutions,
            schemaVersion: await schemaVersionOf(
              "dynamic_collections",
              "posts"
            ),
          }
        ),
    },
    {
      path: "a Single's schema dialog",
      table: "single_hero",
      seed: seedSharedSingle,
      apply: async (fields: unknown[], resolutions: Record<string, unknown>) =>
        dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields,
            confirmed: true,
            localized: true,
            renameResolutions: [],
            resolutions,
            schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
          }
        ),
    },
  ];

  /** `heading` replaced by two fields in the save that turns translation on. */
  const REPLACED_AS_TRANSLATION_STARTS = [
    { name: "headline", type: "text" },
    { name: "teaser", type: "text" },
    { name: "views", type: "number" },
  ];

  // Before translation is on, `heading` is a main-table column, so a schema dialog's push asks
  // about its drop like any other: refused with no answer, and applied once the admin confirms it.
  it.each(ENABLING_DIALOGS)(
    "refuses an unconfirmed drop in the save that turns translation on, when $path applies",
    async ({ table, seed, apply }) => {
      const id = await seed();

      const refusal = await apply(REPLACED_AS_TRANSLATION_STARTS, {}).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(reported(refusal)).toMatch(/cancelled/);
      expect(await mainValue(table, "heading", id)).toBe("Hello");
    }
  );

  it.each(ENABLING_DIALOGS)(
    "applies a drop the admin confirmed in the save that turns translation on, when $path applies",
    async ({ table, seed, apply }) => {
      await seed();

      await apply(REPLACED_AS_TRANSLATION_STARTS, {
        heading: { action: "confirm_drop" },
      });

      expect(await columnsOf(table)).not.toContain("heading");
      expect(await columnsOf(`${table}_locales`)).toContain("headline");
    }
  );

  // The positive control for the refusal above: turning translation on beside an added field
  // moves the kept field's value to the default language's row.
  it.each(ENABLING_SAVES)(
    "turns translation on beside an added field, keeping the value, when $path",
    async ({ table, seed, save }) => {
      const id = await seed();

      await save([...TRANSLATED, { name: "teaser", type: "text" }]);

      expect(await companionValues(table, "heading", id)).toEqual({
        en: "Hello",
      });
    }
  );

  // A field group's settings save changes only its companion, so a translated field taken away
  // beside an added one would drop the companion column with every language's value. A nested
  // field group stores its rows in its own table and renders no companion column, so the save is
  // judged by the same rule as the other settings saves rather than by which columns it renders.
  // A text field in its place is a rename, which this save cannot apply and refuses on its own.
  it.each([
    {
      shape: "a nested field group",
      added: { name: "cta", type: "component", component: "button" },
      code: /TRANSLATED_FIELD_REMOVED_BESIDE_ADDED/,
    },
    {
      shape: "a text field",
      added: { name: "title2", type: "text" },
      code: /requires_schema_change/,
    },
  ])(
    "refuses a field group's settings save that replaces a translated field with $shape, keeping every language",
    async ({ added, code }) => {
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "button",
          label: "Button",
          fields: [{ name: "label", type: "text" }],
        }
      );
      const id = await seedFieldGroup();

      const refusal = await dispatchComponents(
        "updateComponent",
        { slug: "banner" },
        { fields: [added, { name: "views", type: "number" }] }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(await companionValues("comp_banner", "heading", id)).toEqual({
        en: "Hello",
        es: "Hola",
      });
      expect(reported(refusal)).toMatch(code);
    }
  );

  // The positive control for the refusal above: removing a translated field on its own is the
  // admin's choice, and the settings save applies it.
  it("applies a field group's settings save that only removes a translated field", async () => {
    await seedFieldGroup();

    await dispatchComponents(
      "updateComponent",
      { slug: "banner" },
      { fields: [{ name: "views", type: "number" }] }
    );

    expect(await columnsOf("comp_banner_locales")).not.toContain("heading");
  });

  // A field group keeps a many-to-many relationship on its own row, as a column, where a
  // collection keeps it in a junction table, so replacing a translated field with one is the
  // same removal beside an addition. Asked of the preflight directly: the schema dialog's payload
  // spells relationships without the options object that names a many-to-many.
  /** A many-to-many relationship, as stored field definitions spell one. */
  const MANY_TO_MANY = {
    name: "related",
    type: "relationship",
    options: { relationType: "manyToMany", target: "users" },
  };

  it("refuses a field group's translated field replaced by a many-to-many relationship", async () => {
    const id = await seedFieldGroup();

    const refusal = await archiveFieldsLeavingTranslation({
      adapter: current.adapter,
      entity: "banner",
      kind: "fieldGroup",
      tableName: "comp_banner",
      builtBy: "fieldGroup",
      defaultLocale: "en",
      oldFields: TRANSLATED,
      newFields: [MANY_TO_MANY, { name: "views", type: "number" }],
      wasLocalized: true,
      isLocalized: true,
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(reported(refusal)).toMatch(/TRANSLATED_FIELD_REMOVED_BESIDE_ADDED/);
    expect(await companionValues("comp_banner", "heading", id)).toEqual({
      en: "Hello",
      es: "Hola",
    });
  });

  // A many-to-many relationship keeps its links in a junction table, with no column on the
  // collection's row, but it is still a field added beside the removed one.
  it("refuses a collection's translated field replaced by a many-to-many relationship", async () => {
    const id = await seedCollection();

    const refusal = await archiveFieldsLeavingTranslation({
      adapter: current.adapter,
      entity: "posts",
      kind: "collection",
      tableName: "dc_posts",
      builtBy: "collection",
      defaultLocale: "en",
      oldFields: TRANSLATED,
      newFields: [MANY_TO_MANY, { name: "views", type: "number" }],
      wasLocalized: true,
      isLocalized: true,
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(reported(refusal)).toMatch(/TRANSLATED_FIELD_REMOVED_BESIDE_ADDED/);
    expect(await companionValues("dc_posts", "heading", id)).toEqual({
      en: "Hello",
      es: "Hola",
    });
  });

  // The apply takes back only the rename its preview offers. An answer naming any other pair,
  // stale or made up, is dropped, as the main table's are, rather than attach one field's
  // translations to another; the change is then judged with no rename, and refused.
  it.each([
    {
      path: "the collection's schema dialog",
      table: "dc_posts",
      seed: seedCollection,
      apply: async () =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: TWO_ADDED,
            confirmed: true,
            localized: true,
            renameResolutions: unoffered("dc_posts"),
            schemaVersion: await schemaVersionOf(
              "dynamic_collections",
              "posts"
            ),
          }
        ),
    },
    {
      path: "a Single's schema dialog",
      table: "single_hero",
      seed: seedSingle,
      apply: async () =>
        dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields: TWO_ADDED,
            confirmed: true,
            localized: true,
            renameResolutions: unoffered("single_hero"),
            schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
          }
        ),
    },
    {
      path: "a field group's schema dialog",
      table: "comp_banner",
      seed: seedFieldGroup,
      apply: async () =>
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields: TWO_ADDED,
            confirmed: true,
            localized: true,
            renameResolutions: unoffered("comp_banner"),
            schemaVersion: await schemaVersionOf(
              "dynamic_components",
              "banner"
            ),
          }
        ),
    },
  ])(
    "drops a rename answer it did not offer and refuses the change, when $path applies",
    async ({ table, seed, apply }) => {
      const id = await seed();

      const refusal = await apply().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(reported(refusal)).toMatch(
        /TRANSLATED_FIELD_REMOVED_BESIDE_ADDED/
      );
      expect(await companionValues(table, "heading", id)).toEqual({
        en: "Hello",
        es: "Hola",
      });
      expect(await columnsOf(`${table}_locales`)).not.toContain("title3");
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

  /** A translated short text field, whose maximum length sets its column's width. */
  function shortText(name: string, maxLength: number) {
    return {
      name,
      type: "text",
      options: { variant: "short" },
      validation: { maxLength },
    };
  }

  /** `heading` as a 64-character translated field, holding "Hello" and "Hola". */
  async function seedShortHeading(): Promise<string> {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: [shortText("heading", 64)],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entries = handler().getEntryService();
    const entry = await entries.createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { heading: "Hello" }
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

  it("refuses renaming a translated field and changing its storage in one save, and changes nothing", async () => {
    // A rename keeps the column's type, so the two together would leave every language behind.
    const id = await seedShortHeading();

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: [shortText("title2", 32)] }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(false);
    expect(JSON.stringify(saved)).toMatch(/RESHAPED_TRANSLATED_FIELD_RENAMED/);
    expect(await companionValues("dc_posts", "heading", id)).toEqual({
      en: "Hello",
      es: "Hola",
    });
  });

  it("keeps every language through the rename and then the storage change, saved one after the other", async () => {
    const id = await seedShortHeading();

    for (const fields of [
      [shortText("title2", 64)],
      [shortText("title2", 32)],
    ]) {
      const saved = await handler().updateCollection(
        { collectionName: "posts" },
        { fields }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
    }

    expect(await companionValues("dc_posts", "title2", id)).toEqual({
      en: "Hello",
      es: "Hola",
    });
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

  /** `heading` renamed to `title2` and made shared, with `flags`. */
  const renamedShared = (flags: Record<string, unknown> = {}) => [
    { name: "title2", type: "text", localized: false, ...flags },
    { name: "views", type: "number" },
  ];

  /** What a refused change raised or reported, as text. */
  function reported(refusal: unknown): string {
    return refusal instanceof Error
      ? `${refusal.message} ${JSON.stringify((refusal as { publicData?: unknown }).publicData ?? null)}`
      : String(refusal);
  }

  /** The field still translated under its old name, every language in place, nothing on main. */
  async function expectUnchanged(id: string): Promise<void> {
    expect(await companionValues("dc_posts", "heading", id)).toEqual({
      en: "Hello",
      es: "Hola",
    });
    expect(await columnsOf("dc_posts")).not.toContain("title2");
  }

  /** Every path that can rename a translated field and make it shared in one change. */
  const RENAMED_SHARED_PATHS = [
    {
      path: "the builder saves the collection",
      // Saved through the schema service's own ALTER, which on SQLite renders no column
      // modification (`generateAlterTableMigration`), so the NOT NULL a Required setting adds
      // once the values are shared is not applied there.
      sqliteSkipsColumnModification: true,
      table: "dc_posts",
      seed: seedCollection,
      change: async (fields: unknown[]) => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "the collection's schema dialog applies it as a rename",
      sqliteSkipsColumnModification: false,
      table: "dc_posts",
      seed: seedCollection,
      change: async (fields: unknown[]) => {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields,
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
      // Saved through the schema service's own ALTER, which on SQLite renders no column
      // modification (`generateAlterTableMigration`), so the NOT NULL a Required setting adds
      // once the values are shared is not applied there.
      sqliteSkipsColumnModification: true,
      table: "single_hero",
      seed: seedSingle,
      change: async (fields: unknown[]) => {
        await dispatchSingles(
          "updateSingleSchema",
          { slug: "hero" },
          { fields }
        );
      },
    },
    {
      path: "a Single's schema dialog applies it as a rename",
      sqliteSkipsColumnModification: false,
      table: "single_hero",
      seed: seedSingle,
      change: async (fields: unknown[]) => {
        await dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields,
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
      sqliteSkipsColumnModification: false,
      table: "comp_banner",
      seed: seedFieldGroup,
      change: async (fields: unknown[]) => {
        await dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields,
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

  // A field renamed and made shared in one change leaves translation under its new name, so it is
  // judged as one before anything runs: its settings, and the archive its other languages go to.
  // Its column comes without the setting and takes it once English's value is in, as any leaving
  // field's does; on SQLite a save through the schema service's ALTER skips column modification,
  // so there the column stays nullable. Stated as what happens rather than skipped, so the
  // assertion fails, and is to be turned around, once that save can modify a column on SQLite.
  it.each(
    RENAMED_SHARED_PATHS.map(p => ({
      ...p,
      notNullSkipped: dialect === "sqlite" && p.sqliteSkipsColumnModification,
    })).map(p => ({
      ...p,
      outcome: p.notNullSkipped
        ? "leaves it nullable, as SQLite skips column modification on a save,"
        : "makes it Required",
    }))
  )(
    "keeps English's value under the new name and $outcome for a field renamed, made shared and Required in one change, when $path",
    async ({ table, seed, change, notNullSkipped }) => {
      const id = await seed();

      await change(renamedShared({ required: true }));

      expect(await mainValue(table, "title2", id)).toBe("Hello");
      expect(await isNotNull(table, "title2")).toBe(!notNullSkipped);
    }
  );

  // Asked of the values in the column the field had, since the rename has not moved them yet.
  it.each(RENAMED_SHARED_PATHS)(
    "refuses a field renamed, made shared and Required while an entry has no English value, and changes nothing, when $path",
    async ({ table, seed, change }) => {
      const id = await seed();
      await query(
        `DELETE FROM ${quote(dialect, `${table}_locales`)} WHERE ${quote(dialect, "_locale")} = 'en'`
      );

      const refusal = await change(renamedShared({ required: true })).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(reported(refusal)).toMatch(/1 entry has no English title2/);
      expect(await companionValues(table, "heading", id)).toEqual({
        es: "Hola",
      });
      expect(await columnsOf(table)).not.toContain("title2");
    }
  );

  /** Whether `column` on `table` refuses NULL, as the database reports it. */
  async function isNotNull(table: string, column: string): Promise<boolean> {
    if (dialect === "sqlite") {
      const rows = await query<{ name: string; refusesNull: number }>(
        `SELECT name, "notnull" AS refusesNull FROM pragma_table_info('${table}')`
      );
      return Number(rows.find(row => row.name === column)?.refusesNull) === 1;
    }
    const [row] = await query<{ nullable: string }>(
      dialect === "mysql"
        ? `SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`
        : `SELECT is_nullable AS nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = '${column}'`
    );
    return row?.nullable === "NO";
  }

  it("changes nothing when the archive cannot be written and the schema dialog renames a field to shared", async () => {
    const id = await seedCollection();
    // An archive that refuses the values: a table left in place, so only the write can tell.
    await query(
      `DROP TABLE IF EXISTS ${quote(dialect, "nextly_i18n_archive")}`
    );
    await query(
      `CREATE TABLE ${quote(dialect, "nextly_i18n_archive")} (${quote(dialect, "id")} INTEGER PRIMARY KEY)`
    );

    await expect(
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: renamedShared(),
          confirmed: true,
          localized: true,
          renameResolutions: renamedOnCompanion("dc_posts"),
          schemaVersion: await schemaVersionOf("dynamic_collections", "posts"),
        }
      )
    ).rejects.toThrow(/nothing was changed/);

    await expectUnchanged(id);
  });

  /** The main table's value of `column` for row `id`. */
  async function mainValue(
    table: string,
    column: string,
    id: string
  ): Promise<unknown> {
    const [row] = await query<{ value: unknown }>(
      `SELECT ${quote(dialect, column)} AS value FROM ${quote(dialect, table)} WHERE ${quote(dialect, "id")} = '${id}'`
    );
    return row?.value;
  }

  // Turning translation off restores each field from the companion under the name it had, so a
  // rename in the same change would leave the value under a name no field has. It is refused
  // before anything runs, naming the two saves that work.
  it.each([
    {
      path: "the builder saves the collection",
      table: "dc_posts",
      seed: seedCollection,
      change: async () => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { localized: false, fields: renamedShared() }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "the collection's schema dialog applies it",
      table: "dc_posts",
      seed: seedCollection,
      change: async () => {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: renamedShared(),
            confirmed: true,
            localized: false,
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
          { localized: false, fields: renamedShared() }
        );
      },
    },
    {
      path: "a Single's schema dialog applies it",
      table: "single_hero",
      seed: seedSingle,
      change: async () => {
        await dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields: renamedShared(),
            confirmed: true,
            localized: false,
            renameResolutions: renamedOnCompanion("single_hero"),
            schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
          }
        );
      },
    },
  ])(
    "refuses renaming a translated field while turning translation off, and changes nothing, when $path",
    async ({ table, seed, change }) => {
      const id = await seed();

      const refusal = await change().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(reported(refusal)).toMatch(
        /TRANSLATED_FIELD_RENAMED_AS_TRANSLATION_ENDS/
      );
      expect(await companionValues(table, "heading", id)).toEqual({
        en: "Hello",
        es: "Hola",
      });
      expect(await columnsOf(table)).not.toContain("title2");
    }
  );

  // A save that renames a translated field and makes it shared, and stops after the companion's
  // RENAME, is finished by saving again: its values are read from the column as it is now.
  it.each([
    {
      path: "the builder saves the collection",
      table: "dc_posts",
      seed: seedCollection,
      change: async () => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields: renamedShared() }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "the collection's schema dialog applies it",
      table: "dc_posts",
      seed: seedCollection,
      change: async () => {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: renamedShared(),
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
      path: "a field group's schema dialog applies it",
      table: "comp_banner",
      seed: seedFieldGroup,
      change: async () => {
        await dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields: renamedShared(),
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
  ])(
    "finishes a rename to shared an earlier apply already made on the companion when $path",
    async ({ table, seed, change }) => {
      const id = await seed();
      await query(
        `ALTER TABLE ${quote(dialect, `${table}_locales`)} RENAME COLUMN ${quote(dialect, "heading")} TO ${quote(dialect, "title2")}`
      );

      await change();

      expect(await mainValue(table, "title2", id)).toBe("Hello");
      const [archived] = await query<{ value: unknown }>(
        `SELECT ${quote(dialect, "value")} AS value FROM ${quote(dialect, "nextly_i18n_archive")} ` +
          `WHERE ${quote(dialect, "field")} = 'title2' AND ${quote(dialect, "locale")} = 'es'`
      );
      expect(String(archived?.value)).toContain("Hola");
    }
  );

  // An apply that finished moving a renamed field's values (copied to main, archived, column
  // dropped) and stopped before the registry recorded it leaves a companion with neither column.
  // Saving again finishes the change rather than reading or renaming a column that is gone. The
  // schema dialogs only: the settings saves apply the change and its record whole or not at all.
  it.each([
    {
      path: "a field group's schema dialog applies it",
      table: "comp_banner",
      seed: seedFieldGroup,
      change: async () => {
        await dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields: renamedShared(),
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
    {
      path: "the collection's schema dialog applies it",
      table: "dc_posts",
      seed: seedCollection,
      change: async () => {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: renamedShared(),
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
  ])(
    "finishes a rename to shared an earlier apply completed before the registry recorded it, when $path",
    async ({ table, seed, change }) => {
      const id = await seed();
      // The state the earlier apply left: the value on main, the companion column gone.
      await query(
        `ALTER TABLE ${quote(dialect, table)} ADD COLUMN ${quote(dialect, "title2")} ${dialect === "mysql" ? "VARCHAR(255)" : "TEXT"}`
      );
      await query(
        `UPDATE ${quote(dialect, table)} SET ${quote(dialect, "title2")} = 'Hello' WHERE ${quote(dialect, "id")} = '${id}'`
      );
      await query(
        `ALTER TABLE ${quote(dialect, `${table}_locales`)} DROP COLUMN ${quote(dialect, "heading")}`
      );

      await change();

      expect(await mainValue(table, "title2", id)).toBe("Hello");
      const companion = await columnsOf(`${table}_locales`);
      expect(companion).not.toContain("title2");
      expect(companion).not.toContain("heading");
    }
  );

  type Answer =
    | "rename"
    | "drop_and_add"
    | "missing"
    | "mismatched"
    | "not offered";
  type Storage = "same storage" | "storage changed";
  type Target = "stays translated" | "made shared";

  /** What the schema dialog sends for `heading` becoming `title2` on `table`'s companion. */
  function answered(table: string, answer: Answer) {
    const [offered] = renamedOnCompanion(table);
    if (answer === "missing" || answer === "not offered") return [];
    if (answer === "drop_and_add")
      return [{ ...offered, choice: "drop_and_add" as const }];
    if (answer === "mismatched") return [{ ...offered, toColumn: "title3" }];
    return [offered];
  }

  /**
   * The renamed field list: `heading` as `title2`, translated or shared, its storage kept or
   * changed by `reshape`, the path's own spelling of a 32-character bound, where the seeded
   * field's column is unbounded.
   */
  function renamedFields(
    target: Target,
    storage: Storage,
    reshape: Record<string, unknown> = {}
  ) {
    const reshaped = storage === "storage changed" ? reshape : {};
    return [
      {
        name: "title2",
        type: "text",
        ...(target === "made shared" ? { localized: false } : {}),
        ...reshaped,
      },
      { name: "views", type: "number" },
    ];
  }

  /** A schema preview's body, unwrapped from the dispatcher's response. */
  async function previewOf(
    response: unknown
  ): Promise<{ hasChanges?: boolean }> {
    const body = (await (response as Response).json()) as {
      hasChanges?: boolean;
      data?: { hasChanges?: boolean };
    };
    return body.data ?? body;
  }

  /**
   * Each way a translated field's rename is saved, with the dialog's answer where it has one, and
   * for a dialog the preview the Builder asks before it opens.
   */
  const SAVES: {
    path: string;
    table: string;
    seed: () => Promise<string>;
    answers: (Answer | "none")[];
    save: (fields: unknown[], answer: Answer | "none") => Promise<unknown>;
    preview?: (fields: unknown[]) => Promise<unknown>;
    /**
     * How this path bounds a text field, where it can: none for a Single or the collection's dialog,
     * whose payloads cannot state the short variant.
     */
    reshape?: Record<string, unknown>;
  }[] = [
    {
      path: "the collection's settings",
      table: "dc_posts",
      seed: seedCollection,
      reshape: { options: { variant: "short" }, validation: { maxLength: 32 } },
      answers: ["none"],
      save: async fields => {
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields }
        );
        if (!saved.success) throw new Error(JSON.stringify(saved));
      },
    },
    {
      path: "the collection's schema dialog",
      table: "dc_posts",
      seed: seedCollection,
      // No reshape: the dialog's payload takes `options` only as a list of choices, so it cannot
      // state the short variant that bounds a collection's text column.
      answers: [
        "rename",
        "drop_and_add",
        "missing",
        "mismatched",
        "not offered",
      ],
      save: async (fields, answer) =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields,
            confirmed: true,
            localized: true,
            renameResolutions: answered("dc_posts", answer as Answer),
            schemaVersion: await schemaVersionOf(
              "dynamic_collections",
              "posts"
            ),
          }
        ),
      preview: fields =>
        dispatchCollections(
          {} as ServiceContainer,
          "previewSchemaChanges",
          { collectionName: "posts" },
          { fields, localized: true }
        ),
    },
    {
      path: "a Single's settings",
      table: "single_hero",
      seed: seedSingle,
      answers: ["none"],
      save: async fields =>
        dispatchSingles("updateSingleSchema", { slug: "hero" }, { fields }),
    },
    {
      path: "a Single's schema dialog",
      table: "single_hero",
      seed: seedSingle,
      answers: [
        "rename",
        "drop_and_add",
        "missing",
        "mismatched",
        "not offered",
      ],
      save: async (fields, answer) =>
        dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields,
            confirmed: true,
            localized: true,
            renameResolutions: answered("single_hero", answer as Answer),
            schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
          }
        ),
      preview: fields =>
        dispatchSingles(
          "previewSingleSchemaChanges",
          { slug: "hero" },
          { fields, localized: true }
        ),
    },
    {
      path: "a field group's schema dialog",
      table: "comp_banner",
      seed: seedFieldGroup,
      reshape: { maxLength: 32 },
      answers: [
        "rename",
        "drop_and_add",
        "missing",
        "mismatched",
        "not offered",
      ],
      save: async (fields, answer) =>
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "banner" },
          {
            fields,
            confirmed: true,
            localized: true,
            renameResolutions: answered("comp_banner", answer as Answer),
            schemaVersion: await schemaVersionOf(
              "dynamic_components",
              "banner"
            ),
          }
        ),
      preview: fields =>
        dispatchComponents(
          "previewComponentSchemaChanges",
          { slug: "banner" },
          { fields, localized: true }
        ),
    },
  ];

  /**
   * Whether an answer can arise for a storage choice: a rename that also changes storage is never
   * offered, so the dialog sends no answer for it, and one that keeps storage is always offered.
   */
  const applies = (answer: Answer | "none", storage: Storage) =>
    answer === "none" ||
    (storage === "storage changed") === (answer === "not offered");

  const MATRIX = SAVES.flatMap(save =>
    (["same storage", "storage changed"] as const)
      .filter(storage => storage === "same storage" || save.reshape)
      .flatMap(storage =>
        save.answers
          .filter(answer => applies(answer, storage))
          .flatMap(answer =>
            (["fresh", "part-applied"] as const).flatMap(state =>
              (["stays translated", "made shared"] as const).map(target => ({
                ...save,
                storage,
                answer,
                state,
                target,
              }))
            )
          )
      )
  );

  // Every way a translated field's rename is saved, crossed with each answer the schema dialog can
  // send (or none, when it offered no rename), the field's storage kept or changed, a fresh
  // database or one an earlier apply left renamed, and the field staying translated or becoming
  // shared. A dialog's preview reports the change, so the Builder opens the dialog. Then either the
  // change is refused, naming the field in words an admin can act on, with every language where it
  // was; or every language survives under the new name. Only an explicit choice to drop the old
  // field and add the new one may delete them; an answer that is missing or names another pair is
  // refused, and so is a rename that changes storage.
  it.each(MATRIX)(
    "keeps every language or refuses, when $path is saved, $storage, answer $answer, $state, $target",
    async ({
      table,
      seed,
      save,
      preview,
      reshape,
      storage,
      answer,
      state,
      target,
    }) => {
      const id = await seed();
      if (state === "part-applied") await renameOnCompanion(table);
      const fields = renamedFields(target, storage, reshape);
      // The Builder asks for a preview before it opens a dialog, when the dialog offers a rename.
      if (preview && state === "fresh" && storage === "same storage") {
        await expectDialogOpens(preview, fields);
      }

      const refusal = await save(fields, answer).then(
        () => undefined,
        (error: unknown) => error
      );

      if (mustRefuse(answer, storage)) {
        expect(refusal, "the change is refused").toBeDefined();
      }
      if (refusal !== undefined) {
        await expectRefusedInPlace(refusal, table, id, state);
      } else if (answer !== "drop_and_add") {
        await expectKeptUnderNewName(table, id, target);
      }
    }
  );

  /** The state an earlier apply that renamed the companion column and stopped leaves. */
  async function renameOnCompanion(table: string): Promise<void> {
    await query(
      `ALTER TABLE ${quote(dialect, `${table}_locales`)} RENAME COLUMN ${quote(dialect, "heading")} TO ${quote(dialect, "title2")}`
    );
  }

  /** The preview reports a change, so the Builder opens its dialog to collect the answer. */
  async function expectDialogOpens(
    preview: (fields: unknown[]) => Promise<unknown>,
    fields: unknown[]
  ): Promise<void> {
    const shown = await previewOf(await preview(fields));
    expect(shown.hasChanges, "the Builder opens its dialog").toBe(true);
  }

  /** A change that is always refused: an unanswered rename, or a rename that changes storage. */
  const mustRefuse = (answer: Answer | "none", storage: Storage) =>
    answer === "missing" ||
    answer === "mismatched" ||
    storage === "storage changed";

  /**
   * A refusal an admin can act on, naming the field and the save that works, with every language
   * where it was: under the old name, or the new one an earlier apply gave it.
   */
  async function expectRefusedInPlace(
    refusal: unknown,
    table: string,
    id: string,
    state: "fresh" | "part-applied"
  ): Promise<void> {
    const text = reported(refusal);
    expect(text).toMatch(/fields\.(title2|heading)/);
    expect(text).toMatch(/save/i);
    const column = state === "fresh" ? "heading" : "title2";
    expect(await companionValues(table, column, id)).toEqual({
      en: "Hello",
      es: "Hola",
    });
  }

  /**
   * Every language under the new name: still translated, on the companion; made shared, English on
   * main and Spanish archived under the new name.
   */
  async function expectKeptUnderNewName(
    table: string,
    id: string,
    target: "stays translated" | "made shared"
  ): Promise<void> {
    if (target === "stays translated") {
      expect(await companionValues(table, "title2", id)).toEqual({
        en: "Hello",
        es: "Hola",
      });
      return;
    }
    expect(await mainValue(table, "title2", id)).toBe("Hello");
    const [archived] = await query<{ value: unknown }>(
      `SELECT ${quote(dialect, "value")} AS value FROM ${quote(dialect, "nextly_i18n_archive")} ` +
        `WHERE ${quote(dialect, "field")} = 'title2' AND ${quote(dialect, "locale")} = 'es'`
    );
    expect(String(archived?.value)).toContain("Hola");
  }

  // The admin chose to drop the old field and add the new one: nothing of the old field's other
  // languages is archived under the new name, where a later restore would attach them to a field
  // that was added, not renamed.
  it("archives nothing under the new name when the dialog's answer is to drop and add", async () => {
    await seedCollection();

    await dispatchCollections(
      {} as ServiceContainer,
      "applySchemaChanges",
      { collectionName: "posts" },
      {
        fields: renamedShared(),
        confirmed: true,
        localized: true,
        renameResolutions: answered("dc_posts", "drop_and_add"),
        schemaVersion: await schemaVersionOf("dynamic_collections", "posts"),
      }
    );

    const rows = await query<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM ${quote(dialect, "nextly_i18n_archive")} WHERE ${quote(dialect, "field")} = 'title2'`
    ).catch(() => [{ n: 0 }]);
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });

  // A Single's settings save renames the companion column before anything else changes, so a
  // RENAME the database refuses fails the save with the old field still recorded, and saving again
  // finishes it. Recorded as a failed migration under the new names instead, a retry would find
  // nothing left to rename and the translations would stay under a name no field has.
  it("fails a Single's save whose companion rename is refused, and finishes it when saved again", async () => {
    const id = await seedSingle();
    // A column in the way: the RENAME onto it is refused.
    await query(
      `ALTER TABLE ${quote(dialect, "single_hero_locales")} ADD COLUMN ${quote(dialect, "title2")} ${dialect === "mysql" ? "VARCHAR(255)" : "TEXT"}`
    );

    const refusal = await dispatchSingles(
      "updateSingleSchema",
      { slug: "hero" },
      { fields: RENAMED }
    ).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(reported(refusal)).toMatch(/nothing was changed/);
    expect(await companionValues("single_hero", "heading", id)).toEqual({
      en: "Hello",
      es: "Hola",
    });

    await query(
      `ALTER TABLE ${quote(dialect, "single_hero_locales")} DROP COLUMN ${quote(dialect, "title2")}`
    );
    await dispatchSingles(
      "updateSingleSchema",
      { slug: "hero" },
      { fields: RENAMED }
    );

    expect(await companionValues("single_hero", "title2", id)).toEqual({
      en: "Hello",
      es: "Hola",
    });
  });
});
