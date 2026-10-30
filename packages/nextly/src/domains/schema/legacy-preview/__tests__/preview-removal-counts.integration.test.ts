/**
 * The Schema Builder's save preview says how many values a removed field takes with it.
 *
 * Removing a field drops its column and every value in it, so the preview counts those values
 * and calls the change destructive when there are any. The count has to read the column where
 * the values really are: a translated field's values live in the companion `<table>_locales`,
 * not on the main table, and a camelCase field's column is its snake_case name. A count that
 * reads the wrong place finds nothing and would call the removal safe.
 *
 * Switching a relationship between one target and many changes how its value is stored, so it
 * can lose the values already saved, and the preview says so for the field in either direction.
 *
 * Every case goes through the dispatcher's preview action, the route the Builder calls, for a
 * collection, a Single and a field group.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { SingleEntryService } from "../../../singles/services/single-entry-service";

const LOCALES = ["en", "es"];

interface RemovedRow {
  name: string;
  rowCount: number;
  classification: string;
}

interface ChangedRow {
  name: string;
  reason: string;
  classification: string;
}

interface Preview {
  hasChanges: boolean;
  classification: string;
  changes: {
    removed: RemovedRow[];
    changed: ChangedRow[];
  };
  warnings: string[];
}

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
  getEntryService(): Entries;
}

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

async function bodyOf(response: unknown): Promise<Preview> {
  const data = (await (response as Response).json()) as Preview & {
    data?: Preview;
  };
  return data.data ?? data;
}

/**
 * A relationship to `people` as the Builder sends it on a save: `hasMany` says whether it holds
 * one related entry or a list of them, which decides how its value is stored.
 */
function author(hasMany: boolean): Record<string, unknown> {
  return {
    name: "author",
    type: "relationship",
    relationTo: "people",
    hasMany,
  };
}

/**
 * The same relationship as the collection create path takes it, which also asks for the target
 * and the kind of relationship under `options`.
 */
const AUTHOR_AT_CREATE = {
  ...author(false),
  options: { target: "people", relationType: "manyToOne" },
};

function removedRow(preview: Preview, name: string): RemovedRow | undefined {
  return preview.changes.removed.find(row => row.name === name);
}

function changedRow(preview: Preview, name: string): ChangedRow | undefined {
  return preview.changes.changed.find(row => row.name === name);
}

