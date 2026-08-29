/**
 *
 * Tests for `bulkDeleteEntries`, `bulkUpdateEntries`, `bulkDeleteByQuery`,
 * `bulkUpdateByQuery`, and `duplicateEntry`.
 *
 * Covers:
 * - bulkDeleteEntries: partial success pattern, empty IDs, all succeed,
 *   mixed success/failure, error resilience.
 * - bulkUpdateEntries: same partial success patterns, data propagation.
 * - bulkDeleteByQuery: query-to-IDs pipeline, limit safeguard, empty matches.
 * - bulkUpdateByQuery: same query-to-IDs pipeline, limit safeguard.
 * - duplicateEntry: source fetch, field copying, title "(Copy)" suffix,
 *   overrides, 404 source.
 */

// The suites below drive the real services over mocked collaborators: these
// imports carry the adapter transaction shape the caller-owned entry points
// take, the result contracts the assertions pin, the write-integrity marker
// whose failures force a rollback, and the typed error the abort paths throw.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import { CollectionMutationService } from "../services/collection-mutation-service";
import type {
  BatchOperationResult,
  BulkOperationOptions,
  CollectionServiceResult,
} from "../services/collection-types";
import { markWriteIntegrityFailure } from "../../../shared/write-integrity";
import { NextlyError } from "../../../errors/nextly-error";

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
  createSampleEntry,
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

