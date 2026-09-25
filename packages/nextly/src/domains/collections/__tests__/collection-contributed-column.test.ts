/**
 * A column a schema hook contributed to a collection whose table is named by
 * `dbName` is invisible to the collection entry API in both directions.
 *
 * Contributed hidden columns are recorded under the PHYSICAL table name. For a
 * collection configured with `dbName` that name is not `dc_<slug>`, so every
 * boundary that rebuilt the name from the slug looked the columns up under a
 * table that has none, matched nothing, and let the column through. The
 * fixture therefore gives the collection a physical table ("dc_articles")
 * different from the one its slug would produce ("dc_posts"), and registers the
 * contributed column on the physical table only: an implementation that
 * derives the name from the slug fails every test here, one that uses the
 * resolved name passes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import {
  clearActiveExtensionSchema,
  setActiveExtensionSchema,
} from "../../schema/extension/active-schema";
import { buildExtensionSchema } from "../../schema/extension/build-extension-schema";
import { col } from "../../schema/extension/dsl";

import {
  createMockAdapter,
  createMockCollection,
  createMockCollectionService,
  createMockComponentDataService,
  createMockDb,
  createMockFileManager,
  createMockHookRegistry,
  createMockRbacAccessControlService,
  createMockRelationshipService,
  createMockSchema,
  silentLogger,
} from "./collection-test-helpers";

vi.mock("../../../di/container", () => ({
  container: {
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("../../../database/index", () => ({
  getDialectTables: vi.fn(() => ({})),
}));

vi.mock("../../../collections/fields/guards", () => ({
  isFieldGroupField: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../hooks/stored-hook-executor", () => {
  class MockStoredHookExecutor {
    execute = vi.fn().mockResolvedValue({ data: undefined, errors: [] });
  }
  return { StoredHookExecutor: MockStoredHookExecutor };
});

/** The table the collection's rows actually live in, from its `dbName`. */
const PHYSICAL_TABLE = "dc_articles";
/** What the slug alone would produce; deliberately NOT the physical table. */
const SLUG = "posts";

async function activateContributedColumn(): Promise<void> {
  const schema = await buildExtensionSchema({
    dialect: "postgresql",
    coreTableNames: ["users", "media"],
    entities: [
      {
        name: PHYSICAL_TABLE,
        slug: SLUG,
        entityKind: "collection",
        columns: [
          { name: "id", kind: "varchar", nullable: false },
          { name: "title", kind: "text", nullable: true },
        ],
      },
    ],
    pluginPrefixes: new Map(),
    plugins: [],
    app: {
      owner: { kind: "app" },
      extend: [
        ({ schema: draft }) => {
          draft.extendTable(PHYSICAL_TABLE, {
            columns: { searchVector: col.text({ nullable: true }) },
          });
        },
      ],
    },
  });
  setActiveExtensionSchema("postgresql", schema);
}

/**
 * Neither spelling of the contributed column. A row reaches the response
 * boundary snake_cased from a read and camelCased from a write (the create
 * path camelCases the returned row), so asserting one spelling alone passes
 * trivially on the path that produces the other.
 */
function expectNoContributedColumn(doc: Record<string, unknown>): void {
  expect(doc).not.toHaveProperty("search_vector");
  expect(doc).not.toHaveProperty("searchVector");
}

/** A stored row as `select()` returns it: the contributed column included. */
function storedRow(): Record<string, unknown> {
  return { id: "entry-1", title: "Stored", search_vector: "stored text" };
}

