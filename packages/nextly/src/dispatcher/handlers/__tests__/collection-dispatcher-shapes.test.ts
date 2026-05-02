// Phase 4 Task 8: regression tests for the collection-dispatcher op-types.
// Pin the canonical Response shapes per spec §5.1 so the migrated handlers
// cannot regress.
//
// Coverage target (one representative test per op-type):
//   respondList:     listCollections, listEntries (paginated)
//   respondDoc:      getCollection, getEntry (bare doc)
//   respondMutation: createCollection (201), updateCollection (200),
//                    deleteCollection (200), createEntry (201),
//                    updateEntry (200), deleteEntry (200), duplicateEntry (201)
//   respondAction:   applySchemaChanges (composite mutation; non-CRUD)
//   respondCount:    countEntries
//   respondData:     previewSchemaChanges (custom preview payload)
//
// Bulk operations (bulkDeleteEntries, bulkUpdateEntries, bulkUpdateByQuery)
// are intentionally NOT migrated in this task; their wire shape is deferred
// to Phase 4.5 and stays unchanged here.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 4 Task 8 (defect fix): the new respondAction test for
// applySchemaChanges and the respondData test for previewSchemaChanges
// need to drive code paths that pull dependencies out of the DI
// container (registry, adapter, migration journal). The CRUD handlers
// covered by the rest of this file go through the legacy
// `services.collections` fallback and never read DI; mocking the di
// helpers to return undefined for those (the default) leaves their
// behaviour unchanged. The schema-pipeline factories
// (createApplyDesiredSchema, previewDesiredSchema,
// translatePipelinePreviewToLegacy) are mocked so we exercise the
// dispatcher's response-shape contract without spinning up a real
// drizzle-kit pipeline.
vi.mock("../../helpers/di", () => ({
  getAdapterFromDI: vi.fn(),
  getCollectionRegistryFromDI: vi.fn(),
  getCollectionsHandlerFromDI: vi.fn(),
  getMigrationJournalFromDI: vi.fn(),
}));

vi.mock("../../../domains/schema/pipeline/apply", () => ({
  createApplyDesiredSchema: vi.fn(),
}));

vi.mock("../../../domains/schema/pipeline/preview", () => ({
  previewDesiredSchema: vi.fn(),
}));

vi.mock("../../../domains/schema/legacy-preview/translate", () => ({
  translatePipelinePreviewToLegacy: vi.fn(),
}));

import type { ServiceContainer } from "../../../services";
import type { BulkOperationResult } from "../../../domains/collections/services/collection-types";
import {
  getAdapterFromDI,
  getCollectionRegistryFromDI,
  getMigrationJournalFromDI,
} from "../../helpers/di";
import { createApplyDesiredSchema } from "../../../domains/schema/pipeline/apply";
import { previewDesiredSchema } from "../../../domains/schema/pipeline/preview";
import { translatePipelinePreviewToLegacy } from "../../../domains/schema/legacy-preview/translate";
import { dispatchCollections } from "../collection-dispatcher";

// Helper: build a ServiceContainer-shaped fake whose `collections`
// service-object methods are individually mockable via vi.fn(). The
// dispatcher prefers the DI-registered handler, but in tests with no DI
// setup `getCollectionsHandlerFromDI()` returns undefined and the
// fallback `services.collections` is used: exactly what we mock here.
function makeContainer(
  collections: Record<string, ReturnType<typeof vi.fn>>
): ServiceContainer {
  return {
    collections,
  } as unknown as ServiceContainer;
}

