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
    // Raw SQL escape hatch used by the localized-write paths (companion table
    // existence probe and per-locale `_status` reads). Empty by default; a
    // localized test overrides it.
    executeQuery: vi.fn().mockResolvedValue([]),
    // The write paths run inside `adapter.transaction`. The tx exposes the
    // handle the update path reads prior state through: `lockRow` (a no-op
    // here), `getDrizzle` (returns the same mock db, so the locked pre-update
    // row resolves to `selectData.rows`), and `execute` for the raw
    // UPDATE/companion statements.
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          getDrizzle: () => db,
          lockRow: vi.fn().mockResolvedValue(undefined),
          execute: vi.fn().mockResolvedValue([]),
          selectOne: vi.fn().mockResolvedValue(null),
          // A created row, not `{}`. The write path derives this entry's cache
          // tags from the id it just wrote, and `requireSegment` REFUSES a
          // blank segment on purpose -- a bare `nextly:` tag would
          // over-invalidate and a blank id would silently never match. So an
          // idless insert does not produce a slightly-wrong tag, it throws,
          // and the write is reported as a 500 from a cache concern the test
          // was not exercising. The top-level `insert` above already returns a
          // row; this one is the same write seen from inside the transaction
          // and has to agree with it.
          insert: vi.fn().mockResolvedValue({
            id: "new-entry-id",
            title: "Test",
            created_at: new Date(),
            updated_at: new Date(),
          }),
          update: vi.fn().mockResolvedValue([
            {
              id: "updated-entry-id",
              title: "Updated",
              created_at: new Date(),
              updated_at: new Date(),
            },
          ]),
          delete: vi.fn().mockResolvedValue(undefined),
        })
      ),
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
    // Non-localized by default: the write paths ask for a companion schema
    // before splitting localized values, and `null` means "no companion".
    loadCompanionSchema: vi.fn().mockResolvedValue(null),
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
    // The read paths call this once the document is assembled. A double that
    // omits it certifies a path that throws for real.
    applyNestedFieldHooks: vi.fn().mockResolvedValue(undefined),
    // Paired with it: the list path finishes the rows it collected once the
    // whole listing has been walked, so a double carrying only the first half
    // certifies a path that throws for real.
    finalizeRelatedRows: vi.fn().mockResolvedValue(undefined),
    // The authoritative re-sanitization the read paths run over the assembled
    // response after every source hook. Both list and detail paths now call it on
    // every successful read, so a double without it certifies a path that throws.
    reprojectRelatedRows: vi.fn().mockResolvedValue(undefined),
    createNestedHookState: vi.fn().mockImplementation(() => ({
      visited: new Set(),
      fields: new Map(),
      labelFields: new Map(),
      redactions: new WeakMap(),
      pending: [],
      sanitized: new Map(),
    })),
    insertManyToManyRelations: vi.fn().mockResolvedValue(undefined),
    deleteManyToManyRelations: vi.fn().mockResolvedValue(undefined),
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
    // The collection write saves component rows inside its own transaction,
    // handing this the presence map resolved beforehand. Absent from the double,
    // the write threw partway and the failure read as a denied or errored save.
    saveComponentDataInTransaction: vi.fn().mockResolvedValue(undefined),
    // Asked before the caller opens its transaction, and its result is handed
    // to `saveComponentDataInTransaction`. An empty map is what production
    // returns when no localization is configured, which is the shape these
    // suites exercise. Built per call so one test cannot mutate another's.
    assertLocalizedFieldGroupsWritable: vi
      .fn()
      .mockImplementation(async () => new Map<string, boolean>()),
    deleteComponentData: vi.fn().mockResolvedValue(undefined),
    // The mirror of `saveComponentDataInTransaction` above, and missing for the
    // same reason: the collection DELETE removes its field-group rows inside
    // the same transaction that removes the entry, so it calls the in-tx
    // variant and never the standalone one. Absent from the double, the delete
    // threw partway through and surfaced as a 500 -- which reads as an access
    // or persistence failure rather than as a gap in the double.
    deleteComponentDataInTransaction: vi.fn().mockResolvedValue(undefined),
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