describeEachDialect("the preview of a removed field's values", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
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

  async function query<T>(sql: string): Promise<T[]> {
    return (
      current.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  }

  const handler = () =>
    current.getService("collectionsHandler") as unknown as CollectionsHandler;

  async function createCollection(
    slug: string,
    localized: boolean,
    fields: Record<string, unknown>[]
  ): Promise<void> {
    const created = await handler().createCollection({
      name: slug,
      label: slug,
      localized,
      fields,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
  }

  async function createEntry(
    slug: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const entry = await handler()
      .getEntryService()
      .createEntry(
        { collectionName: slug, overrideAccess: true, locale: "en" },
        data
      );
    expect(entry.success, JSON.stringify(entry)).toBe(true);
    return String((entry.data as { id: unknown }).id);
  }

  async function previewCollection(
    slug: string,
    fields: Record<string, unknown>[],
    localized: boolean
  ): Promise<Preview> {
    return bodyOf(
      await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: slug },
        { fields, localized }
      )
    );
  }

  // Two values, English and Spanish, on one entry; the other entry's English row holds none. All
  // three rows sit in the companion, and the main table has no column for the field at all, so
  // only a count of the companion's non-null values gives 2.
  it("counts a translated collection field's values in the companion", async () => {
    await createCollection("posts", true, [
      { name: "heading", type: "text" },
      { name: "views", type: "number" },
    ]);
    const id = await createEntry("posts", { heading: "One", views: 1 });
    const translated = await handler().getEntryService().updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { heading: "Uno" }
    );
    expect(translated.success, JSON.stringify(translated)).toBe(true);
    await createEntry("posts", { views: 2 });
    const [rows] = await query<{
      total: number | string;
      without_value: number | string;
    }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN ${quote(dialect, "heading")} IS NULL THEN 1 ELSE 0 END) AS without_value ` +
        `FROM ${quote(dialect, "dc_posts_locales")}`
    );
    // The fixture holds a companion row without a value, which the count must leave out.
    expect([Number(rows?.total), Number(rows?.without_value)]).toEqual([3, 1]);

    const preview = await previewCollection(
      "posts",
      [{ name: "views", type: "number" }],
      true
    );

    expect(removedRow(preview, "heading")).toMatchObject({
      classification: "destructive",
      rowCount: 2,
    });
    expect(preview.classification).not.toBe("safe");
  });

  // One entry of two holds a value, so a count of every row would be wrong as well.
  it("counts a plain field's values on the main table", async () => {
    await createCollection("notes", false, [
      { name: "heading", type: "text" },
      { name: "views", type: "number" },
    ]);
    await createEntry("notes", { heading: "One", views: 1 });
    await createEntry("notes", { views: 2 });

    const preview = await previewCollection(
      "notes",
      [{ name: "views", type: "number" }],
      false
    );

    expect(removedRow(preview, "heading")).toMatchObject({
      classification: "destructive",
      rowCount: 1,
    });
    expect(preview.classification).not.toBe("safe");
  });

  // The field is `metaTitle`; its column is `meta_title`. A Builder collection cannot hold a
  // camelCase field (the Builder's payload rules refuse the name), so a Single and a field group
  // carry it, as their create paths accept it.
  const META_TITLE = [
    { name: "metaTitle", type: "text" },
    { name: "views", type: "number" },
  ];

  it("counts a camelCase Single field's values in its snake_case column", async () => {
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "hero", label: "Hero", fields: META_TITLE }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    const written = await singles.update(
      "hero",
      { metaTitle: "Welcome" },
      { overrideAccess: true }
    );
    expect(written.success, JSON.stringify(written)).toBe(true);

    const preview = await bodyOf(
      await dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "hero" },
        { fields: [{ name: "views", type: "number" }] }
      )
    );

    expect(removedRow(preview, "metaTitle")).toMatchObject({
      classification: "destructive",
      rowCount: 1,
    });
    expect(preview.classification).not.toBe("safe");
  });

  // Two instance rows, one holding a value, so a count of every row would be wrong as well.
  it("counts a camelCase field group field's values in its snake_case column", async () => {
    await dispatchComponents(
      "createComponent",
      {},
      { slug: "seo", label: "SEO", fields: META_TITLE }
    );
    const columns = ["id", "_parent_id", "_parent_table", "_parent_field"];
    for (const [id, metaTitle] of [
      ["seo-1", "'Welcome'"],
      ["seo-2", "NULL"],
    ]) {
      await query(
        `INSERT INTO ${quote(dialect, "comp_seo")} (${[...columns, "meta_title"].map(c => quote(dialect, c)).join(", ")}) ` +
          `VALUES ('${id}', 'entry-1', 'dc_pages', 'seo', ${metaTitle})`
      );
    }

    const preview = await bodyOf(
      await dispatchComponents(
        "previewComponentSchemaChanges",
        { slug: "seo" },
        { fields: [{ name: "views", type: "number" }] }
      )
    );

    expect(removedRow(preview, "metaTitle")).toMatchObject({
      classification: "destructive",
      rowCount: 1,
    });
    expect(preview.classification).not.toBe("safe");
  });

  // The controls: a removed field whose column really holds nothing loses nothing. Only the
  // field's own row is asserted; the pipeline classes dropping any column on its own.
  it("keeps the removal of an empty plain field safe", async () => {
    await createCollection("notes", false, [
      { name: "summary", type: "text" },
      { name: "views", type: "number" },
    ]);
    await createEntry("notes", { views: 1 });
    await createEntry("notes", { views: 2 });

    const preview = await previewCollection(
      "notes",
      [{ name: "views", type: "number" }],
      false
    );

    expect(removedRow(preview, "summary")).toMatchObject({
      classification: "safe",
      rowCount: 0,
    });
  });

  it("keeps the removal of an empty translated field safe", async () => {
    await createCollection("posts", true, [
      { name: "summary", type: "text" },
      { name: "views", type: "number" },
    ]);
    await createEntry("posts", { views: 1 });

    const preview = await previewCollection(
      "posts",
      [{ name: "views", type: "number" }],
      true
    );

    expect(removedRow(preview, "summary")).toMatchObject({
      classification: "safe",
      rowCount: 0,
    });
  });

  // One target becomes many: the column the saved reference sits in is replaced by a list. The
  // toggle is destructive whatever the field holds; a saved reference makes the loss concrete.
  it("calls a relationship switching from one related entry to many destructive", async () => {
    await createCollection("people", false, [{ name: "name", type: "text" }]);
    const person = await createEntry("people", { name: "Ada" });
    await createCollection("posts", false, [
      { name: "title", type: "text" },
      AUTHOR_AT_CREATE,
    ]);
    await createEntry("posts", { title: "One", author: person });

    const preview = await previewCollection(
      "posts",
      [{ name: "title", type: "text" }, author(true)],
      false
    );

    expect(changedRow(preview, "author")).toMatchObject({
      classification: "destructive",
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Changing 'author' between one and many related entries"
        ),
      ])
    );
  });

  // Many targets become one: a saved list does not fit a single reference. No list is saved
  // first: the create path gives the field a single reference column whatever `hasMany` says,
  // which refuses a list (a foreign key violation), and a Builder save switching an existing
  // field to many fails on PostgreSQL converting that column. The toggle is destructive whatever
  // the field holds, which is what this asserts.
  it("calls a relationship switching from many related entries to one destructive", async () => {
    await createCollection("people", false, [{ name: "name", type: "text" }]);
    await createCollection("posts", false, [
      { name: "title", type: "text" },
      { ...AUTHOR_AT_CREATE, hasMany: true },
    ]);

    const preview = await previewCollection(
      "posts",
      [{ name: "title", type: "text" }, author(false)],
      false
    );

    expect(changedRow(preview, "author")).toMatchObject({
      classification: "destructive",
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Changing 'author' between one and many related entries"
        ),
      ])
    );
  });

  it("counts a translated Single field's values in the companion", async () => {
    await dispatchSingles(
      "createSingle",
      {},
      {
        slug: "hero",
        label: "Hero",
        localized: true,
        fields: [
          { name: "heading", type: "text" },
          { name: "views", type: "number" },
        ],
      }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    for (const [locale, value] of [
      ["en", "Hello"],
      ["es", "Hola"],
    ]) {
      const written = await singles.update(
        "hero",
        { heading: value },
        { locale, overrideAccess: true }
      );
      expect(written.success, JSON.stringify(written)).toBe(true);
    }

    const preview = await bodyOf(
      await dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "hero" },
        { fields: [{ name: "views", type: "number" }], localized: true }
      )
    );

    expect(removedRow(preview, "heading")).toMatchObject({
      classification: "destructive",
      rowCount: 2,
    });
    expect(preview.classification).not.toBe("safe");
  });

  // A field group's rows are written by the entry that embeds it; the instance row and its
  // languages are inserted directly, as an embedding entry's save leaves them.
  it("counts a translated field group field's values in the companion", async () => {
    await dispatchComponents(
      "createComponent",
      {},
      {
        slug: "promo",
        label: "Promo",
        localized: true,
        fields: [
          { name: "heading", type: "text" },
          { name: "views", type: "number" },
        ],
      }
    );
    await query(
      `INSERT INTO ${quote(dialect, "comp_promo")} (${["id", "_parent_id", "_parent_table", "_parent_field", "views"].map(c => quote(dialect, c)).join(", ")}) ` +
        `VALUES ('promo-1', 'entry-1', 'dc_pages', 'promo', 7)`
    );
    for (const [locale, value] of [
      ["en", "Hello"],
      ["es", "Hola"],
    ]) {
      await query(
        `INSERT INTO ${quote(dialect, "comp_promo_locales")} (${["_parent", "_locale", "heading"].map(c => quote(dialect, c)).join(", ")}) ` +
          `VALUES ('promo-1', '${locale}', '${value}')`
      );
    }

    const preview = await bodyOf(
      await dispatchComponents(
        "previewComponentSchemaChanges",
        { slug: "promo" },
        { fields: [{ name: "views", type: "number" }], localized: true }
      )
    );

    expect(removedRow(preview, "heading")).toMatchObject({
      classification: "destructive",
      rowCount: 2,
    });
    expect(preview.classification).not.toBe("safe");
  });
});