describe("dispatchCollections, paginated lists (respondList)", () => {
  it("listCollections returns Response with { items, meta } body and 200 status", async () => {
    const fakeCollections = [
      { slug: "posts", name: "posts" },
      { slug: "pages", name: "pages" },
    ];
    // Metadata service returns the legacy CollectionServiceResult shape:
    // { success, statusCode, message, data, meta }.
    const fakeServiceResult = {
      success: true,
      statusCode: 200,
      message: "Collections fetched successfully",
      data: fakeCollections,
      meta: { total: 2, page: 1, pageSize: 10, totalPages: 1 },
    };
    const container = makeContainer({
      listCollections: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "listCollections",
      { page: "1", pageSize: "10" },
      undefined
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body).toEqual({
      items: fakeCollections,
      meta: {
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
    // Regression guard: no { data } wrapper.
    expect(body).not.toHaveProperty("data");
  });

  it("listEntries returns Response with { items, meta } body and 200 status", async () => {
    const fakeEntries = [{ id: "e1" }, { id: "e2" }];
    // Entry query service returns a CollectionServiceResult wrapping a
    // PaginatedResponse: { success, data: { docs, totalDocs, limit, page,
    // totalPages, ... } }.
    const fakeServiceResult = {
      success: true,
      statusCode: 200,
      message: "Entries fetched successfully",
      data: {
        docs: fakeEntries,
        totalDocs: 2,
        limit: 10,
        page: 1,
        totalPages: 1,
        pagingCounter: 1,
        hasPrevPage: false,
        hasNextPage: false,
        prevPage: null,
        nextPage: null,
      },
    };
    const container = makeContainer({
      listEntries: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "listEntries",
      { collectionName: "posts", page: "1", pageSize: "10" },
      undefined
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      items: fakeEntries,
      meta: {
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("docs");
  });
});

describe("dispatchCollections, single-doc reads (respondDoc)", () => {
  it("getCollection returns bare doc body", async () => {
    const fakeCollection = { slug: "posts", name: "posts", fields: [] };
    const fakeServiceResult = {
      success: true,
      statusCode: 200,
      message: "Collection fetched successfully",
      data: fakeCollection,
    };
    const container = makeContainer({
      getCollection: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "getCollection",
      { collectionName: "posts" },
      undefined
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(fakeCollection);
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });

  it("getEntry returns bare doc body", async () => {
    const fakeEntry = { id: "e1", title: "Hello" };
    const fakeServiceResult = {
      success: true,
      statusCode: 200,
      message: "Entry fetched successfully",
      data: fakeEntry,
    };
    const container = makeContainer({
      getEntry: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "getEntry",
      { collectionName: "posts", entryId: "e1" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(fakeEntry);
    expect(body).not.toHaveProperty("data");
  });
});

describe("dispatchCollections, mutations (respondMutation)", () => {
  it("createCollection returns { message, item } body and 201 status", async () => {
    const fakeCollection = { slug: "posts", name: "posts" };
    const fakeServiceResult = {
      success: true,
      statusCode: 201,
      message: "Collection created!",
      data: fakeCollection,
    };
    const container = makeContainer({
      createCollection: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "createCollection",
      {},
      { name: "posts", label: "Posts", fields: [] }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      message: "Collection created!",
      item: fakeCollection,
    });
    expect(body).not.toHaveProperty("data");
  });

  it("updateCollection returns { message, item } body and 200 status", async () => {
    const fakeCollection = { slug: "posts", label: "Posts (renamed)" };
    const fakeServiceResult = {
      success: true,
      statusCode: 200,
      message: "Collection updated successfully",
      data: fakeCollection,
    };
    const container = makeContainer({
      updateCollection: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "updateCollection",
      { collectionName: "posts" },
      { label: "Posts (renamed)" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "Collection updated successfully",
      item: fakeCollection,
    });
  });

  it("deleteCollection returns { message, item } body", async () => {
    const fakeCollection = { slug: "posts" };
    const fakeServiceResult = {
      success: true,
      statusCode: 200,
      message: "Collection deleted successfully",
      data: fakeCollection,
    };
    const container = makeContainer({
      deleteCollection: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "deleteCollection",
      { collectionName: "posts" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual({
      message: "Collection deleted successfully",
      item: fakeCollection,
    });
  });

  it("createEntry returns { message, item } body and 201 status", async () => {
    const fakeEntry = { id: "e1", title: "Hello" };
    const fakeServiceResult = {
      success: true,
      statusCode: 201,
      message: "Entry created successfully",
      data: fakeEntry,
    };
    const container = makeContainer({
      createEntry: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "createEntry",
      { collectionName: "posts" },
      { title: "Hello" }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      message: "Entry created successfully",
      item: fakeEntry,
    });
  });

  it("updateEntry returns { message, item } body and 200 status", async () => {
    const fakeEntry = { id: "e1", title: "Hello (updated)" };
    const fakeServiceResult = {
      success: true,
      statusCode: 200,
      message: "Entry updated successfully",
      data: fakeEntry,
    };
    const container = makeContainer({
      updateEntry: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "updateEntry",
      { collectionName: "posts", entryId: "e1" },
      { title: "Hello (updated)" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "Entry updated successfully",
      item: fakeEntry,
    });
  });

  it("deleteEntry returns { message, item } body", async () => {
    const fakeEntry = { id: "e1" };
    const fakeServiceResult = {
      success: true,
      statusCode: 200,
      message: "Entry deleted successfully",
      data: fakeEntry,
    };
    const container = makeContainer({
      deleteEntry: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "deleteEntry",
      { collectionName: "posts", entryId: "e1" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual({
      message: "Entry deleted successfully",
      item: fakeEntry,
    });
  });

  it("duplicateEntry returns { message, item } body and 201 status", async () => {
    // duplicateEntry delegates to createEntry, so the shape is identical
    // to createEntry. We pin 201 explicitly since duplicate is a create.
    const fakeEntry = { id: "e2", title: "Hello (Copy)" };
    const fakeServiceResult = {
      success: true,
      statusCode: 201,
      message: "Entry created successfully",
      data: fakeEntry,
    };
    const container = makeContainer({
      duplicateEntry: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "duplicateEntry",
      { collectionName: "posts", entryId: "e1" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      message: "Entry created successfully",
      item: fakeEntry,
    });
  });
});

describe("dispatchCollections, counts (respondCount)", () => {
  it("countEntries returns { total } body and 200 status", async () => {
    // countEntries service returns CollectionServiceResult<{ totalDocs }>.
    // Wire shape canonicalises on `total` (PaginationMeta nomenclature).
    const fakeServiceResult = {
      success: true,
      statusCode: 200,
      message: "Count retrieved successfully",
      data: { totalDocs: 42 },
    };
    const container = makeContainer({
      countEntries: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "countEntries",
      { collectionName: "posts" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ total: 42 });
    expect(body).not.toHaveProperty("totalDocs");
  });
});

describe("dispatchCollections, bulk ops migrated to respondBulk (Phase 4.5)", () => {
  // Phase 4.5: bulk ops emit the canonical respondBulk envelope
  // `{ message, items, errors }` with HTTP 200 even on partial success.
  // Per-item failures live in `errors[]` with structured `{ id, code, message }`
  // (canonical NextlyErrorCode). Status 4xx is reserved for malformed
  // request envelopes (no ids, missing data); partial success is normal data.

  it("bulkDeleteEntries returns respondBulk with all-success body", async () => {
    const fakeServiceResult: BulkOperationResult<{ id: string }> = {
      successes: [{ id: "e1" }, { id: "e2" }],
      failures: [],
      total: 2,
      successCount: 2,
      failedCount: 0,
    };
    const container = makeContainer({
      bulkDeleteEntries: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "bulkDeleteEntries",
      { collectionName: "posts" },
      { ids: ["e1", "e2"] }
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    // All-success message uses singular/plural noun without "of M";
    // partial-success messages add "of M" for clarity (asserted below).
    expect(body).toEqual({
      message: "Deleted 2 entries.",
      items: [{ id: "e1" }, { id: "e2" }],
      errors: [],
    });
    // Regression guards: legacy fields must not appear on the wire.
    expect(body).not.toHaveProperty("success");
    expect(body).not.toHaveProperty("failed");
    expect(body).not.toHaveProperty("data");
  });

  it("bulkDeleteEntries surfaces partial failures as { id, code, message } in errors[]", async () => {
    const fakeServiceResult: BulkOperationResult<{ id: string }> = {
      successes: [{ id: "e1" }],
      failures: [
        {
          id: "e2",
          code: "FORBIDDEN",
          message: "You do not have permission to perform this action.",
        },
      ],
      total: 2,
      successCount: 1,
      failedCount: 1,
    };
    const container = makeContainer({
      bulkDeleteEntries: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "bulkDeleteEntries",
      { collectionName: "posts" },
      { ids: ["e1", "e2"] }
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    // Partial-success returns 200, not 207 or 4xx; per-item failures are data.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe("Deleted 1 of 2 entries.");
    expect(body.items).toEqual([{ id: "e1" }]);
    expect(body.errors).toEqual([
      {
        id: "e2",
        code: "FORBIDDEN",
        message: "You do not have permission to perform this action.",
      },
    ]);
  });

  it("bulkUpdateEntries returns respondBulk with full-record items[]", async () => {
    // Phase 4.5: update returns FULL records in items[] (not just ids) so
    // the admin client can refresh local state without a re-fetch.
    const updatedRecord = { id: "e1", title: "Updated", status: "published" };
    const fakeServiceResult: BulkOperationResult<typeof updatedRecord> = {
      successes: [updatedRecord],
      failures: [],
      total: 1,
      successCount: 1,
      failedCount: 0,
    };
    const container = makeContainer({
      bulkUpdateEntries: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "bulkUpdateEntries",
      { collectionName: "posts" },
      { ids: ["e1"], data: { status: "published" } }
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe("Updated 1 entry.");
    expect(body.items).toEqual([updatedRecord]);
    expect(body.errors).toEqual([]);
  });

  it("bulkUpdateByQuery returns respondBulk envelope", async () => {
    const fakeServiceResult: BulkOperationResult<{ id: string; status: string }> = {
      successes: [
        { id: "e1", status: "published" },
        { id: "e2", status: "published" },
      ],
      failures: [],
      total: 2,
      successCount: 2,
      failedCount: 0,
    };
    const container = makeContainer({
      bulkUpdateByQuery: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "bulkUpdateByQuery",
      { collectionName: "posts" },
      { where: { status: { equals: "draft" } }, data: { status: "published" } }
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe("Updated 2 entries.");
    expect(body.items).toHaveLength(2);
    expect(body.errors).toEqual([]);
  });
});

// Phase 4 Task 8 (defect fix): pin the canonical Response shapes for the
// two non-CRUD schema ops the rest of the file's header advertises but
// previously had no `it(...)` block for. applySchemaChanges -> respondAction;
// previewSchemaChanges -> respondData. We mock the DI helpers + pipeline
// factories so the dispatcher's response-shape contract is exercised in
// isolation (no real drizzle-kit + no live DB).

// Helper: build a fake registry whose getCollectionBySlug/getAllCollections
// return the seed values the apply/preview paths read out before delegating
// to the pipeline. `locked: false` is required so the handler doesn't bail
// with the "managed via code" error.
function makeFakeRegistry(seed: {
  slug: string;
  tableName: string;
  schemaVersion: number;
  fields?: unknown[];
}) {
  const record = {
    slug: seed.slug,
    tableName: seed.tableName,
    schemaVersion: seed.schemaVersion,
    fields: seed.fields ?? [],
    locked: false,
  };
  return {
    getCollectionBySlug: vi.fn().mockResolvedValue(record),
    // The apply path also queries getAllCollections to build the FULL
    // DesiredSchema snapshot (so non-target managed tables aren't dropped).
    // The single-collection seed is enough; the loop skips the target slug.
    getAllCollections: vi.fn().mockResolvedValue([record]),
  };
}

// Helper: build a fake adapter whose surface matches what the apply +
// preview handlers touch (dialect string, getDrizzle, update). The
// `update` mock resolves to `undefined` because the dispatcher only uses
// the side-effect (writing the `fields` JSON back); the result is never
// inspected.
function makeFakeAdapter() {
  return {
    dialect: "postgresql" as const,
    getDrizzle: vi.fn().mockReturnValue({}),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  // Default to "DI not initialized" between tests so a leftover mock
  // from one test doesn't leak into another. Each test that needs a
  // wired-up registry/adapter overrides these explicitly.
  vi.mocked(getCollectionRegistryFromDI).mockReturnValue(undefined);
  vi.mocked(getAdapterFromDI).mockReturnValue(undefined);
  vi.mocked(getMigrationJournalFromDI).mockReturnValue(undefined);
  vi.mocked(createApplyDesiredSchema).mockReset();
  vi.mocked(previewDesiredSchema).mockReset();
  vi.mocked(translatePipelinePreviewToLegacy).mockReset();
});

describe("dispatchCollections, applySchemaChanges (respondAction)", () => {
  it("returns Response with { message, newSchemaVersion, toastSummary } body and 200 status", async () => {
    // Wire DI: registry returns a non-locked posts collection at v4.
    // Adapter exposes the postgresql dialect + a Drizzle stub + update().
    const registry = makeFakeRegistry({
      slug: "posts",
      tableName: "posts",
      schemaVersion: 4,
    });
    const adapter = makeFakeAdapter();
    vi.mocked(getCollectionRegistryFromDI).mockReturnValue(
      registry as unknown as ReturnType<typeof getCollectionRegistryFromDI>
    );
    vi.mocked(getAdapterFromDI).mockReturnValue(
      adapter as unknown as ReturnType<typeof getAdapterFromDI>
    );

    // Stub createApplyDesiredSchema so the real PushSchemaPipeline is
    // never constructed. The returned `apply` function is what the
    // dispatcher awaits; we hand it back the canonical success ApplyResult.
    const fakeApply = vi.fn().mockResolvedValue({
      success: true,
      newSchemaVersions: { posts: 5 },
      statementsExecuted: 3,
      renamesApplied: 1,
      durationMs: 12,
      summary: { added: 2, removed: 0, renamed: 1, changed: 0 },
    });
    vi.mocked(createApplyDesiredSchema).mockReturnValue(
      fakeApply as unknown as ReturnType<typeof createApplyDesiredSchema>
    );

    // No `services.collections` mock needed: applySchemaChanges does NOT
    // delegate to the legacy collections service (it owns the pipeline
    // call + post-apply metadata write directly). An empty container is
    // enough to satisfy dispatchCollections's signature.
    const container = {
      collections: {},
    } as unknown as ServiceContainer;

    const result = await dispatchCollections(
      container,
      "applySchemaChanges",
      { collectionName: "posts" },
      {
        fields: [{ name: "title", type: "text" }],
        confirmed: true,
        schemaVersion: 4,
      }
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    // respondAction body shape: { message, ...result }. The result fields
    // are spread (not nested under `data`/`item`) so the admin can read
    // them directly off the Response.
    expect(body).toHaveProperty("message");
    expect(typeof body.message).toBe("string");
    expect(body.message).toContain("posts");
    expect(body).toHaveProperty("newSchemaVersion", 5);
    expect(body).toHaveProperty(
      "toastSummary",
      // formatToastSummary("2 added, 1 renamed") output, pinned here so
      // a regression in either the formatter or the dispatcher's wiring
      // surfaces as a localised diff (not a generic "string mismatch").
      "2 fields added, 1 renamed"
    );
    // Regression guards against the legacy CRUD shapes.
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });
});

describe("dispatchCollections, previewSchemaChanges (respondData)", () => {
  it("returns Response with bare preview body (legacyShape + renamed + schemaVersion)", async () => {
    // Same DI wiring as the apply test, but pointing at the preview path:
    // previewDesiredSchema + translatePipelinePreviewToLegacy are mocked
    // so the dispatcher's response-shape contract is what's under test.
    const registry = makeFakeRegistry({
      slug: "posts",
      tableName: "posts",
      schemaVersion: 7,
    });
    const adapter = makeFakeAdapter();
    vi.mocked(getCollectionRegistryFromDI).mockReturnValue(
      registry as unknown as ReturnType<typeof getCollectionRegistryFromDI>
    );
    vi.mocked(getAdapterFromDI).mockReturnValue(
      adapter as unknown as ReturnType<typeof getAdapterFromDI>
    );

    // Pipeline preview returns one rename candidate; the dispatcher maps
    // candidates -> renamed[] in the response body.
    vi.mocked(previewDesiredSchema).mockResolvedValue({
      operations: [],
      events: [],
      candidates: [
        {
          tableName: "posts",
          fromColumn: "title_old",
          toColumn: "title",
          fromType: "text",
          toType: "text",
          typesCompatible: true,
          defaultSuggestion: undefined,
        },
      ],
      classification: "safe",
      liveSnapshot: {} as unknown,
    } as unknown as Awaited<ReturnType<typeof previewDesiredSchema>>);

    // Translator returns a non-empty legacyShape; the dispatcher spreads
    // it into the response body so the admin SchemaChangeDialog renders
    // the legacy 3-option resolution set unchanged.
    vi.mocked(translatePipelinePreviewToLegacy).mockResolvedValue({
      hasChanges: true,
      hasDestructiveChanges: false,
      classification: "safe",
      changes: { added: [], removed: [], changed: [], unchanged: [] },
      warnings: [],
      interactiveFields: [],
      ddlPreview: [],
    } as unknown as Awaited<
      ReturnType<typeof translatePipelinePreviewToLegacy>
    >);

    const container = {
      collections: {},
    } as unknown as ServiceContainer;

    const result = await dispatchCollections(
      container,
      "previewSchemaChanges",
      { collectionName: "posts" },
      { fields: [{ name: "title", type: "text" }] }
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    // respondData body shape: the bare result object. Spread fields from
    // legacyShape (hasChanges/classification/changes/...) plus the two
    // dispatcher-added fields (renamed[], schemaVersion).
    expect(body).toHaveProperty("hasChanges", true);
    expect(body).toHaveProperty("classification", "safe");
    expect(body).toHaveProperty("schemaVersion", 7);
    expect(body).toHaveProperty("renamed");
    expect(Array.isArray(body.renamed)).toBe(true);
    expect(body.renamed).toHaveLength(1);
    expect(body.renamed[0]).toEqual({
      table: "posts",
      from: "title_old",
      to: "title",
      fromType: "text",
      toType: "text",
      typesCompatible: true,
      // Translator returned `defaultSuggestion: undefined`; JSON.stringify
      // drops undefined fields, so the wire body has no key for it.
    });
    // Regression guards: respondData ships the bare object, no envelope.
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
    expect(body).not.toHaveProperty("message");
  });
});
