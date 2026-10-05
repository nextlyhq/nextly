/**
 * A code-first collection's `db` options reach the id a create writes.
 *
 * The options live only in the code config. Each lifecycle publishes them from
 * its config at its own end — boot in `registerServices`, a reload when it
 * commits — and a create reads what was published for its slug. Two halves,
 * tested separately so a failure names the half that broke:
 *
 * - the registry sync does not publish them itself (the lifecycles' own
 *   publishing is tested in `di/__tests__/collection-db-options-lifecycle` and
 *   `init/__tests__/reload-config`);
 * - a create follows the published options: a v7 id is generated, a client's
 *   valid v7 id is kept, a v4 one is refused, and a collection with no options
 *   (every Builder collection) keeps the v4 default and ignores a client id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import {
  collectionDbOptions,
  publishCollectionDbOptions,
} from "../services/collection-id";
import { CollectionRegistryService } from "../services/collection-registry-service";
import { toCodeFirstCollectionConfig } from "../services/collection-sync-service";

import {
  createMockAdapter,
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

const V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENT_V7 = "018f1f77-bcf8-7c3e-9a1b-2c4d5e6f7a8b";
const CLIENT_V4 = "3b241101-e2bb-4255-8caf-4136c566a962";

afterEach(() => {
  // The published set is process-wide, so each test starts from none.
  publishCollectionDbOptions([]);
});

/** A registry whose row writes all fail: only the publication is observed. */
function registryWithoutStorage(): CollectionRegistryService {
  const refuse = vi.fn(async () => {
    throw new Error("no storage in this test");
  });
  const adapter = {
    dialect: "postgresql",
    getCapabilities: vi.fn(() => ({ dialect: "postgresql" })),
    selectOne: refuse,
    select: refuse,
    insert: refuse,
    update: refuse,
    delete: refuse,
    executeQuery: refuse,
  };
  return new CollectionRegistryService(adapter as never, silentLogger as never);
}

describe("the registry sync", () => {
  it("does not change the published options by itself", async () => {
    // Publishing belongs to the end of a lifecycle — boot, or a reload that
    // lands — not to the sync, which runs mid-reload before the reload knows
    // whether it will land.
    publishCollectionDbOptions([
      { slug: "events", db: { allowIdOnCreate: true } },
    ]);

    await registryWithoutStorage().syncCodeFirstCollections([
      toCodeFirstCollectionConfig({
        slug: "events",
        fields: [],
        db: { idType: "uuidv7" },
      }),
      toCodeFirstCollectionConfig({
        slug: "notes",
        fields: [],
        db: { allowIdOnCreate: true },
      }),
    ]);

    expect(collectionDbOptions("events")).toEqual({ allowIdOnCreate: true });
    expect(collectionDbOptions("notes")).toEqual({});
  });
});

describe("a create", () => {
  let service: CollectionEntryService;
  let txInsert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockDb = createMockDb({ rows: [] });
    const mockAdapter = createMockAdapter(mockDb);
    txInsert = vi.fn(async (_table: string, row: Record<string, unknown>) => ({
      ...row,
      created_at: new Date(),
      updated_at: new Date(),
    }));
    mockAdapter.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          getDrizzle: () => mockDb,
          lockRow: vi.fn().mockResolvedValue(undefined),
          execute: vi.fn().mockResolvedValue([]),
          selectOne: vi.fn().mockResolvedValue(null),
          insert: txInsert,
          update: vi.fn().mockResolvedValue([]),
          delete: vi.fn().mockResolvedValue(undefined),
        })
    );
    service = new CollectionEntryService(
      mockAdapter as never,
      silentLogger as never,
      createMockFileManager(createMockSchema()) as never,
      // The registry row carries no `db`: the published options are the
      // only place a create can learn them from.
      createMockCollectionService() as never,
      createMockRelationshipService() as never,
      createMockHookRegistry() as never,
      createMockComponentDataService() as never,
      createMockRbacAccessControlService() as never
    );
  });

  /** The id of the row written to the collection's own table. */
  function writtenId(): unknown {
    const call = txInsert.mock.calls.find(([table]) => table === "dc_posts");
    expect(call).toBeDefined();
    return (call![1] as Record<string, unknown>).id;
  }

  it("generates a v7 id for a collection that chose uuidv7", async () => {
    publishCollectionDbOptions([{ slug: "posts", db: { idType: "uuidv7" } }]);

    const result = await service.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "A" }
    );

    expect(result.success).toBe(true);
    expect(writtenId()).toMatch(V7);
  });

  it("keeps a client's valid v7 id when the collection allows one", async () => {
    publishCollectionDbOptions([
      { slug: "posts", db: { idType: "uuidv7", allowIdOnCreate: true } },
    ]);

    const result = await service.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { id: CLIENT_V7, title: "A" }
    );

    expect(result.success).toBe(true);
    expect(writtenId()).toBe(CLIENT_V7);
  });

  it("refuses a client's v4 id on a uuidv7 collection", async () => {
    publishCollectionDbOptions([
      { slug: "posts", db: { idType: "uuidv7", allowIdOnCreate: true } },
    ]);

    const result = await service.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { id: CLIENT_V4, title: "A" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(txInsert.mock.calls.some(([t]) => t === "dc_posts")).toBe(false);
  });

  it("keeps the defaults for a collection with no options, as a Builder collection has", async () => {
    publishCollectionDbOptions([
      { slug: "events", db: { idType: "uuidv7", allowIdOnCreate: true } },
    ]);

    const result = await service.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { id: CLIENT_V7, title: "A" }
    );

    expect(result.success).toBe(true);
    const id = writtenId();
    expect(id).not.toBe(CLIENT_V7);
    expect(id).toMatch(V4);
  });
});
