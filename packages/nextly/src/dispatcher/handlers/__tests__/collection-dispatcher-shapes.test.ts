// Regression tests for the collection-dispatcher op-types. Pin the
// canonical Response shapes per spec §5.1 so the handlers cannot
// regress.
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
//   respondBulk:     bulkDeleteEntries, bulkUpdateEntries,
//                    bulkUpdateByQuery

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The respondAction test for applySchemaChanges and the respondData
// test for previewSchemaChanges need to drive code paths that pull
// dependencies out of the DI container (registry, adapter, migration
// journal). The CRUD handlers covered by the rest of this file go
// through the legacy `services.collections` fallback and never read DI;
// mocking the di helpers to return undefined for those (the default)
// leaves their behaviour unchanged. The schema-pipeline factories
// (createApplyDesiredSchema, previewDesiredSchema,
// translatePipelinePreviewToLegacy) are mocked so we exercise the
// dispatcher's response-shape contract without spinning up a real
// drizzle-kit pipeline.
// `buildFullDesiredSchema` reaches for the single and component registries so
// drizzle-kit sees every managed table; both preview and apply go through it.
// A factory mock replaces the WHOLE module, so an accessor missing here is not
// "undefined" (which the helper handles — it skips that entity kind) but a
// hard "No export is defined on the mock" throw before any assertion runs.
vi.mock("../../helpers/di", () => ({
  getAdapterFromDI: vi.fn(),
  getCollectionRegistryFromDI: vi.fn(),
  getCollectionsHandlerFromDI: vi.fn(),
  getMigrationJournalFromDI: vi.fn(),
  getSingleRegistryFromDI: vi.fn(),
  getComponentRegistryFromDI: vi.fn(),
  getSchemaRegistryFromDI: vi.fn(),
  getConfigFromDI: vi.fn(),
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
// Not mocked: the i18n enable guard reads the app config off the real
// container, so these tests register one rather than stubbing the guard.
import { container } from "../../../di/container";
import { NextlyError } from "../../../errors";

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
      meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
    };
    const container = makeContainer({
      listCollections: vi.fn().mockResolvedValue(fakeServiceResult),
    });

    const result = await dispatchCollections(
      container,
      "listCollections",
      { page: "1", limit: "10" },
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
      { collectionName: "posts", page: "1", limit: "10" },
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

describe("dispatchCollections listEntries / countEntries — status forwarding", () => {
  // Why: regression coverage for the admin's "drafts disappear from the
  // entries table" bug. The list and count endpoints must forward the
  // `?status=` URL param so the admin can pass status=all and see drafts;
  // public REST callers omit it and continue to get the published-only
  // default. Same allowlist as getEntry (Task 7 PR-3) — anything else
  // dropped to undefined to prevent injection.

  const fakeListResult = {
    success: true,
    statusCode: 200,
    data: {
      docs: [],
      totalDocs: 0,
      limit: 10,
      page: 1,
      totalPages: 0,
      pagingCounter: 0,
      hasPrevPage: false,
      hasNextPage: false,
      prevPage: null,
      nextPage: null,
    },
  };

  it("listEntries forwards ?status=all to svc.listEntries", async () => {
    const listEntries = vi.fn().mockResolvedValue(fakeListResult);
    const container = makeContainer({ listEntries });

    await dispatchCollections(
      container,
      "listEntries",
      { collectionName: "posts", status: "all" },
      undefined
    );

    expect(listEntries).toHaveBeenCalledWith(
      expect.objectContaining({ status: "all" })
    );
  });

  it("listEntries forwards ?status=draft and ?status=published", async () => {
    const listEntries = vi.fn().mockResolvedValue(fakeListResult);
    const container = makeContainer({ listEntries });

    await dispatchCollections(
      container,
      "listEntries",
      { collectionName: "posts", status: "draft" },
      undefined
    );
    await dispatchCollections(
      container,
      "listEntries",
      { collectionName: "posts", status: "published" },
      undefined
    );

    expect(listEntries).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: "draft" })
    );
    expect(listEntries).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: "published" })
    );
  });

  it("listEntries rejects an unknown status value with 400 and never queries", async () => {
    const listEntries = vi.fn().mockResolvedValue(fakeListResult);
    const container = makeContainer({ listEntries });

    // An invalid status is rejected rather than silently widened to "all"
    // (which would leak drafts): the handler throws before touching the service.
    await expect(
      dispatchCollections(
        container,
        "listEntries",
        { collectionName: "posts", status: "lol-injection" },
        undefined
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(listEntries).not.toHaveBeenCalled();
  });

  it("listEntries omits status when ?status= is absent (preserves default)", async () => {
    const listEntries = vi.fn().mockResolvedValue(fakeListResult);
    const container = makeContainer({ listEntries });

    await dispatchCollections(
      container,
      "listEntries",
      { collectionName: "posts" },
      undefined
    );

    expect(listEntries).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined })
    );
  });

  const fakeCountResult = {
    success: true,
    statusCode: 200,
    data: { totalDocs: 0 },
  };

  it("countEntries forwards ?status=all to svc.countEntries", async () => {
    const countEntries = vi.fn().mockResolvedValue(fakeCountResult);
    const container = makeContainer({ countEntries });

    await dispatchCollections(
      container,
      "countEntries",
      { collectionName: "posts", status: "all" },
      undefined
    );

    expect(countEntries).toHaveBeenCalledWith(
      expect.objectContaining({ status: "all" })
    );
  });

  it("countEntries rejects an unknown status value with 400 and never queries", async () => {
    const countEntries = vi.fn().mockResolvedValue(fakeCountResult);
    const container = makeContainer({ countEntries });

    await expect(
      dispatchCollections(
        container,
        "countEntries",
        { collectionName: "posts", status: "garbage" },
        undefined
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(countEntries).not.toHaveBeenCalled();
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

  it("createEntry decodes and forwards the authenticated roles", async () => {
    const spy = vi.fn().mockResolvedValue({
      success: true,
      statusCode: 201,
      message: "ok",
      data: { id: "e1" },
    });
    const container = makeContainer({ createEntry: spy });

    await dispatchCollections(
      container,
      "createEntry",
      {
        collectionName: "posts",
        _authenticatedUserId: "u1",
        // Route params are strings; roles arrive JSON-encoded.
        _authenticatedUserRoles: JSON.stringify(["editor", "author"]),
      },
      { title: "Hello" }
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "posts",
        userId: "u1",
        userRoles: ["editor", "author"],
      }),
      expect.anything()
    );
  });

  it.each([
    ["non-JSON string", "not-json"],
    ["a mixed-type array", JSON.stringify(["editor", 123])],
    ["a non-array value", JSON.stringify({ role: "editor" })],
    ["an empty array", JSON.stringify([])],
  ])(
    "createEntry degrades %s roles param to undefined",
    async (_label, raw) => {
      const spy = vi.fn().mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "ok",
        data: { id: "e1" },
      });
      const container = makeContainer({ createEntry: spy });

      await dispatchCollections(
        container,
        "createEntry",
        {
          collectionName: "posts",
          _authenticatedUserId: "u1",
          _authenticatedUserRoles: raw,
        },
        { title: "Hello" }
      );

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ userRoles: undefined }),
        expect.anything()
      );
    }
  );

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

