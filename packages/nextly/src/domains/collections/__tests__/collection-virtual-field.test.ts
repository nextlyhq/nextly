/**
 * A virtual field stores nothing, so a collection write that carries one —
 * a client setting it, or a document computed on read and sent back — must
 * succeed and must not name it in the row handed to the adapter.
 *
 * The runtime table has no column for a virtual field. A payload that still
 * names it reaches the adapter's statement as a column the table lacks, and
 * the whole write fails. The fixture's own field (`title`) is the control: it
 * must reach the row, so the virtual field's absence is the rule rather than
 * an empty payload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionEntryService } from "../../../services/collections/collection-entry-service";

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

const FIELDS = [
  { name: "title", type: "text" },
  // The root spelling every field type accepts.
  { name: "fullName", type: "text", virtual: true },
  // The spelling group has always documented.
  { name: "summary", type: "group", fields: [], options: { virtual: true } },
];

/**
 * The row written to the collection's own table. The transaction also writes
 * elsewhere (the mutation event outbox), so the call is picked by table.
 */
function rowWrittenTo(
  spy: ReturnType<typeof vi.fn>,
  table: string
): Record<string, unknown> {
  const call = spy.mock.calls.find(([name]) => name === table);
  expect(call).toBeDefined();
  return call![1] as Record<string, unknown>;
}

/** Neither spelling of either virtual field. */
function expectNoVirtualKeys(payload: Record<string, unknown>): void {
  for (const key of ["fullName", "full_name", "summary"]) {
    expect(payload).not.toHaveProperty(key);
  }
}

describe("a virtual field in a collection write", () => {
  let service: CollectionEntryService;
  let selectData: { rows: unknown[] };
  let txInsert: ReturnType<typeof vi.fn>;
  let txUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    selectData = { rows: [] };
    const mockDb = createMockDb(selectData);
    const mockAdapter = createMockAdapter(mockDb);
    txInsert = vi.fn().mockResolvedValue({
      id: "new-entry-id",
      title: "Ada",
      created_at: new Date(),
      updated_at: new Date(),
    });
    txUpdate = vi.fn().mockResolvedValue([
      {
        id: "entry-1",
        title: "Ada",
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

    service = new CollectionEntryService(
      mockAdapter as never,
      silentLogger as never,
      createMockFileManager(createMockSchema()) as never,
      createMockCollectionService(
        createMockCollection({
          schemaDefinition: { fields: FIELDS, hooks: [] },
          fields: FIELDS,
        })
      ) as never,
      createMockRelationshipService() as never,
      createMockHookRegistry() as never,
      createMockComponentDataService() as never,
      createMockRbacAccessControlService() as never
    );
  });

  it("creates the entry without naming the virtual fields in the row", async () => {
    const result = await service.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "Ada", fullName: "Ada Lovelace", summary: { note: "x" } }
    );

    expect(result.success).toBe(true);
    const row = rowWrittenTo(txInsert, "dc_posts");
    expect(row.title).toBe("Ada");
    expectNoVirtualKeys(row);
  });

  it("updates the entry without naming the virtual fields in the row", async () => {
    selectData.rows = [{ id: "entry-1", title: "Old" }];

    const result = await service.updateEntry(
      { collectionName: "posts", entryId: "entry-1", overrideAccess: true },
      { title: "Ada", fullName: "Ada Lovelace", summary: { note: "x" } }
    );

    expect(result.success).toBe(true);
    const row = rowWrittenTo(txUpdate, "dc_posts");
    expect(row.title).toBe("Ada");
    expectNoVirtualKeys(row);
  });

  it("still writes a system column that a virtual field shares a name with", async () => {
    // A column-less field claims no column, so the generator keeps injecting
    // the system `title` column beside a virtual `title` field, and the key
    // addresses that column. Dropping it with the virtual fields would leave
    // the system column unwritten on every create.
    const fields = [{ name: "title", type: "text", virtual: true }];
    const collectionService = createMockCollectionService(
      createMockCollection({
        schemaDefinition: { fields, hooks: [] },
        fields,
      })
    );
    const mockDb = createMockDb(selectData);
    const mockAdapter = createMockAdapter(mockDb);
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
    const withVirtualTitle = new CollectionEntryService(
      mockAdapter as never,
      silentLogger as never,
      createMockFileManager(createMockSchema()) as never,
      collectionService as never,
      createMockRelationshipService() as never,
      createMockHookRegistry() as never,
      createMockComponentDataService() as never,
      createMockRbacAccessControlService() as never
    );

    const result = await withVirtualTitle.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "Ada" }
    );

    expect(result.success).toBe(true);
    expect(rowWrittenTo(txInsert, "dc_posts").title).toBe("Ada");
  });
});
