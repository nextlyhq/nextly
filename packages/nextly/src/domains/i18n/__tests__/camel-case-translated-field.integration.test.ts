/**
 * A translated field whose name has capitals, in a Schema Builder collection, takes writes in
 * every language in the process that created or changed it, without a restart.
 *
 * The Builder stores field names lowercased (`subTitle` becomes `subtitle`), and the database and
 * the registry name its column from that. The tables this process keeps for reads and writes have
 * to be built from the same stored names: built from the names as the request spelled them, the
 * companion's column read `sub_title`, and every write in a language other than the default one
 * failed until the process restarted and rebuilt them from the registry.
 */
import { getColumns, type Table } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

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
  getEntry(params: {
    collectionName: string;
    entryId: string;
    overrideAccess?: boolean;
    locale?: string;
  }): Promise<{ success: boolean; data: unknown }>;
}

/** The handler's tables, which this process reads and writes through. */
interface FileManager {
  schemaRegistry: Map<string, Table>;
  loadDynamicSchema(collectionName: string): Promise<Table>;
  loadCompanionSchema(collectionName: string): Promise<{ table: Table } | null>;
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
  fileManager: FileManager;
}

const FIELDS = [
  { name: "heading", type: "text" },
  { name: "subTitle", type: "text" },
];

describeEachDialect("a translated field named with capitals", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    // The Builder's create and save run their migrations in development only.
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

  function handler(): CollectionsHandler {
    return current.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
  }

  async function headingAndSubtitle(
    id: string,
    locale: string
  ): Promise<Record<string, unknown>> {
    const read = await handler().getEntryService().getEntry({
      collectionName: "posts",
      entryId: id,
      overrideAccess: true,
      locale,
    });
    expect(read.success, JSON.stringify(read)).toBe(true);
    const data = read.data as Record<string, unknown>;
    return { heading: data.heading, subtitle: data.subtitle };
  }

  /** Writes English, then Spanish, under the name the field is stored by. */
  async function writeBothLanguages(): Promise<string> {
    const entries = handler().getEntryService();
    const created = await entries.createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { heading: "Hello", subtitle: "In English" }
    );
    expect(created.success, JSON.stringify(created)).toBe(true);
    const id = String((created.data as { id: unknown }).id);
    const spanish = await entries.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { heading: "Hola", subtitle: "En español" }
    );
    expect(spanish.success, JSON.stringify(spanish)).toBe(true);
    return id;
  }

  /** Each of this process's tables for the collection, by column name. */
  function columnNames(table: Table | undefined): string[] {
    return table
      ? Object.values(getColumns(table))
          .map(column => column.name)
          .sort()
      : [];
  }

  it("takes a translation in the process that created the collection", async () => {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: FIELDS,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);

    const id = await writeBothLanguages();

    expect(await headingAndSubtitle(id, "en")).toEqual({
      heading: "Hello",
      subtitle: "In English",
    });
    expect(await headingAndSubtitle(id, "es")).toEqual({
      heading: "Hola",
      subtitle: "En español",
    });
  });

  it("takes a translation in the process that added the field", async () => {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: [FIELDS[0]],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      { fields: FIELDS }
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    const id = await writeBothLanguages();

    expect(await headingAndSubtitle(id, "es")).toEqual({
      heading: "Hola",
      subtitle: "En español",
    });
  });

  it("keeps the tables a restart would build", async () => {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: [FIELDS[0]],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      {
        fields: [
          ...FIELDS,
          { name: "metaTitle", type: "text", localized: false },
        ],
      }
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    // What the create and the save left in this process, against what a process starting now
    // builds from the registry.
    const files = handler().fileManager;
    const kept = {
      main: columnNames(files.schemaRegistry.get("dc_posts")),
      companion: columnNames(files.schemaRegistry.get("dc_posts_locales")),
    };
    files.schemaRegistry.delete("dc_posts");
    files.schemaRegistry.delete("dc_posts_locales");
    const rebuilt = {
      main: columnNames(await files.loadDynamicSchema("posts")),
      companion: columnNames((await files.loadCompanionSchema("posts"))?.table),
    };

    expect(rebuilt.companion).toContain("subtitle");
    expect(rebuilt.main).toContain("metatitle");
    expect(kept).toEqual(rebuilt);
  });
});