describe("dispatchCollections, bulk ops respondBulk envelope", () => {
  // Bulk ops emit the canonical respondBulk envelope
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
    // Update returns FULL records in items[] (not just ids) so the
    // admin client can refresh local state without a re-fetch.
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
    const fakeServiceResult: BulkOperationResult<{
      id: string;
      status: string;
    }> = {
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

  it("bulkUpdateByQuery forwards the authenticated user to the service", async () => {
    // Regression guard: the query-based bulk update must run as the
    // authenticated caller (not anonymously), so per-entry access control,
    // hooks, and response redaction resolve against the real user.
    const spy = vi.fn().mockResolvedValue({
      successes: [{ id: "e1" }],
      failures: [],
      total: 1,
      successCount: 1,
      failedCount: 0,
    });
    const container = makeContainer({ bulkUpdateByQuery: spy });

    await dispatchCollections(
      container,
      "bulkUpdateByQuery",
      {
        collectionName: "posts",
        _authenticatedUserId: "user-1",
        _authenticatedUserName: "Ada",
        _authenticatedUserEmail: "ada@example.com",
      },
      { where: { status: { equals: "draft" } }, data: { status: "published" } }
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "posts",
        userId: "user-1",
        userName: "Ada",
        userEmail: "ada@example.com",
      }),
      expect.anything()
    );
  });
});

// Pin the canonical Response shapes for the two non-CRUD schema ops:
// applySchemaChanges -> respondAction; previewSchemaChanges ->
// respondData. We mock the DI helpers and pipeline factories so the
// dispatcher's response-shape contract is exercised in isolation (no
// real drizzle-kit, no live DB).