describe("a column contributed to a collection whose table is named by dbName", () => {
  let service: CollectionEntryService;
  let selectData: { rows: unknown[] };
  let mockHookRegistry: ReturnType<typeof createMockHookRegistry>;
  let mockComponentDataService: ReturnType<
    typeof createMockComponentDataService
  >;
  let txInsert: ReturnType<typeof vi.fn>;
  let txUpdate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await activateContributedColumn();

    selectData = { rows: [] };
    const mockDb = createMockDb(selectData);
    const mockAdapter = createMockAdapter(mockDb);
    // The write returns the row the database holds after it, which carries
    // the contributed column exactly as a read does.
    txInsert = vi.fn().mockResolvedValue({
      id: "new-entry-id",
      title: "Created",
      search_vector: "created text",
      created_at: new Date(),
      updated_at: new Date(),
    });
    txUpdate = vi.fn().mockResolvedValue([
      {
        id: "entry-1",
        title: "Updated",
        search_vector: "updated text",
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    mockAdapter.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          getDrizzle: () => mockDb,
          lockRow: vi.fn().mockResolvedValue(undefined),
          execute: vi.fn().mockResolvedValue([]),
          selectOne: vi.fn().mockResolvedValue(null),
          insert: txInsert,
          update: txUpdate,
          delete: vi.fn().mockResolvedValue(undefined),
        })
    );
    mockHookRegistry = createMockHookRegistry();
    mockComponentDataService = createMockComponentDataService();

    service = new CollectionEntryService(
      mockAdapter as never,
      silentLogger as never,
      createMockFileManager(createMockSchema()) as never,
      // The registry record carries the resolved physical table, as the
      // code-first sync writes it for a collection with `dbName`.
      createMockCollectionService(
        createMockCollection({ slug: SLUG, tableName: PHYSICAL_TABLE })
      ) as never,
      createMockRelationshipService() as never,
      mockHookRegistry as never,
      mockComponentDataService as never,
      createMockRbacAccessControlService() as never
    );
  });

  afterEach(() => {
    clearActiveExtensionSchema();
  });

  describe("on a read", () => {
    it("is absent from a listed row, while the collection's own field remains", async () => {
      selectData.rows = [storedRow()];

      const result = await service.listEntries({ collectionName: SLUG });

      const [doc] = result.data!.docs as Record<string, unknown>[];
      expect(doc.title).toBe("Stored");
      expectNoContributedColumn(doc);
    });

    it("is absent from a document read by id, while the collection's own field remains", async () => {
      selectData.rows = [storedRow()];

      const result = await service.getEntry({
        collectionName: SLUG,
        entryId: "entry-1",
      });

      const doc = result.data as Record<string, unknown>;
      expect(doc.title).toBe("Stored");
      expectNoContributedColumn(doc);
    });

    it("is never handed to an afterRead hook", async () => {
      selectData.rows = [storedRow()];
      const seen: Record<string, unknown>[] = [];
      mockHookRegistry.execute.mockImplementation(
        (phase: string, ctx: { data: unknown }) => {
          if (phase === "afterRead") {
            seen.push(...(ctx.data as Record<string, unknown>[]));
          }
          return Promise.resolve(undefined);
        }
      );

      await service.listEntries({ collectionName: SLUG });

      // The hook ran on the row, so its absence is the strip, not a skipped
      // phase.
      expect(seen).toHaveLength(1);
      expect(seen[0].title).toBe("Stored");
      expectNoContributedColumn(seen[0]);
    });
  });

  // Not a contributed column, but the same lookup: a component row records its
  // parent under the physical table the write resolved (`_parent_table`), so a
  // read that names the slug-derived table finds none of a `dbName`
  // collection's component data.
  describe("its component rows", () => {
    it("are read under the physical parent table for a listing", async () => {
      selectData.rows = [storedRow()];

      await service.listEntries({ collectionName: SLUG });

      expect(
        mockComponentDataService.populateComponentDataMany
      ).toHaveBeenCalledWith(
        expect.objectContaining({ parentTable: PHYSICAL_TABLE })
      );
    });

    it("are read under the physical parent table for a document read by id", async () => {
      selectData.rows = [storedRow()];

      await service.getEntry({ collectionName: SLUG, entryId: "entry-1" });

      expect(
        mockComponentDataService.populateComponentData
      ).toHaveBeenCalledWith(
        expect.objectContaining({ parentTable: PHYSICAL_TABLE })
      );
    });
  });

  describe("on a write", () => {
    it("is absent from a create response, and not written by the create", async () => {
      const result = await service.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "Created", searchVector: "a", search_vector: "b" }
      );

      expect(result.success).toBe(true);
      const doc = result.data as Record<string, unknown>;
      expect(doc.title).toBe("Created");
      expectNoContributedColumn(doc);

      const [tableName, payload] = txInsert.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(tableName).toBe(PHYSICAL_TABLE);
      expect(payload.title).toBe("Created");
      expectNoContributedColumn(payload);
    });

    it("is absent from an update response, and not written by the update", async () => {
      selectData.rows = [storedRow()];

      const result = await service.updateEntry(
        { collectionName: SLUG, entryId: "entry-1", overrideAccess: true },
        { title: "Updated", searchVector: "a", search_vector: "b" }
      );

      expect(result.success).toBe(true);
      // The response is the row read back after the write, which carries the
      // contributed column as every stored row does.
      const doc = result.data as Record<string, unknown>;
      expect(doc.id).toBe("entry-1");
      expectNoContributedColumn(doc);

      const [tableName, payload] = txUpdate.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(tableName).toBe(PHYSICAL_TABLE);
      expect(payload.title).toBe("Updated");
      expectNoContributedColumn(payload);
    });
  });
});
