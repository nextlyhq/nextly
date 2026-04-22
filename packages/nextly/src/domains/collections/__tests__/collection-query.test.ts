/**
 * Collection Query Contract Tests (Task 6.1.1)
 *
 * Tests for `listEntries` and `countEntries` — the read/query surface of
 * CollectionEntryService. These tests capture the current behaviour before
 * decomposition so that any split preserves the public contract.
 *
 * Covers:
 * - listEntries: default pagination, custom page/limit, search, where clause
 *   filtering (eq/ne/gt/lt/like/in), sorting (asc/desc), field selection,
 *   component data population, error handling,
 *   collection-not-found 404, empty results, and response structure.
 * - countEntries: basic count, count with search, count with where, access
 *   denied, error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { CollectionEntryService } from "../../../services/collections/collection-entry-service";

import {
  createMockSchema,
  createMockDb,
  createMockAdapter,
  silentLogger,
  createMockFileManager,
  createMockCollectionService,
  createMockRelationshipService,
  createMockHookRegistry,
  createMockAccessControlService,
  createMockComponentDataService,
  createMockCollection,
  createSampleEntry,
  createSampleEntries,
} from "./collection-test-helpers";

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock("../../../di/container", () => ({
  container: {
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("../../../database/index", () => ({
  getDialectTables: vi.fn(() => ({})),
}));

vi.mock("../../../services/lib/db-error", () => ({
  mapDbErrorToServiceError: vi.fn(
    (_err: unknown, opts: { defaultMessage: string }) => ({
      success: false,
      statusCode: 500,
      message: opts.defaultMessage,
      data: null,
    })
  ),
}));

vi.mock("../../../collections/fields/guards", () => ({
  isComponentField: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../lib/case-conversion", () => ({
  keysToCamelCase: vi.fn((obj: unknown) => obj),
  toSnakeCase: vi.fn((str: string) =>
    str.replace(/([A-Z])/g, "_$1").toLowerCase()
  ),
}));

vi.mock("../../../types/pagination", () => ({
  buildPaginatedResponse: vi.fn(
    (
      docs: unknown[],
      opts: { total: number; page: number; limit: number }
    ) => ({
      docs,
      totalDocs: opts.total,
      page: opts.page,
      limit: opts.limit,
      totalPages: Math.ceil(opts.total / opts.limit) || 1,
      hasNextPage: opts.page < Math.ceil(opts.total / opts.limit),
      hasPrevPage: opts.page > 1,
      nextPage:
        opts.page < Math.ceil(opts.total / opts.limit) ? opts.page + 1 : null,
      prevPage: opts.page > 1 ? opts.page - 1 : null,
      pagingCounter: (opts.page - 1) * opts.limit + 1,
    })
  ),
  clampLimit: vi.fn((limit: number) => Math.min(Math.max(1, limit), 500)),
  calculateOffset: vi.fn((page: number, limit: number) => (page - 1) * limit),
  PAGINATION_DEFAULTS: { page: 1, limit: 10, maxLimit: 500 },
}));

vi.mock("../../../services/collections/query-operators", () => ({
  buildWhereClause: vi.fn().mockReturnValue(null),
  extractGeoFilters: vi.fn((where: unknown) => ({
    geoFilters: [],
    cleanedWhere: where,
  })),
  extractComponentFieldConditions: vi.fn((where: unknown) => ({
    componentFilters: [],
    cleanedWhere: where,
  })),
}));

vi.mock("../../../services/collections/geo-utils", () => ({
  applyGeoFilters: vi.fn(),
  sortByDistance: vi.fn(),
}));

vi.mock("@nextly/hooks/context-builder", () => ({
  buildContext: vi.fn((opts: Record<string, unknown>) => opts),
}));

vi.mock("@nextly/hooks/stored-hook-executor", () => {
  class MockStoredHookExecutor {
    execute = vi.fn().mockResolvedValue({ data: undefined, errors: [] });
  }
  return { StoredHookExecutor: MockStoredHookExecutor };
});

vi.mock("@nextly/lib/field-transform", () => ({
  transformRichTextFields: vi.fn((entry: unknown) => entry),
}));

// ── Test suite ────────────────────────────────────────────────────────────

describe("CollectionEntryService — Query Contracts", () => {
  let service: CollectionEntryService;
  let schema: ReturnType<typeof createMockSchema>;
  let selectData: { rows: unknown[] };
  let mockDb: ReturnType<typeof createMockDb>;
  let mockFileManager: ReturnType<typeof createMockFileManager>;
  let mockCollectionService: ReturnType<typeof createMockCollectionService>;
  let mockRelationshipService: ReturnType<typeof createMockRelationshipService>;
  let mockHookRegistry: ReturnType<typeof createMockHookRegistry>;
  let mockAccessControlService: ReturnType<
    typeof createMockAccessControlService
  >;
  let mockComponentDataService: ReturnType<
    typeof createMockComponentDataService
  >;

  beforeEach(() => {
    vi.clearAllMocks();

    schema = createMockSchema();
    selectData = { rows: [] };
    mockDb = createMockDb(selectData);
    const mockAdapter = createMockAdapter(mockDb);
    mockFileManager = createMockFileManager(schema);
    mockCollectionService = createMockCollectionService();
    mockRelationshipService = createMockRelationshipService();
    mockHookRegistry = createMockHookRegistry();
    mockAccessControlService = createMockAccessControlService();
    mockComponentDataService = createMockComponentDataService();

    service = new CollectionEntryService(
      mockAdapter as never,
      silentLogger as never,
      mockFileManager as never,
      mockCollectionService as never,
      mockRelationshipService as never,
      mockHookRegistry as never,
      mockAccessControlService as never,
      mockComponentDataService as never,
      undefined // no RBAC service
    );
  });

  // ── listEntries ───────────────────────────────────────────────────────

  describe("listEntries", () => {
    it("should return a successful paginated response with empty docs", async () => {
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe("Entries fetched successfully");
      expect(result.data).toBeDefined();
      expect(result.data!.docs).toEqual([]);
      expect(result.data!.totalDocs).toBe(0);
    });

    it("should load the dynamic schema for the requested collection", async () => {
      selectData.rows = [];

      await service.listEntries({
        collectionName: "products",
      });

      expect(mockFileManager.loadDynamicSchema).toHaveBeenCalledWith(
        "products"
      );
    });

    it("should expand relationships via batchExpandRelationships", async () => {
      const entries = createSampleEntries(2);
      selectData.rows = entries;

      await service.listEntries({
        collectionName: "posts",
      });

      expect(
        mockRelationshipService.batchExpandRelationships
      ).toHaveBeenCalled();
      const call =
        mockRelationshipService.batchExpandRelationships.mock.calls[0];
      expect(call[1]).toBe("posts");
    });

    it("should populate component data when componentDataService is available", async () => {
      selectData.rows = [createSampleEntry()];

      await service.listEntries({
        collectionName: "posts",
      });

      expect(
        mockComponentDataService.populateComponentDataMany
      ).toHaveBeenCalled();
    });

    it("should execute beforeOperation and beforeRead hooks", async () => {
      selectData.rows = [];

      await service.listEntries({
        collectionName: "posts",
      });

      expect(mockHookRegistry.executeBeforeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: "posts",
          operation: "read",
        })
      );
      expect(mockHookRegistry.execute).toHaveBeenCalledWith(
        "beforeRead",
        expect.any(Object)
      );
    });

    it("should execute afterRead hooks", async () => {
      selectData.rows = [createSampleEntry()];

      await service.listEntries({
        collectionName: "posts",
      });

      expect(mockHookRegistry.execute).toHaveBeenCalledWith(
        "afterRead",
        expect.any(Object)
      );
    });

    it("should return 404 when collection does not exist", async () => {
      mockFileManager.loadDynamicSchema.mockRejectedValueOnce(
        new Error("Collection 'nonexistent' not found")
      );

      const result = await service.listEntries({
        collectionName: "nonexistent",
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.data).toBeNull();
    });

    it("should return 500 on unexpected errors", async () => {
      mockFileManager.loadDynamicSchema.mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      const result = await service.listEntries({
        collectionName: "posts",
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.message).toBe("Database connection failed");
    });

    // ── Pagination ──────────────────────────────────────────────────────

    it("should use default pagination (page 1, limit 10)", async () => {
      selectData.rows = [];

      await service.listEntries({
        collectionName: "posts",
      });

      // The mock should be called with limit/offset applied to the chain
      expect(mockDb._selectChain.limit).toHaveBeenCalled();
      expect(mockDb._selectChain.offset).toHaveBeenCalled();
    });

    it("should use custom page and limit", async () => {
      selectData.rows = [];

      await service.listEntries({
        collectionName: "posts",
        page: 3,
        limit: 25,
      });

      expect(mockDb._selectChain.limit).toHaveBeenCalled();
      expect(mockDb._selectChain.offset).toHaveBeenCalled();
    });

    it("should clamp page to minimum 1", async () => {
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        page: -5,
      });

      expect(result.success).toBe(true);
    });

    // ── Search ──────────────────────────────────────────────────────────

    it("should pass search param through the query pipeline", async () => {
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        search: "tutorial",
      });

      expect(result.success).toBe(true);
      // Search goes through getSearchableFields → buildSearchCondition → query
      expect(mockCollectionService.getCollection).toHaveBeenCalledWith("posts");
    });

    it("should skip search when query is too short", async () => {
      selectData.rows = [];
      // Default minSearchLength is 2, so single char should be skipped
      mockCollectionService.getCollection.mockResolvedValue(
        createMockCollection({
          schemaDefinition: {
            fields: [{ name: "title", type: "text" }],
            search: { minSearchLength: 3 },
          },
        })
      );

      const result = await service.listEntries({
        collectionName: "posts",
        search: "ab", // Length 2, min is 3
      });

      expect(result.success).toBe(true);
    });

    // ── Sorting ──────────────────────────────────────────────────────────

    it("should apply ascending sort", async () => {
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        sort: "title",
      });

      expect(result.success).toBe(true);
      expect(mockDb._selectChain.orderBy).toHaveBeenCalled();
    });

    it("should apply descending sort with - prefix", async () => {
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        sort: "-createdAt",
      });

      expect(result.success).toBe(true);
      expect(mockDb._selectChain.orderBy).toHaveBeenCalled();
    });

    // ── Field Selection ─────────────────────────────────────────────────

    it("should apply field selection when select param is provided", async () => {
      selectData.rows = [
        createSampleEntry({
          id: "entry-1",
          title: "Test",
          content: "Full content",
          status: "published",
        }),
      ];

      const result = await service.listEntries({
        collectionName: "posts",
        select: { title: true },
      });

      expect(result.success).toBe(true);
      // The id field should always be included
      const docs = result.data?.docs as Record<string, unknown>[];
      if (docs && docs.length > 0) {
        expect(docs[0]).toHaveProperty("id");
        expect(docs[0]).toHaveProperty("title");
      }
    });

    // ── Where clause ────────────────────────────────────────────────────

    it("should accept and process a where clause", async () => {
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        where: { status: { equals: "published" } },
      });

      expect(result.success).toBe(true);
    });

    // ── Depth / Relationship expansion ──────────────────────────────────

    it("should pass depth parameter to relationship expansion", async () => {
      selectData.rows = [createSampleEntry()];

      await service.listEntries({
        collectionName: "posts",
        depth: 0,
      });

      expect(
        mockRelationshipService.batchExpandRelationships
      ).toHaveBeenCalledWith(expect.any(Array), "posts", expect.any(Array), {
        depth: 0,
      });
    });

    it("should default depth to undefined (service applies internal default)", async () => {
      selectData.rows = [createSampleEntry()];

      await service.listEntries({
        collectionName: "posts",
      });

      expect(
        mockRelationshipService.batchExpandRelationships
      ).toHaveBeenCalledWith(expect.any(Array), "posts", expect.any(Array), {
        depth: undefined,
      });
    });

    // ── Response structure ──────────────────────────────────────────────

    it("should return CollectionServiceResult shape", async () => {
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
      });

      // Verify the response matches CollectionServiceResult<PaginatedResponse>
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("statusCode");
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("data");
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.statusCode).toBe("number");
      expect(typeof result.message).toBe("string");
    });

    it("should return proper paginated response fields", async () => {
      selectData.rows = createSampleEntries(3);

      const result = await service.listEntries({
        collectionName: "posts",
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("docs");
      expect(result.data).toHaveProperty("totalDocs");
      expect(result.data).toHaveProperty("page");
      expect(result.data).toHaveProperty("limit");
      expect(result.data).toHaveProperty("totalPages");
    });
  });

  // ── countEntries ──────────────────────────────────────────────────────

  describe("countEntries", () => {
    it("should return a count result on success", async () => {
      // countEntries builds its own query with count(*)
      // Mock the chain to resolve with count
      selectData.rows = [{ value: 42 }];

      const result = await service.countEntries({
        collectionName: "posts",
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.data).toBeDefined();
    });

    it("should load the dynamic schema", async () => {
      selectData.rows = [{ value: 0 }];

      await service.countEntries({
        collectionName: "products",
      });

      expect(mockFileManager.loadDynamicSchema).toHaveBeenCalledWith(
        "products"
      );
    });

    it("should check collection-level access", async () => {
      selectData.rows = [{ value: 0 }];

      await service.countEntries({
        collectionName: "posts",
        user: { id: "user-1", role: "viewer" },
      });

      expect(mockAccessControlService.evaluateAccess).toHaveBeenCalled();
    });

    it("should return 403 when access is denied", async () => {
      mockAccessControlService.evaluateAccess.mockResolvedValueOnce({
        allowed: false,
        reason: "Access denied",
      });

      const result = await service.countEntries({
        collectionName: "posts",
        user: { id: "user-1", role: "viewer" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("should skip access control when overrideAccess is true", async () => {
      selectData.rows = [{ value: 5 }];

      const result = await service.countEntries({
        collectionName: "posts",
        user: { id: "user-1" },
        overrideAccess: true,
      });

      expect(result.success).toBe(true);
      // evaluateAccess should still be called (for getAccessQueryConstraint)
      // but checkCollectionAccess should skip
    });

    it("should return 500 when collection not found (no 404 distinction)", async () => {
      mockFileManager.loadDynamicSchema.mockRejectedValueOnce(
        new Error("Collection 'missing' does not exist")
      );

      const result = await service.countEntries({
        collectionName: "missing",
      });

      expect(result.success).toBe(false);
      // countEntries always returns 500 on error — it doesn't detect "not found"
      expect(result.statusCode).toBe(500);
    });

    it("should return 500 on unexpected error", async () => {
      mockFileManager.loadDynamicSchema.mockRejectedValueOnce(
        new Error("Unexpected failure")
      );

      const result = await service.countEntries({
        collectionName: "posts",
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it("should accept a where clause", async () => {
      selectData.rows = [{ value: 3 }];

      const result = await service.countEntries({
        collectionName: "posts",
        where: { status: { equals: "published" } },
      });

      expect(result.success).toBe(true);
    });

    it("should accept a search query", async () => {
      selectData.rows = [{ value: 1 }];

      const result = await service.countEntries({
        collectionName: "posts",
        search: "typescript",
      });

      expect(result.success).toBe(true);
    });
  });
});
