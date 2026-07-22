/**
 *
 * Tests for the access control behaviour of CollectionEntryService:
 * checkCollectionAccess for create/read/update/delete, owner-only filtering
 * via getAccessQueryConstraint, RBAC integration, and overrideAccess bypass.
 *
 * Covers:
 * - Access denied (403) for each CRUD operation
 * - Access allowed for each CRUD operation
 * - overrideAccess bypasses all access checks
 * - RBAC access control integration
 * - Owner-only filtering (access query constraint) on list/count
 * - Error handling in access evaluation (fail-secure)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import { normalizeLocalization } from "../../i18n/config/normalize";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";

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

// ── Helper to build service with specific access mocks ────────────────────

function buildService(overrides: {
  accessControlService?: ReturnType<typeof createMockAccessControlService>;
  rbacAccessControlService?: { checkAccess: ReturnType<typeof vi.fn> };
  collectionService?: ReturnType<typeof createMockCollectionService>;
  hookRegistry?: ReturnType<typeof createMockHookRegistry>;
  localization?: SanitizedLocalizationConfig;
}) {
  const schema = createMockSchema();
  const selectData = { rows: [] as unknown[] };
  const mockDb = createMockDb(selectData);
  const mockAdapter = createMockAdapter(mockDb);
  const fileManager = createMockFileManager(schema);

  const service = new CollectionEntryService(
    mockAdapter as never,
    silentLogger as never,
    fileManager as never,
    (overrides.collectionService ?? createMockCollectionService()) as never,
    createMockRelationshipService() as never,
    (overrides.hookRegistry ?? createMockHookRegistry()) as never,
    (overrides.accessControlService ??
      createMockAccessControlService()) as never,
    createMockComponentDataService() as never,
    overrides.rbacAccessControlService as never,
    overrides.localization as never
  );

  return { service, selectData, schema, adapter: mockAdapter, fileManager };
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("CollectionEntryService — Access Control Contracts", () => {
  // ── Collection-level access: read ─────────────────────────────────────

  describe("read access control", () => {
    it("should deny listEntries when access evaluation returns denied", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Read access denied",
      });
      const { service } = buildService({ accessControlService: acs });

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1", role: "viewer" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.message).toContain("denied");
    });

    it("should allow listEntries when access is granted", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({ allowed: true });
      const { service, selectData } = buildService({
        accessControlService: acs,
      });
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1", role: "editor" },
      });

      expect(result.success).toBe(true);
    });

    it("should deny getEntry when access is denied", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Cannot read this entry",
      });
      const { service } = buildService({ accessControlService: acs });

      const result = await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user: { id: "user-1" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("should deny countEntries when access is denied", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Count access denied",
      });
      const { service } = buildService({ accessControlService: acs });

      const result = await service.countEntries({
        collectionName: "posts",
        user: { id: "user-1" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });
  });

  // ── Collection-level access: create ───────────────────────────────────

  describe("create access control", () => {
    it("should deny createEntry when access is denied", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Cannot create entries",
      });
      const { service } = buildService({ accessControlService: acs });

      const result = await service.createEntry(
        { collectionName: "posts", user: { id: "user-1" } },
        { title: "Test" }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("should allow createEntry when access is granted", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({ allowed: true });
      const { service, selectData } = buildService({
        accessControlService: acs,
      });
      selectData.rows = [{ id: "new-1", title: "Test" }];

      const result = await service.createEntry(
        { collectionName: "posts", user: { id: "user-1", role: "editor" } },
        { title: "Test" }
      );

      expect(result.success).toBe(true);
    });
  });

  // ── Collection-level access: update ───────────────────────────────────

  describe("update access control", () => {
    it("should deny updateEntry when access is denied", async () => {
      const acs = createMockAccessControlService();
      // First call: for the getEntry check pass (we need the entry to exist)
      // The service fetches the entry first, then checks access
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Cannot update entries",
      });
      const { service, selectData } = buildService({
        accessControlService: acs,
      });
      selectData.rows = [createSampleEntry()];

      const result = await service.updateEntry(
        {
          collectionName: "posts",
          entryId: "entry-1",
          user: { id: "user-1" },
        },
        { title: "Updated" }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });
  });

  // ── Collection-level access: delete ───────────────────────────────────

  describe("delete access control", () => {
    it("should deny deleteEntry when access is denied", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Cannot delete entries",
      });
      const { service, selectData } = buildService({
        accessControlService: acs,
      });
      selectData.rows = [createSampleEntry()];

      const result = await service.deleteEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user: { id: "user-1" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });
  });

  // ── overrideAccess ────────────────────────────────────────────────────

  describe("overrideAccess bypass", () => {
    it("should bypass access control on listEntries when overrideAccess is true", async () => {
      const acs = createMockAccessControlService();
      // Even with denied access, overrideAccess should bypass
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Denied",
      });
      const { service, selectData } = buildService({
        accessControlService: acs,
      });
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1" },
        overrideAccess: true,
      });

      expect(result.success).toBe(true);
    });

    it("should bypass access control on createEntry when overrideAccess is true", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Denied",
      });
      const { service, selectData } = buildService({
        accessControlService: acs,
      });
      selectData.rows = [{ id: "new-1", title: "Test" }];

      const result = await service.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "Test" }
      );

      expect(result.success).toBe(true);
    });

    it("should bypass access control on getEntry when overrideAccess is true", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Denied",
      });
      const { service, selectData } = buildService({
        accessControlService: acs,
      });
      selectData.rows = [createSampleEntry()];

      const result = await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        overrideAccess: true,
      });

      expect(result.success).toBe(true);
    });

    it("should bypass access control on deleteEntry when overrideAccess is true", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockResolvedValue({
        allowed: false,
        reason: "Denied",
      });
      const { service, selectData } = buildService({
        accessControlService: acs,
      });
      selectData.rows = [createSampleEntry()];

      const result = await service.deleteEntry({
        collectionName: "posts",
        entryId: "entry-1",
        overrideAccess: true,
      });

      expect(result.success).toBe(true);
    });
  });

  // ── RBAC integration ──────────────────────────────────────────────────

  describe("RBAC access control", () => {
    it("should deny when RBAC service denies access", async () => {
      const rbac = {
        checkAccess: vi.fn().mockResolvedValue(false),
      };
      const { service } = buildService({
        rbacAccessControlService: rbac,
      });

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1", role: "viewer" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(rbac.checkAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          operation: "read",
          resource: "posts",
        })
      );
    });

    it("should allow when RBAC service allows access", async () => {
      const rbac = {
        checkAccess: vi.fn().mockResolvedValue(true),
      };
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
      });
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1", role: "admin" },
      });

      expect(result.success).toBe(true);
    });

    it("should fail-secure (deny) when RBAC throws an error", async () => {
      const rbac = {
        checkAccess: vi
          .fn()
          .mockRejectedValue(new Error("RBAC service unavailable")),
      };
      const { service } = buildService({
        rbacAccessControlService: rbac,
      });

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1", role: "admin" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.message).toContain("RBAC");
    });

    it("should skip RBAC when no user is provided", async () => {
      const rbac = {
        checkAccess: vi.fn().mockResolvedValue(false),
      };
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
      });
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        // No user provided
      });

      // RBAC only runs when user is provided
      expect(rbac.checkAccess).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  // ── Access rules from collection metadata ─────────────────────────────

  describe("access rules extraction", () => {
    it("should extract access rules from collection.accessRules (new format)", async () => {
      const acs = createMockAccessControlService();
      const cs = createMockCollectionService(
        createMockCollection({
          accessRules: { read: { type: "authenticated" } },
        })
      );
      const { service, selectData } = buildService({
        accessControlService: acs,
        collectionService: cs,
      });
      selectData.rows = [];

      await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1" },
      });

      expect(acs.evaluateAccess).toHaveBeenCalledWith(
        expect.objectContaining({ read: { type: "authenticated" } }),
        "read",
        expect.any(Object),
        undefined,
        undefined
      );
    });

    it("should extract access rules from schemaDefinition.accessRules (legacy format)", async () => {
      const acs = createMockAccessControlService();
      const cs = createMockCollectionService(
        createMockCollection({
          schemaDefinition: {
            fields: [],
            accessRules: { create: { type: "role", role: "admin" } },
          },
        })
      );
      const { service, selectData } = buildService({
        accessControlService: acs,
        collectionService: cs,
      });
      selectData.rows = [];

      await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1" },
      });

      // evaluateAccess should receive the legacy access rules
      expect(acs.evaluateAccess).toHaveBeenCalled();
    });

    it("should default to public access when no rules are defined", async () => {
      const acs = createMockAccessControlService();
      const cs = createMockCollectionService(
        createMockCollection({
          accessRules: undefined,
          schemaDefinition: { fields: [], accessRules: undefined },
        })
      );
      const { service, selectData } = buildService({
        accessControlService: acs,
        collectionService: cs,
      });
      selectData.rows = [];

      await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1" },
      });

      // evaluateAccess should receive undefined rules (defaults to public)
      expect(acs.evaluateAccess).toHaveBeenCalledWith(
        undefined,
        "read",
        expect.any(Object),
        undefined,
        undefined
      );
    });
  });

  // ── Fail-secure on access evaluation errors ───────────────────────────

  describe("fail-secure on access errors", () => {
    it("should return 500 when access evaluation throws", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockRejectedValue(
        new Error("Access service unavailable")
      );
      const { service } = buildService({ accessControlService: acs });

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.message).toContain("access");
    });

    it("should pass through collection-not-found errors", async () => {
      const acs = createMockAccessControlService();
      acs.evaluateAccess.mockRejectedValue(
        new Error("Collection 'posts' not found")
      );
      const { service, selectData } = buildService({
        accessControlService: acs,
      });
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1" },
      });

      // Collection not found should be handled differently
      expect(result.success).toBe(true);
    });
  });
});

// ── Publish-lifecycle transition access ─────────────────────────────────────
//
// Publishing is an ordinary write that sets status: "published", so the update
// gate does not distinguish it. A write that moves a document into or out of
// published needs the publish/unpublish permission ON TOP of update.
describe("publish-transition access control", () => {
  // evaluateAccess is the gate this harness controls; allow update, deny the
  // named lifecycle op, so only the transition check can fail.
  const allowUpdateDeny = (op: "publish" | "unpublish") => {
    const acs = createMockAccessControlService();
    acs.evaluateAccess.mockImplementation((_rules, operation) =>
      Promise.resolve(
        operation === op
          ? { allowed: false, reason: `Cannot ${op}` }
          : { allowed: true }
      )
    );
    return acs;
  };

  // The transition gate only runs when the collection has the draft/published
  // lifecycle enabled (`collection.status === true`), the same flag the read
  // path filters on. Every gated case below uses a lifecycle-enabled collection.
  const lifecycle = () =>
    createMockCollectionService(createMockCollection({ status: true }));

  it("denies updateEntry that moves a draft to published without publish", async () => {
    const acs = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
    });
    selectData.rows = [createSampleEntry({ status: "draft" })];

    const result = await service.updateEntry(
      { collectionName: "posts", entryId: "entry-1", user: { id: "user-1" } },
      { status: "published" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("denies unpublishing without the unpublish permission", async () => {
    const acs = allowUpdateDeny("unpublish");
    const { service, selectData } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
    });
    selectData.rows = [createSampleEntry({ status: "published" })];

    const result = await service.updateEntry(
      { collectionName: "posts", entryId: "entry-1", user: { id: "user-1" } },
      { status: "draft" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("denies a non-string status write that unpublishes without unpublish", async () => {
    // A non-string status (e.g. 0 / false) written over a published row still
    // moves it out of published on dialects that coerce the value into the text
    // column. The unpublish permission must be required even though the value is
    // not the string "published": the guard cannot key on
    // `typeof status === "string"`, or `status: 0` slips an unpublish past it.
    const acs = allowUpdateDeny("unpublish");
    const { service, selectData } = buildService({
      accessControlService: acs,
      // Lifecycle on, but no declared `status` field so a non-string status is
      // not rejected by validation before it reaches the transition gate.
      collectionService: createMockCollectionService(
        createMockCollection({
          status: true,
          schemaDefinition: {
            fields: [{ name: "title", type: "text" }],
            accessRules: undefined,
            hooks: [],
            search: undefined,
          },
          fields: [{ name: "title", type: "text" }],
        })
      ),
    });
    selectData.rows = [createSampleEntry({ status: "published" })];

    const result = await service.updateEntry(
      { collectionName: "posts", entryId: "entry-1", user: { id: "user-1" } },
      { title: "still here", status: 0 }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("does not require publish for an edit that keeps status published", async () => {
    // A caller with update but not publish can still edit a live document, as
    // long as they are not changing whether it is published.
    const acs = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
    });
    selectData.rows = [createSampleEntry({ status: "published" })];

    const result = await service.updateEntry(
      { collectionName: "posts", entryId: "entry-1", user: { id: "user-1" } },
      { title: "Edited, still published", status: "published" }
    );

    // The transition check never fires (no move), so the publish denial is
    // never consulted; the write proceeds past access control.
    expect(result.statusCode).not.toBe(403);
  });

  it("does not require publish for a patch that omits status", async () => {
    const acs = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
    });
    selectData.rows = [createSampleEntry({ status: "draft" })];

    const result = await service.updateEntry(
      { collectionName: "posts", entryId: "entry-1", user: { id: "user-1" } },
      { title: "Just a title" }
    );

    expect(result.statusCode).not.toBe(403);
  });

  it("does not gate a status field when the collection has no lifecycle", async () => {
    // A collection WITHOUT the draft/published lifecycle can still carry an
    // ordinary user field named `status`. Setting it to "published" is a field
    // edit, not a publish, and must not demand the publish permission. The
    // default mock collection has no `status: true` flag, so the gate no-ops.
    const acs = allowUpdateDeny("publish");
    const { service, selectData } = buildService({ accessControlService: acs });
    selectData.rows = [createSampleEntry({ status: "draft" })];

    await service.updateEntry(
      { collectionName: "posts", entryId: "entry-1", user: { id: "user-1" } },
      { status: "published" }
    );

    // The publish permission is never consulted when there is no lifecycle.
    const publishConsulted = acs.evaluateAccess.mock.calls.some(
      ([, operation]: [unknown, string]) => operation === "publish"
    );
    expect(publishConsulted).toBe(false);
  });

  it("gates a publish derived by a beforeUpdate hook, not just the body", async () => {
    // Secure-by-result: the gate asks whether the write makes content public,
    // judged on the FINAL data. A hook the caller cannot see derives
    // status: "published" from a body that omits it; the publish permission is
    // still required.
    const acs = allowUpdateDeny("publish");
    const hookRegistry = createMockHookRegistry();
    hookRegistry.execute.mockImplementation((_phase: string, ctx: unknown) =>
      Promise.resolve({
        ...((ctx as { data?: Record<string, unknown> })?.data ?? {}),
        status: "published",
      })
    );
    const { service, selectData } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
      hookRegistry,
    });
    selectData.rows = [createSampleEntry({ status: "draft" })];

    const result = await service.updateEntry(
      { collectionName: "posts", entryId: "entry-1", user: { id: "user-1" } },
      { title: "Body omits status" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("gates a per-locale translation against the companion status, not the main row", async () => {
    // The hole this closes: the main row is already published, so keying the
    // gate on the main status (published -> published) sees no transition and
    // would let a caller with update-but-not-publish publish a still-draft
    // translation. The gate must instead compare the write locale's companion
    // `_status` (draft -> published = publish).
    const acs = allowUpdateDeny("publish");
    const { service, selectData, fileManager } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
      localization: normalizeLocalization({
        locales: ["en", "de"],
        defaultLocale: "en",
      }),
    });
    // The main-row read and the companion `_status` read both resolve to this
    // row in the mock db, so it carries the main `status` (published) and the
    // German companion `_status` (still draft) together.
    selectData.rows = [
      createSampleEntry({ status: "published", _status: "draft" }),
    ];
    // A localized collection whose companion carries a per-locale `_status`; the
    // table object exposes the columns the pooled Drizzle read filters on.
    fileManager.loadCompanionSchema.mockResolvedValue({
      companionTableName: "posts_locales",
      table: {
        _parent: Symbol("_parent"),
        _locale: Symbol("_locale"),
        _status: Symbol("_status"),
      },
      localizedFields: [{ name: "title", column: "title" }],
      hasStatus: true,
    });

    const result = await service.updateEntry(
      {
        collectionName: "posts",
        entryId: "entry-1",
        user: { id: "user-1" },
        locale: "de",
      },
      { title: "German translation", status: "published" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("does not treat a non-string status on a locale edit as an unpublish", async () => {
    // A non-default-locale edit whose `status` is present but not a string (e.g.
    // null) does not persist a companion `_status` — the split only writes a
    // string — so this locale's stored status is unchanged and the edit must not
    // be gated as an unpublish.
    const acs = allowUpdateDeny("unpublish");
    const { service, selectData, fileManager } = buildService({
      accessControlService: acs,
      // Lifecycle on, but no declared `status` field, so a non-string status is
      // not rejected by validation before it reaches the transition gate.
      collectionService: createMockCollectionService(
        createMockCollection({
          status: true,
          schemaDefinition: {
            fields: [{ name: "title", type: "text" }],
            accessRules: undefined,
            hooks: [],
            search: undefined,
          },
          fields: [{ name: "title", type: "text" }],
        })
      ),
      localization: normalizeLocalization({
        locales: ["en", "de"],
        defaultLocale: "en",
      }),
    });
    // Main row and German companion are both published.
    selectData.rows = [
      createSampleEntry({ status: "published", _status: "published" }),
    ];
    fileManager.loadCompanionSchema.mockResolvedValue({
      companionTableName: "posts_locales",
      table: {
        _parent: Symbol("_parent"),
        _locale: Symbol("_locale"),
        _status: Symbol("_status"),
      },
      localizedFields: [{ name: "title", column: "title" }],
      hasStatus: true,
    });

    const result = await service.updateEntry(
      {
        collectionName: "posts",
        entryId: "entry-1",
        user: { id: "user-1" },
        locale: "de",
      },
      { title: "just a translation edit", status: null }
    );

    expect(result.statusCode).not.toBe(403);
  });

  it("denies creating a document directly as published without publish", async () => {
    const acs = allowUpdateDeny("publish");
    const { service } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
    });

    const result = await service.createEntry(
      { collectionName: "posts", user: { id: "user-1" } },
      { title: "New", status: "published" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("gates a publish derived by a beforeCreate hook, not just the body", async () => {
    // Same secure-by-result rule on create: a hook that derives published from a
    // body omitting status still requires the publish permission.
    const acs = allowUpdateDeny("publish");
    const hookRegistry = createMockHookRegistry();
    hookRegistry.execute.mockImplementation((_phase: string, ctx: unknown) =>
      Promise.resolve({
        ...((ctx as { data?: Record<string, unknown> })?.data ?? {}),
        status: "published",
      })
    );
    const { service } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
      hookRegistry,
    });

    const result = await service.createEntry(
      { collectionName: "posts", user: { id: "user-1" } },
      { title: "Body omits status" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("allows creating a draft without publish", async () => {
    const acs = allowUpdateDeny("publish");
    const { service } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
    });

    const result = await service.createEntry(
      { collectionName: "posts", user: { id: "user-1" } },
      { title: "New draft", status: "draft" }
    );

    expect(result.statusCode).not.toBe(403);
  });

  it("bypasses the transition check under overrideAccess", async () => {
    // A trusted server write publishes without a publish permission, exactly as
    // it updates without an update permission.
    const acs = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
    });
    selectData.rows = [createSampleEntry({ status: "draft" })];

    const result = await service.updateEntry(
      {
        collectionName: "posts",
        entryId: "entry-1",
        overrideAccess: true,
      },
      { status: "published" }
    );

    expect(result.statusCode).not.toBe(403);
  });
  it("enforces publish via RBAC on a route-authorized REST write", async () => {
    // The route authorizes a document PATCH as `update`, never as `publish`.
    // So on the REST path (routeAuthorized) the publish permission must still
    // be checked at the service — the route never checked it. RBAC allows
    // update but denies publish; stored rules allow everything, so only the
    // RBAC publish check can produce the denial.
    const rbac = {
      checkAccess: vi.fn((args: { operation: string }) =>
        Promise.resolve(args.operation !== "publish")
      ),
    };
    const acs = createMockAccessControlService();
    acs.evaluateAccess.mockResolvedValue({ allowed: true });
    const { service, selectData } = buildService({
      accessControlService: acs,
      collectionService: lifecycle(),
      rbacAccessControlService: rbac,
    });
    selectData.rows = [createSampleEntry({ status: "draft" })];

    const result = await service.updateEntry(
      {
        collectionName: "posts",
        entryId: "entry-1",
        user: { id: "user-1" },
        routeAuthorized: true,
      },
      { status: "published" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(rbac.checkAccess).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "publish", resource: "posts" })
    );
  });
});