// Helper: build a fake registry whose getCollectionBySlug/getAllCollections
// return the seed values the apply/preview paths read out before delegating
// to the pipeline. `locked: false` is required so the handler doesn't bail
// with the "managed via code" error.
function makeFakeRegistry(seed: {
  slug: string;
  tableName: string;
  schemaVersion: number;
  fields?: unknown[];
  localized?: boolean;
}) {
  const record = {
    slug: seed.slug,
    tableName: seed.tableName,
    schemaVersion: seed.schemaVersion,
    fields: seed.fields ?? [],
    localized: seed.localized ?? false,
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

// i18n: the Schema Builder sends the toggle as it stands in the unsaved form,
// so one save can flip Internationalization AND change fields. These pin the
// three places that has to hold together: the apply must diff with the sent
// flag, PERSIST it, and reject a non-boolean rather than reading it as a
// disable; the preview must diff with the same flag the apply will use.
describe("dispatchCollections, i18n request flag", () => {
  const LOCALIZATION = {
    locales: [{ code: "en", label: "English", rtl: false, fallbackLocale: [] }],
    defaultLocale: "en",
    fallback: true,
  };

  beforeEach(() => {
    // The enable guard reads the app config straight off the container.
    container.register("config", () => ({ localization: LOCALIZATION }));
  });

  afterEach(() => {
    container.clear();
  });

  function wire(localized: boolean) {
    const registry = makeFakeRegistry({
      slug: "posts",
      tableName: "posts",
      schemaVersion: 4,
      localized,
    });
    // A localized apply runs the companion transition before the metadata
    // write, so this fake has to answer the questions that plan asks. The
    // companion is reported as already present and the statements as no-ops:
    // what is under test here is which flag the apply diffed and stored, not
    // the reconcile SQL (covered by the i18n migration suites).
    const adapter = {
      ...makeFakeAdapter(),
      tableExists: vi.fn().mockResolvedValue(true),
      getDrizzle: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue([]),
        run: vi.fn().mockResolvedValue(undefined),
        // `{ rows }` because this fake is postgres and node-postgres returns a QueryResult, not
        // an array. The companion capability probe introspects through this handle and reads
        // `.rows`, so a bare `[]` here is not "no columns" -- it is a shape the reader cannot
        // walk, and it fails the whole apply with an opaque internal error.
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }),
      execute: vi.fn().mockResolvedValue(undefined),
      executeQuery: vi.fn().mockResolvedValue([]),
      raw: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getCollectionRegistryFromDI).mockReturnValue(
      registry as unknown as ReturnType<typeof getCollectionRegistryFromDI>
    );
    vi.mocked(getAdapterFromDI).mockReturnValue(
      adapter as unknown as ReturnType<typeof getAdapterFromDI>
    );
    return adapter;
  }

  function stubApply() {
    const fakeApply = vi.fn().mockResolvedValue({
      success: true,
      newSchemaVersions: { posts: 5 },
      statementsExecuted: 3,
      renamesApplied: 0,
      durationMs: 12,
      summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
    });
    vi.mocked(createApplyDesiredSchema).mockReturnValue(
      fakeApply as unknown as ReturnType<typeof createApplyDesiredSchema>
    );
  }

  // The apply performs the false→true companion transition. If it does not
  // also store the flag, the settings write that follows reads ANOTHER
  // false→true transition and reconciles the companion a second time.
  it("persists the localized state the apply ran with", async () => {
    const adapter = wire(false);
    stubApply();

    await dispatchCollections(
      { collections: {} } as unknown as ServiceContainer,
      "applySchemaChanges",
      { collectionName: "posts" },
      {
        fields: [{ name: "title", type: "text" }],
        confirmed: true,
        schemaVersion: 4,
        localized: true,
      }
    );

    expect(adapter.update).toHaveBeenCalledWith(
      "dynamic_collections",
      expect.objectContaining({ localized: true }),
      expect.anything()
    );
  });

  it("leaves the stored flag alone when the request sends none", async () => {
    const adapter = wire(true);
    stubApply();

    await dispatchCollections(
      { collections: {} } as unknown as ServiceContainer,
      "applySchemaChanges",
      { collectionName: "posts" },
      {
        fields: [{ name: "title", type: "text" }],
        confirmed: true,
        schemaVersion: 4,
      }
    );

    expect(adapter.update).toHaveBeenCalledWith(
      "dynamic_collections",
      expect.objectContaining({ localized: true }),
      expect.anything()
    );
  });

  // `"false"` under a `=== true` read would mean DISABLE — restoring the
  // companion's columns onto the main table and archiving it — from a request
  // that never asked for one.
  it("rejects a non-boolean localized instead of reading it as a disable", async () => {
    wire(true);
    stubApply();

    await expect(
      dispatchCollections(
        { collections: {} } as unknown as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [{ name: "title", type: "text" }],
          confirmed: true,
          schemaVersion: 4,
          localized: "false",
        }
      )
    ).rejects.toThrow(NextlyError);
  });

  // The preview collects the resolutions the apply then runs with, so a
  // preview that diffed against the PERSISTED flag could miss a required
  // column prompt the apply needs, failing the save after confirmation.
  it("previews against the request's flag, not the persisted one", async () => {
    wire(true);
    vi.mocked(previewDesiredSchema).mockResolvedValue({
      operations: [],
      events: [],
      candidates: [],
      classification: "safe",
      liveSnapshot: {} as unknown,
    } as unknown as Awaited<ReturnType<typeof previewDesiredSchema>>);
    vi.mocked(translatePipelinePreviewToLegacy).mockResolvedValue({
      hasChanges: false,
      hasDestructiveChanges: false,
      classification: "safe",
      changes: { added: [], removed: [], changed: [], unchanged: [] },
      warnings: [],
      interactiveFields: [],
      ddlPreview: [],
    } as unknown as Awaited<
      ReturnType<typeof translatePipelinePreviewToLegacy>
    >);

    await dispatchCollections(
      { collections: {} } as unknown as ServiceContainer,
      "previewSchemaChanges",
      { collectionName: "posts" },
      { fields: [{ name: "title", type: "text" }], localized: false }
    );

    const passed = vi.mocked(previewDesiredSchema).mock.calls[0][0] as {
      desired: { collections: Record<string, { localized?: boolean }> };
    };
    expect(passed.desired.collections.posts.localized).toBe(false);
  });
});

