/**
 * A field named with capitals gets the same column on every road a collection is made by.
 *
 * The write path names a field's column `toSnakeCase(name)`, so `metaTitle` is written to
 * `meta_title`. A Schema Builder create that stored the field lowercased (`metatitle`, column
 * `metatitle`) left a collection no entry could be written to, while the same field declared in
 * code worked. These cases drive the Builder's create and save (the handler both the admin API and
 * the Direct API's `collectionsHandler` resolve to), and a code-first collection as the control,
 * and read the live table through the schema pipeline's own introspection.
 *
 * A collection the old create left behind has a field stored as `metatitle` over a column
 * `metatitle`. A later save that spells the field differently only in case keeps the stored name
 * and column, so nothing is dropped, re-added or emptied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../../config";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { introspectLiveSnapshot } from "../../../schema/pipeline/diff/introspect-live";

interface SaveResult {
  success: boolean;
  message?: string;
}

/** The handler a Builder create or save reaches, from the admin API and the Direct API alike. */
interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<SaveResult>;
  updateCollection(
    params: { collectionName: string },
    body: Record<string, unknown>
  ): Promise<SaveResult>;
}

type FieldInput = { name: string; type: string } & Record<string, unknown>;

/** The columns the live table physically carries, read as the schema pipeline reads them. */
async function columnsOf(
  instance: TestNextly,
  table: string
): Promise<string[]> {
  const snapshot = await introspectLiveSnapshot(
    instance.adapter.getDrizzle(),
    instance.adapter.getCapabilities().dialect,
    [table]
  );
  return (
    snapshot.tables
      .find(spec => spec.name === table)
      ?.columns.map(column => column.name) ?? []
  );
}

