/**
 * Shared mock factories for CollectionEntryService contract tests.
 *
 * All 5 test suites (query, mutation, bulk, access, hooks) share the same
 * service instantiation and mock dependency patterns. This module centralises
 * those to avoid duplication.
 */

import { vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockRecord = Record<string, any>;

// ── Schema mock ─────────────────────────────────────────────────────────

/**
 * Creates a mock Drizzle schema with columns for a typical dynamic collection.
 * Column values are symbols so they can be used as identity references in
 * the `eq()` / `like()` call assertions.
 */
export function createMockSchema() {
  return {
    id: Symbol("dc.id"),
    title: Symbol("dc.title"),
    slug: Symbol("dc.slug"),
    status: Symbol("dc.status"),
    content: Symbol("dc.content"),
    author: Symbol("dc.author"),
    category: Symbol("dc.category"),
    price: Symbol("dc.price"),
    created_at: Symbol("dc.created_at"),
    updated_at: Symbol("dc.updated_at"),
    createdBy: Symbol("dc.createdBy"),
  };
}

// ── Chainable query builder ──────────────────────────────────────────────

/**
 * Creates a Drizzle-like chainable query builder mock.
 *
 * The `resolveData` callback is invoked when the chain is awaited.
 * Tests control the result by setting the data before the service call.
 */
export function createChainableMock(resolveData: () => unknown[]): MockRecord {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  const methods = [
    "select",
    "from",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
    "offset",
    "set",
    "values",
    "returning",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  // Make the chain awaitable (Drizzle resolves on `await query`)
  chain.then = vi
    .fn()
    .mockImplementation(
      (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(resolveData()).then(resolve, reject)
    );

  return chain;
}

// ── Mock DB ──────────────────────────────────────────────────────────────

export function createMockDb(selectData: { rows: unknown[] }): MockRecord {
  const selectChain = createChainableMock(() => selectData.rows);
  const insertChain = createChainableMock(() => selectData.rows);
  const updateChain = createChainableMock(() => selectData.rows);
  const deleteChain = createChainableMock(() => selectData.rows);

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    delete: vi.fn().mockReturnValue(deleteChain),
    run: vi.fn().mockResolvedValue(undefined),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        // Execute the transaction callback with the db itself as the "tx"
        return fn({
          select: vi.fn().mockReturnValue(selectChain),
          insert: vi.fn().mockReturnValue(insertChain),
          update: vi.fn().mockReturnValue(updateChain),
          delete: vi.fn().mockReturnValue(deleteChain),
        });
      }),
    _selectChain: selectChain,
    _insertChain: insertChain,
    _updateChain: updateChain,
    _deleteChain: deleteChain,
  };
}

// ── Mock Adapter ─────────────────────────────────────────────────────────

export function createMockAdapter(db: MockRecord): MockRecord {
  return {
    getDrizzle: vi.fn().mockReturnValue(db),
    getDb: vi.fn().mockReturnValue(db),
    getTables: vi.fn().mockReturnValue({}),
    getCapabilities: vi.fn().mockReturnValue({
      dialect: "postgresql",
      supportsIlike: true,
      supportsReturning: true,
      supportsJsonb: true,
      supportsJson: true,
      supportsArrays: true,
      supportsSavepoints: true,
      supportsOnConflict: true,
      supportsFts: true,
    }),
    dialect: "postgresql",
    insert: vi.fn().mockResolvedValue({
      id: "new-entry-id",
      title: "Test",
      created_at: new Date(),
      updated_at: new Date(),
    }),
    update: vi.fn().mockResolvedValue({
      id: "updated-entry-id",
      title: "Updated",
      created_at: new Date(),
      updated_at: new Date(),
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    selectOne: vi.fn().mockResolvedValue(null),
    select: vi.fn().mockResolvedValue([]),
  };
}

// ── Silent Logger ────────────────────────────────────────────────────────

export const silentLogger: MockRecord = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// ── Collection metadata ──────────────────────────────────────────────────

export function createMockCollection(overrides: Record<string, unknown> = {}) {
  return {
    slug: "posts",
    name: "Posts",
    schemaDefinition: {
      fields: [
        { name: "title", type: "text" },
        { name: "slug", type: "text" },
        { name: "status", type: "select", options: ["draft", "published"] },
        { name: "content", type: "richText" },
        { name: "author", type: "relation", relationTo: "users" },
        { name: "category", type: "relation", relationTo: "categories" },
        { name: "price", type: "number" },
      ],
      accessRules: undefined,
      hooks: [],
      search: undefined,
    },
    fields: [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "status", type: "select", options: ["draft", "published"] },
      { name: "content", type: "richText" },
      { name: "author", type: "relation", relationTo: "users" },
      { name: "category", type: "relation", relationTo: "categories" },
      { name: "price", type: "number" },
    ],
    ...overrides,
  };
}

// ── Mock Dependencies ────────────────────────────────────────────────────

export function createMockFileManager(
  schema: ReturnType<typeof createMockSchema>
): MockRecord {
  return {
    loadDynamicSchema: vi.fn().mockResolvedValue(schema),
  };
}

export function createMockCollectionService(
  collection: ReturnType<typeof createMockCollection> = createMockCollection()
): MockRecord {
  return {
    getCollection: vi.fn().mockResolvedValue(collection),
    generateId: vi.fn().mockReturnValue("generated-id-1"),
  };
}

export function createMockRelationshipService(): MockRecord {
  return {
    batchExpandRelationships: vi
      .fn()
      .mockImplementation((entries: unknown[]) => Promise.resolve(entries)),
    expandRelationships: vi
      .fn()
      .mockImplementation((entry: unknown) => Promise.resolve(entry)),
    insertManyToManyRelations: vi.fn().mockResolvedValue(undefined),
    deleteManyToManyRelations: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockFieldPermissionChecker(): MockRecord {
  return {
    filterFieldsBulk: vi
      .fn()
      .mockImplementation(
        (_userId: string, _collection: string, entries: unknown[]) =>
          Promise.resolve(entries)
      ),
    filterFields: vi
      .fn()
      .mockImplementation(
        (_userId: string, _collection: string, entry: unknown) =>
          Promise.resolve(entry)
      ),
    canAccessField: vi.fn().mockResolvedValue(true),
  };
}

export function createMockHookRegistry(): MockRecord {
  return {
    executeBeforeOperation: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(undefined),
    executeAfterOperation: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockAccessControlService(): MockRecord {
  return {
    evaluateAccess: vi.fn().mockResolvedValue({ allowed: true }),
  };
}

export function createMockComponentDataService(): MockRecord {
  return {
    populateComponentDataMany: vi
      .fn()
      .mockImplementation((params: { entries: unknown[] }) =>
        Promise.resolve(params.entries)
      ),
    populateComponentData: vi
      .fn()
      .mockImplementation((params: { entry: unknown }) =>
        Promise.resolve(params.entry)
      ),
    saveComponentData: vi.fn().mockResolvedValue(undefined),
    deleteComponentData: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Sample Entries ───────────────────────────────────────────────────────

export function createSampleEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    title: "Test Post",
    slug: "test-post",
    status: "published",
    content: '{"root":{"children":[]}}',
    author: "user-1",
    category: "cat-1",
    price: 100,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function createSampleEntries(count: number) {
  return Array.from({ length: count }, (_, i) =>
    createSampleEntry({
      id: `entry-${i + 1}`,
      title: `Post ${i + 1}`,
      slug: `post-${i + 1}`,
    })
  );
}