// Persisting the flag is not bookkeeping when the flag MOVED: the DDL above
// has already relocated the translatable columns, and the stored flag is what
// every later process reads to decide which table those columns live in.
// Losing that write leaves the registry describing a layout the database no
// longer has, so the apply must not report success.
describe("dispatchCollections, localized persistence failure", () => {
  const LOCALIZATION = {
    locales: [{ code: "en", label: "English", rtl: false, fallbackLocale: [] }],
    defaultLocale: "en",
    fallback: true,
  };

  beforeEach(() => {
    container.register("config", () => ({ localization: LOCALIZATION }));
  });

  afterEach(() => {
    container.clear();
  });

  function wireFailingUpdate(storedLocalized: boolean) {
    const registry = makeFakeRegistry({
      slug: "posts",
      tableName: "posts",
      schemaVersion: 4,
      localized: storedLocalized,
    });
    const adapter = {
      dialect: "postgresql" as const,
      tableExists: vi.fn().mockResolvedValue(true),
      getDrizzle: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue([]),
        run: vi.fn().mockResolvedValue(undefined),
        // `{ rows }` because this fake is postgres and node-postgres returns a QueryResult, not
        // an array. The companion capability probe introspects through this handle and reads
        // `.rows`, so a bare `[]` here is not "no columns" -- it is a shape the reader cannot
        // walk, and it fails the whole apply with an opaque internal error.
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }),
      execute: vi.fn().mockResolvedValue(undefined),
      executeQuery: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockRejectedValue(new Error("registry write failed")),
    };
    vi.mocked(getCollectionRegistryFromDI).mockReturnValue(
      registry as unknown as ReturnType<typeof getCollectionRegistryFromDI>
    );
    vi.mocked(getAdapterFromDI).mockReturnValue(
      adapter as unknown as ReturnType<typeof getAdapterFromDI>
    );
    vi.mocked(createApplyDesiredSchema).mockReturnValue(
      vi.fn().mockResolvedValue({
        success: true,
        newSchemaVersions: { posts: 5 },
        statementsExecuted: 3,
        renamesApplied: 0,
        durationMs: 12,
        summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
      }) as unknown as ReturnType<typeof createApplyDesiredSchema>
    );
  }

  it("refuses success when a localization transition could not be stored", async () => {
    wireFailingUpdate(false);

    await expect(
      dispatchCollections(
        { collections: {} } as unknown as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [{ name: "title", type: "text" }],
          confirmed: true,
          schemaVersion: 4,
          localized: true,
        }
      )
    ).rejects.toThrow(NextlyError);
  });

  // Without a transition the write carries only `fields`/`schema_version`, and
  // losing it leaves the admin showing stale names over a correct database —
  // the long-standing non-fatal case, which must stay non-fatal.
  it("still reports success when no transition was involved", async () => {
    wireFailingUpdate(true);

    const result = await dispatchCollections(
      { collections: {} } as unknown as ServiceContainer,
      "applySchemaChanges",
      { collectionName: "posts" },
      {
        fields: [{ name: "title", type: "text" }],
        confirmed: true,
        schemaVersion: 4,
        localized: true,
      }
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(200);
  });
});