describeEachDialect("a field named with capitals", (dialect: TestDialect) => {
  let current: TestNextly;

  async function boot(
    collections: Parameters<typeof createTestNextly>[0] = {}
  ): Promise<TestNextly> {
    current = await createTestNextly({
      dialect,
      collections: [],
      ...collections,
    });
    return current;
  }

  beforeEach(() => {
    // The Builder's create and save run their migrations in development only.
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    await current?.destroy();
    vi.unstubAllEnvs();
  });

  function handler(): CollectionsHandler {
    return current.nextly.collectionsHandler as unknown as CollectionsHandler;
  }

  /** The registry's record: its table and the field names it stores. */
  async function stored(
    slug: string
  ): Promise<{ tableName: string; fields: FieldInput[] } | null> {
    const record = await current
      .getService("collectionRegistryService")
      .getCollectionBySlug(slug);
    if (!record) return null;
    return {
      tableName: record.tableName,
      fields: record.fields as unknown as FieldInput[],
    };
  }

  async function storedNames(slug: string): Promise<string[]> {
    return ((await stored(slug))?.fields ?? []).map(field => field.name);
  }

  async function createBuilder(
    slug: string,
    fields: FieldInput[]
  ): Promise<SaveResult> {
    return handler().createCollection({ name: slug, label: slug, fields });
  }

  async function write(
    slug: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const created = await current.nextly.create({
      collection: slug,
      data,
      overrideAccess: true,
    });
    return String((created.item as { id: unknown }).id);
  }

  async function read(
    slug: string,
    id: string
  ): Promise<Record<string, unknown>> {
    const doc = await current.nextly.findByID({
      collection: slug,
      id,
      overrideAccess: true,
    });
    return (doc ?? {}) as Record<string, unknown>;
  }

  it("is created by the Builder under its own name, over the column the write path names", async () => {
    await boot();
    const created = await createBuilder("articles", [
      { name: "metaTitle", type: "text" },
    ]);
    expect(created.success, JSON.stringify(created)).toBe(true);

    // The write first: a collection no entry can be written to is the failure a user meets.
    const id = await write("articles", { metaTitle: "Hello" });
    expect((await read("articles", id)).metaTitle).toBe("Hello");
    expect(await storedNames("articles")).toContain("metaTitle");

    const columns = await columnsOf(current, "dc_articles");
    expect(columns).toContain("meta_title");
    expect(columns).not.toContain("metatitle");
  });

  it("lands on the same column when declared in code", async () => {
    await boot({
      collections: [
        defineCollection({
          slug: "articles",
          fields: [text({ name: "metaTitle" })],
        }),
      ],
    });

    const id = await write("articles", { metaTitle: "Hello" });
    expect((await read("articles", id)).metaTitle).toBe("Hello");

    const table = (await stored("articles"))?.tableName;
    expect(table).toBeDefined();
    const columns = await columnsOf(current, String(table));
    expect(columns).toContain("meta_title");
    expect(columns).not.toContain("metatitle");
  });

  describe("on a save that differs from the stored name only in case", () => {
    /**
     * The state the old create left: field `metatitle` over column `metatitle`, holding a value.
     * Creating with the lowercase name reaches it on any build, before or after the naming change.
     */
    async function lowercasedCollection(): Promise<string> {
      await boot();
      const created = await createBuilder("legacy", [
        { name: "heading", type: "text" },
        { name: "metatitle", type: "text" },
      ]);
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = await write("legacy", { heading: "H", metatitle: "Kept" });
      expect(await columnsOf(current, "dc_legacy")).toContain("metatitle");
      return id;
    }

    async function expectLowercasedKept(id: string): Promise<void> {
      expect(await storedNames("legacy")).toEqual(
        expect.arrayContaining(["heading", "metatitle"])
      );
      expect(await storedNames("legacy")).not.toContain("metaTitle");
      const columns = await columnsOf(current, "dc_legacy");
      expect(columns).toContain("metatitle");
      expect(columns).not.toContain("meta_title");
      expect(await read("legacy", id)).toMatchObject({
        heading: "H",
        metatitle: "Kept",
      });
    }

    it("keeps a lowercased stored field when a save sends it lowercased", async () => {
      const id = await lowercasedCollection();
      const saved = await handler().updateCollection(
        { collectionName: "legacy" },
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "metatitle", type: "text" },
          ],
        }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      await expectLowercasedKept(id);
    });

    it("keeps a lowercased stored field when a save sends it with capitals", async () => {
      const id = await lowercasedCollection();
      const saved = await handler().updateCollection(
        { collectionName: "legacy" },
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "metaTitle", type: "text" },
          ],
        }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      await expectLowercasedKept(id);
    });

    it("keeps a lowercased stored field when a save sends the stored fields back as read", async () => {
      const id = await lowercasedCollection();
      const asStored = (await stored("legacy"))?.fields ?? [];
      expect(asStored.map(field => field.name)).toContain("metatitle");
      const saved = await handler().updateCollection(
        { collectionName: "legacy" },
        { fields: asStored }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      await expectLowercasedKept(id);
    });

    it("keeps a field created with capitals when a save sends it lowercased", async () => {
      await boot();
      const created = await createBuilder("fresh", [
        { name: "heading", type: "text" },
        { name: "metaTitle", type: "text" },
      ]);
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = await write("fresh", { heading: "H", metaTitle: "Kept" });
      expect(await storedNames("fresh")).toContain("metaTitle");

      const saved = await handler().updateCollection(
        { collectionName: "fresh" },
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "metatitle", type: "text" },
          ],
        }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      expect(await storedNames("fresh")).toContain("metaTitle");
      expect(await storedNames("fresh")).not.toContain("metatitle");
      const columns = await columnsOf(current, "dc_fresh");
      expect(columns).toContain("meta_title");
      expect(columns).not.toContain("metatitle");
      expect(await read("fresh", id)).toMatchObject({
        heading: "H",
        metaTitle: "Kept",
      });
    });
  });

  it("refuses two names that map to one column, and creates no table", async () => {
    await boot();
    const created = await createBuilder("clash", [
      { name: "metaTitle", type: "text" },
      { name: "meta_title", type: "text" },
    ]);
    expect(created.success, JSON.stringify(created)).toBe(false);
    // The reason, so a refusal for anything else does not pass for this one.
    expect(created.message).toMatch(/both column meta_title/);
    expect(await current.adapter.tableExists("dc_clash")).toBe(false);
    expect(await stored("clash")).toBeNull();
  });

  it("refuses a name whose column is a system column, and creates no table", async () => {
    await boot();
    const created = await createBuilder("stamped", [
      { name: "heading", type: "text" },
      { name: "createdAt", type: "text" },
    ]);
    expect(created.success, JSON.stringify(created)).toBe(false);
    expect(created.message).toBe("Field name is reserved");
    expect(await current.adapter.tableExists("dc_stamped")).toBe(false);
    expect(await stored("stamped")).toBeNull();
  });
});