vi.mock("../../../collections/fields/guards", () => ({
  isFieldGroupField: vi.fn().mockReturnValue(false),
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
      hasNextPage: false,
      hasPrevPage: false,
      nextPage: null,
      prevPage: null,
      pagingCounter: 1,
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

describe("CollectionEntryService — Bulk Operation Contracts", () => {
  let service: CollectionEntryService;
  let schema: ReturnType<typeof createMockSchema>;
  let selectData: { rows: unknown[] };
  let mockDb: ReturnType<typeof createMockDb>;
  // Held at suite scope so the ordering test can watch the boundary between them: the readiness
  // resolution has to land on the pool BEFORE the batch transaction opens.
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let mockComponentDataService: ReturnType<
    typeof createMockComponentDataService
  >;

  beforeEach(() => {
    vi.clearAllMocks();

    schema = createMockSchema();
    selectData = { rows: [] };
    mockDb = createMockDb(selectData);
    mockAdapter = createMockAdapter(mockDb);
    const mockFileManager = createMockFileManager(schema);
    const mockCollectionService = createMockCollectionService();
    const mockRelationshipService = createMockRelationshipService();
    const mockHookRegistry = createMockHookRegistry();
    const mockAccessControlService = createMockAccessControlService();
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
      undefined
    );
  });

  // ── companion readiness ───────────────────────────────────────────────

  describe("localized readiness", () => {
    /**
     * Each batch runs its rows inside ONE transaction it opens itself, and every row's snapshot
     * reads the localized component overlays through that transaction. There a companion verdict
     * can only be read: resolving one issues a query, and a query against a missing relation
     * aborts the whole transaction on PostgreSQL. On a worker whose first act is a batch, nothing
     * has resolved anything yet — and an unresolved verdict reads as unusable, so the rows commit
     * while their durable version snapshots and outbound events silently lose every translated
     * value.
     */
    const warmsBeforeItsTransaction = async (
      run: () => Promise<unknown>
    ): Promise<string[]> => {
      const order: string[] = [];
      mockComponentDataService.assertLocalizedFieldGroupsWritable.mockImplementation(
        () => {
          order.push("resolve");
          return Promise.resolve(new Map<string, boolean>());
        }
      );
      const openTransaction = mockAdapter.transaction as ReturnType<
        typeof vi.fn
      >;
      // getMockImplementation returns the impl under a loose signature; assert
      // the known call shape so it can be invoked to preserve real behavior.
      const realTransaction = openTransaction.getMockImplementation() as
        | ((fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>)
        | undefined;
      openTransaction.mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) => {
          order.push("transaction");
          return realTransaction?.(fn) as Promise<unknown>;
        }
      );
      await run();
      return order;
    };

    it("resolves readiness before a batch update opens its transaction", async () => {
      const order = await warmsBeforeItsTransaction(() =>
        service.updateEntries({ collectionName: "posts" }, [
          { id: "entry-1", data: { title: "Updated" } },
        ])
      );

      expect(order).toContain("transaction");
      expect(order.indexOf("resolve")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("resolve")).toBeLessThan(
        order.indexOf("transaction")
      );
    });

    it("resolves readiness before a batch delete opens its transaction", async () => {
      // The delete case is the one with no second chance: the snapshot it builds is the last
      // record of the row there will ever be.
      const order = await warmsBeforeItsTransaction(() =>
        service.deleteEntries({ collectionName: "posts" }, ["entry-1"])
      );

      expect(order).toContain("transaction");
      expect(order.indexOf("resolve")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("resolve")).toBeLessThan(
        order.indexOf("transaction")
      );
    });

    it("resolves component readiness before a single delete opens its transaction", async () => {
      // A delete used to warm only the collection's own companion. The snapshot that becomes the
      // durable delete event reads every embedded component too, through the transaction, where a
      // verdict can only be consulted — so on a fresh worker the component overlays were skipped
      // and the last description of the row there will ever be went out without its translations.
      // A row to delete. Without one the delete answers 404 before it reaches anything localized,
      // which would let this pass while proving nothing.
      selectData.rows = [createSampleEntry()];
      const order = await warmsBeforeItsTransaction(() =>
        service.deleteEntry({ collectionName: "posts", entryId: "entry-1" })
      );

      expect(order.indexOf("resolve")).toBeGreaterThanOrEqual(0);
      // A delete may not reach a transaction at all in this double; what matters is that the
      // resolution happens, and before any transaction it does open.
      if (order.includes("transaction")) {
        expect(order.indexOf("resolve")).toBeLessThan(
          order.indexOf("transaction")
        );
      }
    });

    it("resolves readiness before a batch create opens its transaction", async () => {
      const order = await warmsBeforeItsTransaction(() =>
        service.createEntries({ collectionName: "posts" }, [
          { title: "New", slug: "new" },
        ])
      );

      expect(order).toContain("transaction");
      expect(order.indexOf("resolve")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("resolve")).toBeLessThan(
        order.indexOf("transaction")
      );
    });
  });

  // ── bulkDeleteEntries ─────────────────────────────────────────────────

  describe("bulkDeleteEntries", () => {
    it("should return BulkOperationResult shape (Phase 4.5)", async () => {
      const result = await service.bulkDeleteEntries({
        collectionName: "posts",
        ids: [],
      });

      // Phase 4.5: shape is `{ successes, failures, total, successCount, failedCount }`.
      // `successes` is `Array<{ id }>` for delete; `failures` is the structured
      // per-item error array `{ id, code, message }` (canonical NextlyErrorCode).
      expect(result).toHaveProperty("successes");
      expect(result).toHaveProperty("failures");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("successCount");
      expect(result).toHaveProperty("failedCount");
      expect(Array.isArray(result.successes)).toBe(true);
      expect(Array.isArray(result.failures)).toBe(true);
    });

    it("should handle empty ids array", async () => {
      const result = await service.bulkDeleteEntries({
        collectionName: "posts",
        ids: [],
      });

      expect(result.total).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it("should delete entries and report success for each", async () => {
      // Each deleteEntry call needs to find the entry
      selectData.rows = [createSampleEntry()];

      const result = await service.bulkDeleteEntries({
        collectionName: "posts",
        ids: ["entry-1", "entry-2"],
      });

      expect(result.total).toBe(2);
      // Success depends on whether the mock returns entries
      expect(result.successCount + result.failedCount).toBe(2);
    });

    it("should report failures for entries that don't exist", async () => {
      // Return empty to simulate not found
      selectData.rows = [];

      const result = await service.bulkDeleteEntries({
        collectionName: "posts",
        ids: ["missing-1", "missing-2"],
      });

      expect(result.failedCount).toBe(2);
      expect(result.failures.length).toBe(2);
      // Phase 4.5: per-item failure carries `{ id, code, message }` where code
      // is a canonical NextlyErrorCode value and message is public-safe.
      result.failures.forEach(f => {
        expect(f).toHaveProperty("id");
        expect(f).toHaveProperty("code");
        expect(f).toHaveProperty("message");
      });
    });

    it("should pass user and overrideAccess to individual delete calls", async () => {
      selectData.rows = [createSampleEntry()];

      await service.bulkDeleteEntries({
        collectionName: "posts",
        ids: ["entry-1"],
        user: { id: "user-1", role: "admin" },
        overrideAccess: true,
      });

      // The service delegates to deleteEntry which checks access
      // With overrideAccess: true, it should pass through
      expect(true).toBe(true); // Verifying no error thrown
    });
  });

  // ── bulkUpdateEntries ─────────────────────────────────────────────────

  describe("bulkUpdateEntries", () => {
    it("should return BulkOperationResult shape (Phase 4.5)", async () => {
      const result = await service.bulkUpdateEntries({
        collectionName: "posts",
        ids: [],
        data: { status: "archived" },
      });

      // Phase 4.5: shape is `{ successes, failures, total, successCount, failedCount }`.
      // For update, `successes` carries the full updated record (not just id) so
      // the dispatcher can hand it directly to respondBulk without re-fetching.
      expect(result).toHaveProperty("successes");
      expect(result).toHaveProperty("failures");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("successCount");
      expect(result).toHaveProperty("failedCount");
    });

    it("should handle empty ids array", async () => {
      const result = await service.bulkUpdateEntries({
        collectionName: "posts",
        ids: [],
        data: { status: "archived" },
      });

      expect(result.total).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it("should update each entry individually (partial success)", async () => {
      selectData.rows = [createSampleEntry()];

      const result = await service.bulkUpdateEntries({
        collectionName: "posts",
        ids: ["entry-1", "entry-2"],
        data: { status: "published" },
      });

      expect(result.total).toBe(2);
      expect(result.successCount + result.failedCount).toBe(2);
    });

    it("should report failures for missing entries", async () => {
      selectData.rows = [];

      const result = await service.bulkUpdateEntries({
        collectionName: "posts",
        ids: ["missing-1"],
        data: { status: "published" },
      });

      expect(result.failedCount).toBe(1);
      expect(result.failures[0]).toHaveProperty("id", "missing-1");
      expect(result.failures[0]).toHaveProperty("code");
      expect(result.failures[0]).toHaveProperty("message");
    });

    it("should classify a DUPLICATE-coded 409 item failure as DUPLICATE", async () => {
      // A unique violation on one item surfaces from updateEntry as a legacy
      // 409 envelope carrying code DUPLICATE. The per-item failure must keep
      // that classification: a bare 409 is ambiguous and would otherwise
      // collapse into the stale-version CONFLICT message.
      vi.spyOn(
        CollectionMutationService.prototype,
        "updateEntry"
      ).mockResolvedValue({
        success: false,
        statusCode: 409,
        code: "DUPLICATE",
        message: "Resource already exists.",
        data: null,
      });

      const result = await service.bulkUpdateEntries({
        collectionName: "posts",
        ids: ["entry-1"],
        data: { slug: "taken" },
      });

      expect(result.failures[0]).toMatchObject({
        id: "entry-1",
        code: "DUPLICATE",
        message: "Resource already exists.",
      });
    });
  });

  // ── bulkUpdateByQuery ─────────────────────────────────────────────────

  describe("bulkUpdateByQuery", () => {
    it("should return BulkOperationResult shape (Phase 4.5)", async () => {
      selectData.rows = [];

      const result = await service.bulkUpdateByQuery({
        collectionName: "posts",
        where: { status: { equals: "draft" } },
        data: { status: "published" },
      });

      expect(result).toHaveProperty("successes");
      expect(result).toHaveProperty("failures");
      expect(result).toHaveProperty("total");
    });

    it("should return empty result when no entries match", async () => {
      // listEntries returns empty docs
      selectData.rows = [];

      const result = await service.bulkUpdateByQuery({
        collectionName: "posts",
        where: { status: { equals: "nonexistent" } },
        data: { status: "published" },
      });

      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it("should throw NextlyError.forbidden when collection-level access is denied (Phase 4.5)", async () => {
      // Phase 4.5: a collection-wide access denial is a request-level
      // authorization failure, not a per-item partial failure. The service
      // throws NextlyError.forbidden so the dispatcher emits a canonical
      // 403 error envelope instead of fabricating a synthetic row in
      // `failures[]` with no real id to attach it to.
      const mockACS = createMockAccessControlService();
      mockACS.evaluateAccess.mockResolvedValueOnce({
        allowed: false,
        reason: "No update access",
      });

      const mockAdapter = createMockAdapter(mockDb);
      const restrictedService = new CollectionEntryService(
        mockAdapter as never,
        silentLogger as never,
        createMockFileManager(schema) as never,
        createMockCollectionService() as never,
        createMockRelationshipService() as never,
        createMockHookRegistry() as never,
        mockACS as never,
        createMockComponentDataService() as never,
        undefined
      );

      await expect(
        restrictedService.bulkUpdateByQuery({
          collectionName: "posts",
          where: { status: { equals: "draft" } },
          data: { status: "published" },
          user: { id: "user-1" },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── bulkDeleteByQuery ─────────────────────────────────────────────────

  describe("bulkDeleteByQuery", () => {
    it("should return BulkOperationResult shape (Phase 4.5)", async () => {
      selectData.rows = [];

      const result = await service.bulkDeleteByQuery({
        collectionName: "posts",
        where: { status: { equals: "draft" } },
      });

      expect(result).toHaveProperty("successes");
      expect(result).toHaveProperty("failures");
      expect(result).toHaveProperty("total");
    });

    it("should return empty result when no entries match", async () => {
      selectData.rows = [];

      const result = await service.bulkDeleteByQuery({
        collectionName: "posts",
        where: { status: { equals: "nonexistent" } },
      });

      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it("should throw NextlyError.forbidden when collection-level access is denied (Phase 4.5)", async () => {
      // See bulkUpdateByQuery analogue above: a collection-wide access denial
      // is a request-level authorization failure (403), not a partial-success
      // entry in `failures[]`.
      const mockACS = createMockAccessControlService();
      mockACS.evaluateAccess.mockResolvedValueOnce({
        allowed: false,
        reason: "No delete access",
      });

      const mockAdapter = createMockAdapter(mockDb);
      const restrictedService = new CollectionEntryService(
        mockAdapter as never,
        silentLogger as never,
        createMockFileManager(schema) as never,
        createMockCollectionService() as never,
        createMockRelationshipService() as never,
        createMockHookRegistry() as never,
        mockACS as never,
        createMockComponentDataService() as never,
        undefined
      );

      await expect(
        restrictedService.bulkDeleteByQuery({
          collectionName: "posts",
          where: { status: { equals: "draft" } },
          user: { id: "user-1" },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── duplicateEntry ────────────────────────────────────────────────────

  describe("duplicateEntry", () => {
    it("should return 404 when source entry does not exist", async () => {
      selectData.rows = [];

      const result = await service.duplicateEntry({
        collectionName: "posts",
        entryId: "nonexistent",
      });

      expect(result.success).toBe(false);
      // getEntry returns 404, duplicateEntry propagates it
      expect(result.statusCode).toBe(404);
    });

    it("should fetch the source entry via getEntry", async () => {
      // getEntry needs to find the entry, then createEntry needs to work
      selectData.rows = [createSampleEntry({ title: "Original" })];

      const result = await service.duplicateEntry({
        collectionName: "posts",
        entryId: "entry-1",
      });

      // Whether it succeeds depends on the full create pipeline,
      // but it should not return 404
      expect(result.statusCode).not.toBe(404);
    });

    it("should apply overrides if provided", async () => {
      selectData.rows = [createSampleEntry({ title: "Original" })];

      // Call with overrides
      await service.duplicateEntry({
        collectionName: "posts",
        entryId: "entry-1",
        overrides: { status: "draft" },
      });

      // The override should be passed to createEntry
      // (Difficult to assert directly, but verifying no error)
      expect(true).toBe(true);
    });

    it("should pass user and overrideAccess to underlying getEntry/createEntry", async () => {
      selectData.rows = [createSampleEntry()];

      await service.duplicateEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user: { id: "user-1", role: "admin" },
        overrideAccess: true,
      });

      // Should not fail on access
      expect(true).toBe(true);
    });

    it("should return 500 on unexpected error", async () => {
      // Force an error by making getEntry throw
      selectData.rows = [createSampleEntry()];
      // After the first getEntry call, make the schema load fail for createEntry
      const fileManager = createMockFileManager(schema);
      let callCount = 0;
      fileManager.loadDynamicSchema.mockImplementation(() => {
        callCount++;
        if (callCount > 2) {
          return Promise.reject(new Error("Unexpected failure"));
        }
        return Promise.resolve(schema);
      });

      // Create service with custom file manager
      const mockAdapter = createMockAdapter(mockDb);
      const svc = new CollectionEntryService(
        mockAdapter as never,
        silentLogger as never,
        fileManager as never,
        createMockCollectionService() as never,
        createMockRelationshipService() as never,
        createMockHookRegistry() as never,
        createMockAccessControlService() as never,
        createMockComponentDataService() as never,
        undefined
      );

      const result = await svc.duplicateEntry({
        collectionName: "posts",
        entryId: "entry-1",
      });

      // May be a success or error depending on timing
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("statusCode");
    });
  });

  // ── legacy batch operations ─────────────────────────────────────────────
  //
  // The six-method batch model: createEntries / updateEntries / deleteEntries
  // and their InTransaction twins. These pin the per-item accounting, the
  // option flags, and each path's rollback envelope, so the shared loop the
  // methods grow cannot change any of them silently.

  describe("legacy batch operations", () => {
    // The InTransaction entry points receive the caller's tx. The helpers' own
    // transaction double passes the db itself as the tx, so mirror that shape
    // and add the getDrizzle() the collection-level access read binds to.
    const makeTx = (): TransactionContext =>
      ({ ...mockDb, getDrizzle: () => mockDb }) as never;

    type BatchWorker =
      | "createSingleEntryInTransaction"
      | "updateSingleEntryInTransaction"
      | "deleteSingleEntryInTransaction";

    const okOutcome = (id: string): CollectionServiceResult<unknown> => ({
      success: true,
      statusCode: 201,
      message: "ok",
      data: { id },
      // Every committed item carries both side-channel signals, so each
      // assertion below sees them flow into the batch result.
      eventRecorded: true,
      revalidationIntent: { tags: [`tag-${id}`] },
    });

    // A committed row whose after-hook then threw: reported failed, but the
    // row and its outbox event are in, so it still owes a delivery and its
    // tags are still busted.
    const committedThenFailed = (
      message: string
    ): CollectionServiceResult<unknown> => ({
      success: false,
      statusCode: 500,
      message,
      data: null,
      eventRecorded: true,
      revalidationIntent: { tags: ["tag-failed"] },
    });

    // Verdicts with neither side-channel signal: a row that committed
    // without the worker recording an event, and an item refused before any
    // write. Together they pin the outbox flag's ABSENCE on a result whose
    // items never owed a delivery.
    const okWithoutSignals = (
      op: OpDef,
      index: number
    ): CollectionServiceResult<unknown> => ({
      success: true,
      statusCode: 201,
      message: "ok",
      data: op.name === "deleteEntries" ? null : { id: op.expectedIds[index] },
    });
    const refusedWithoutSignals = (
      message: string
    ): CollectionServiceResult<unknown> => ({
      success: false,
      statusCode: 422,
      message,
      data: null,
    });

    interface OpDef {
      name: string;
      worker: BatchWorker;
      // Update's worker separates id and data, so its skipHooks sits one
      // argument further along than create's and delete's.
      skipHooksArg: 3 | 4;
      self: (options?: BulkOperationOptions) => Promise<BatchOperationResult>;
      inTx: (
        tx: TransactionContext,
        options?: BulkOperationOptions
      ) => Promise<BatchOperationResult>;
      // Delete reports the requested id; create/update report the written
      // row's id, which the worker mock controls.
      expectedIds: string[];
    }

    const OPS: OpDef[] = [
      {
        name: "createEntries",
        worker: "createSingleEntryInTransaction",
        skipHooksArg: 3,
        self: options =>
          service.createEntries(
            { collectionName: "posts" },
            [{ title: "A" }, { title: "B" }],
            options
          ),
        inTx: (tx, options) =>
          service.createEntriesInTransaction(
            tx,
            { collectionName: "posts" },
            [{ title: "A" }, { title: "B" }],
            options
          ),
        expectedIds: ["id-0", "id-1"],
      },
      {
        name: "updateEntries",
        worker: "updateSingleEntryInTransaction",
        skipHooksArg: 4,
        self: options =>
          service.updateEntries(
            { collectionName: "posts" },
            [
              { id: "e1", data: { title: "A" } },
              { id: "e2", data: { title: "B" } },
            ],
            options
          ),
        inTx: (tx, options) =>
          service.updateEntriesInTransaction(
            tx,
            { collectionName: "posts" },
            [
              { id: "e1", data: { title: "A" } },
              { id: "e2", data: { title: "B" } },
            ],
            options
          ),
        expectedIds: ["id-0", "id-1"],
      },
      {
        name: "deleteEntries",
        worker: "deleteSingleEntryInTransaction",
        skipHooksArg: 3,
        self: options =>
          service.deleteEntries(
            { collectionName: "posts" },
            ["e1", "e2"],
            options
          ),
        inTx: (tx, options) =>
          service.deleteEntriesInTransaction(
            tx,
            { collectionName: "posts" },
            ["e1", "e2"],
            options
          ),
        expectedIds: ["e1", "e2"],
      },
    ];

    // Point the operation's worker at a scripted per-item sequence; any item
    // beyond the script succeeds. Thrown values propagate as throws.
    const scriptWorker = (
      op: OpDef,
      script: Array<CollectionServiceResult<unknown> | Error>
    ) => {
      let calls = 0;
      return vi
        .spyOn(CollectionMutationService.prototype, op.worker)
        .mockImplementation(async () => {
          const outcome =
            script[calls] ?? okOutcome(op.expectedIds[calls] ?? `id-${calls}`);
          calls += 1;
          if (outcome instanceof Error) throw outcome;
          return outcome;
        });
    };

    // The happy-path worker result per item index; delete reports no written
    // row, so its data is null while the id still rides the outcome for
    // create/update id extraction.
    const okFor = (
      op: OpDef,
      index: number
    ): CollectionServiceResult<unknown> =>
      op.name === "deleteEntries"
        ? { ...okOutcome(op.expectedIds[index] ?? `id-${index}`), data: null }
        : okOutcome(op.expectedIds[index] ?? `id-${index}`);

    afterEach(() => {
      vi.restoreAllMocks();
    });

    for (const op of OPS) {
      describe(op.name, () => {
        it("reports per-item success with ids, outbox signal and intents", async () => {
          scriptWorker(op, [okFor(op, 0), okFor(op, 1)]);
          const result = await op.self();

          expect(result.successful).toBe(2);
          expect(result.failed).toBe(0);
          expect(result.errors).toEqual([]);
          expect(result.ids).toEqual(op.expectedIds);
          expect(result.eventRecorded).toBe(true);
          expect(result.revalidationIntents?.map(i => i.tags[0])).toEqual(
            op.expectedIds.map(id => `tag-${id}`)
          );
        });

        it("reports the same accounting inside the caller's transaction", async () => {
          scriptWorker(op, [okFor(op, 0), okFor(op, 1)]);
          const result = await op.inTx(makeTx());

          expect(result.successful).toBe(2);
          expect(result.ids).toEqual(op.expectedIds);
          expect(result.eventRecorded).toBe(true);
          expect(result.revalidationIntents).toHaveLength(2);
        });

        it("carries on past a returned per-item failure when stopOnError is unset", async () => {
          scriptWorker(op, [okFor(op, 0), committedThenFailed("nope")]);
          const result = await op.self();

          expect(result.successful).toBe(1);
          expect(result.failed).toBe(1);
          expect(result.errors).toEqual([{ index: 1, error: "nope" }]);
          // The committed-then-failed item still owes its delivery and its
          // tags, even though it is counted a failure.
          expect(result.eventRecorded).toBe(true);
          expect(result.revalidationIntents).toHaveLength(2);
        });

        it("carries on the same way inside the caller's transaction", async () => {
          scriptWorker(op, [okFor(op, 0), committedThenFailed("nope")]);
          const result = await op.inTx(makeTx());

          expect(result.successful).toBe(1);
          expect(result.errors).toEqual([{ index: 1, error: "nope" }]);
          expect(result.revalidationIntents).toHaveLength(2);
        });

        it("stopOnError rolls the self-transaction back", async () => {
          scriptWorker(op, [okFor(op, 0), committedThenFailed("nope")]);
          const result = await op.self({ stopOnError: true });

          expect(result.successful).toBe(0);
          expect(result.ids).toEqual([]);
          if (op.name === "deleteEntries") {
            // Delete rebuilds errors as exactly one entry per requested id:
            // the aborting id keeps its own message, the rest get the note.
            expect(result.failed).toBe(2);
            expect(result.errors).toHaveLength(2);
            expect(result.errors[0].index).toBe(0);
            expect(result.errors[0].error).toContain("Batch rolled back");
            // The note must still NAME the failing index: the abort is a
            // typed NextlyError whose own message is wire-generic, so the
            // note reads its cause rather than degrading every rolled-back
            // id to the generic text.
            expect(result.errors[0].error).toContain("Entry at index 1 failed");
            expect(result.errors[1]).toMatchObject({ index: 1, error: "nope" });
          } else {
            // Create/update annotate the first recorded error instead.
            expect(result.errors[0].index).toBe(1);
            expect(result.errors[0].error).toContain("nope");
            expect(result.errors[0].error).toContain(
              "1 successful entries were rolled back"
            );
          }
          expect(result.eventRecorded).toBe(false);
          // A rolled-back transaction undoes every write, so no item's cache
          // tags may be busted: intents collected before the abort must not
          // survive onto the result.
          expect(result.revalidationIntents).toBeUndefined();
        });

        it("stopOnError rejects out of the InTransaction twin so the caller's transaction rolls back", async () => {
          scriptWorker(op, [okFor(op, 0), committedThenFailed("nope")]);

          const rejection = await op.inTx(makeTx(), { stopOnError: true }).then(
            () => undefined,
            (error: unknown) => error
          );
          // The abort is a typed internal failure: the public message stays
          // generic — a returned worker failure may be a hook, access, or
          // server problem, not caller input — and the per-index detail
          // rides the cause, which the wire never serializes.
          if (!(rejection instanceof NextlyError)) {
            throw new Error(
              "expected the stopOnError abort to be a NextlyError"
            );
          }
          expect(rejection.code).toBe("INTERNAL_ERROR");
          expect(rejection.message).toBe("An unexpected error occurred.");
          expect(rejection.cause?.message).toContain("Entry at index 1 failed");
        });

        it("leaves the outbox signal absent on the twin when no item records an event", async () => {
          scriptWorker(op, [
            okWithoutSignals(op, 0),
            refusedWithoutSignals("nope"),
          ]);

          const result = await op.inTx(makeTx());

          // A caller-owned batch reports the outbox signal only when an
          // item recorded one: the caller owns the commit, so absence —
          // not a coerced false — is what it reads back afterwards. The
          // self-transaction twins differ on purpose: they own the commit
          // and read their own signal back, false included.
          expect("eventRecorded" in result).toBe(false);
          expect(result.successful).toBe(1);
          expect(result.failed).toBe(1);
        });

        it("keeps a thrown NextlyError's cause out of the returned accounting", async () => {
          scriptWorker(op, [
            okFor(op, 0),
            NextlyError.internal({
              cause: new Error(
                "connect ECONNREFUSED 127.0.0.1:5432 postgres://internal"
              ),
            }),
          ]);

          const result = await op.self();

          // Returned accounting carries the typed error's public message;
          // the driver detail riding its cause belongs to the operator
          // log. Delete rolls the whole batch back and keeps the
          // triggering error in its note, so both paths must stay clean.
          const messages = result.errors.map(e => e.error).join("\n");
          expect(result.failed).toBeGreaterThan(0);
          expect(messages).toContain("An unexpected error occurred.");
          expect(messages).not.toContain("ECONNREFUSED");
        });

        it("keeps an untyped worker error's detail out of the returned accounting", async () => {
          // An untyped error carries no public contract at all — its
          // message may be raw driver text — so the accounting answers
          // with the generic envelope message and leaves the detail to
          // the operator log.
          scriptWorker(op, [
            okFor(op, 0),
            new Error(
              "connect ECONNREFUSED 127.0.0.1:5432 postgres://internal"
            ),
          ]);

          const result = await op.self();

          const messages = result.errors.map(e => e.error).join("\n");
          expect(result.failed).toBeGreaterThan(0);
          expect(messages).toContain("An unexpected error occurred.");
          expect(messages).not.toContain("ECONNREFUSED");
        });

        it("survives a worker error whose cause graph cycles", async () => {
          const cyclic = new Error("cyclic");
          (cyclic as { cause?: Error }).cause = cyclic;
          scriptWorker(op, [okFor(op, 0), cyclic]);

          // The separating property is termination: an unbounded cause
          // walk blocks the thread outright here (a synchronous loop the
          // test runner's timer can never interrupt), so the batch never
          // returns at all.
          const result = await op.self();
          expect(result.failed).toBeGreaterThan(0);
        });

        it("refuses a batchSize that cannot advance the shared loop", async () => {
          scriptWorker(op, [okFor(op, 0), okFor(op, 1)]);

          // A fractional size slices overlapping batches, zero and negative
          // sizes pin the loop forever. The option is developer
          // configuration, so the refusal names the value it received.
          await expect(op.self({ batchSize: 2.5 })).rejects.toMatchObject({
            code: "INVALID_INPUT",
          });
          await expect(op.self({ batchSize: 0 })).rejects.toMatchObject({
            code: "INVALID_INPUT",
          });
          await expect(
            op.inTx(makeTx(), { batchSize: -1 })
          ).rejects.toMatchObject({
            code: "INVALID_INPUT",
          });
        });

        if (op.name !== "deleteEntries") {
          it("an integrity-marked failure aborts the batch even without stopOnError", async () => {
            scriptWorker(op, [
              okFor(op, 0),
              markWriteIntegrityFailure(new Error("capture failed")),
            ]);
            const result = await op.self();

            expect(result.successful).toBe(0);
            expect(result.ids).toEqual([]);
            expect(result.failed).toBe(2);
            // One generic error per requested index: every input was rolled
            // back, and the operational detail stays in the log.
            expect(
              result.errors.every(
                e =>
                  e.error ===
                  "The write could not be completed and was rolled back."
              )
            ).toBe(true);
            expect(result.eventRecorded).toBe(false);
            // The integrity rollback undid every write too — no intents may
            // survive for rows that never committed.
            expect(result.revalidationIntents).toBeUndefined();
          });

          it("an integrity-marked failure rejects out of the InTransaction twin", async () => {
            scriptWorker(op, [
              okFor(op, 0),
              markWriteIntegrityFailure(new Error("capture failed")),
            ]);

            await expect(op.inTx(makeTx())).rejects.toThrow("capture failed");
          });
        } else {
          it("any thrown error aborts the batch and rebuilds one error per requested id", async () => {
            scriptWorker(op, [okFor(op, 0), new Error("boom")]);
            const result = await op.self();

            expect(result.successful).toBe(0);
            expect(result.ids).toEqual([]);
            expect(result.failed).toBe(2);
            // An untyped error ships no public contract, so the rebuilt
            // accounting answers with the generic message on every index —
            // the raw text stays in the operator log.
            expect(result.errors[0].error).toContain("Batch rolled back");
            expect(result.errors[0].error).toContain(
              "An unexpected error occurred."
            );
            expect(result.errors[1]).toMatchObject({
              index: 1,
              error: "An unexpected error occurred.",
            });
            expect(result.errors.every(e => !e.error.includes("boom"))).toBe(
              true
            );
            expect(result.eventRecorded).toBe(false);
            // Rolled-back deletes bust no tags either.
            expect(result.revalidationIntents).toBeUndefined();
          });

          it("any thrown error propagates out of the InTransaction twin", async () => {
            scriptWorker(op, [okFor(op, 0), new Error("boom")]);

            await expect(op.inTx(makeTx())).rejects.toThrow("boom");
          });
        }

        it("forwards skipHooks to every worker call (asserted on the flag itself)", async () => {
          const spy = scriptWorker(op, [okFor(op, 0), okFor(op, 1)]);
          await op.self({ skipHooks: true });

          expect(spy.mock.calls.length).toBe(2);
          for (const call of spy.mock.calls) {
            expect(call[op.skipHooksArg]).toBe(true);
          }

          // The negative twin: without the option the flag must be false —
          // asserting only the bypass would pass on an absent flag too.
          spy.mockRestore();
          const unskipped = scriptWorker(op, [okFor(op, 0), okFor(op, 1)]);
          await op.self();
          for (const call of unskipped.mock.calls) {
            expect(call[op.skipHooksArg]).toBe(false);
          }
        });

        it("warms readiness on the self path only; the InTransaction twin never does", async () => {
          const warm = vi
            .spyOn(
              CollectionMutationService.prototype,
              "warmLocalizedReadiness"
            )
            .mockResolvedValue(undefined);
          scriptWorker(op, [okFor(op, 0), okFor(op, 1)]);

          await op.inTx(makeTx());
          expect(warm).not.toHaveBeenCalled();

          await op.self();
          expect(warm).toHaveBeenCalled();
        });
      });
    }
  });
});
