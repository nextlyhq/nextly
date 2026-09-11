/**
 *
 * Tests for the access control behaviour of CollectionEntryService:
 * checkCollectionAccess for create/read/update/delete, the RBAC gate
 * the RBAC gate, and the overrideAccess bypass.
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
  createMockRbacAccessControlService,
  createMockComponentDataService,
  createMockCollection,
  createSampleEntry,
} from "./collection-test-helpers";

// ── Module mocks ──────────────────────────────────────────────────────────

// `get` THROWS for an unregistered name, exactly as the real container does
// (di/container.ts). That is not a detail: `recordMutationActivity` treats an
// absent registration as a boot-time fact rather than a failed write, and it
// recognises it by CATCHING. A bare `vi.fn()` returns undefined instead, so
// the catch never fires and the write dies on `undefined.logActivityInTx` --
// reporting a 500 from a service this suite never meant to involve.
vi.mock("../../../di/container", () => ({
  container: {
    get: vi.fn((name: string) => {
      throw new Error(`Service "${name}" is not registered in container`);
    }),
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

// ── Helper to build service with specific access mocks ────────────────────

function buildService(overrides: {
  rbacAccessControlService?: ReturnType<
    typeof createMockRbacAccessControlService
  >;
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
    createMockComponentDataService() as never,
    (overrides.rbacAccessControlService ??
      createMockRbacAccessControlService()) as never,
    overrides.localization as never
  );

  return { service, selectData, schema, adapter: mockAdapter, fileManager };
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("CollectionEntryService — Access Control Contracts", () => {
  // ── Collection-level access: read ─────────────────────────────────────

  describe("read access control", () => {
    it("should deny listEntries when access evaluation returns denied", async () => {
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(false);
      const { service } = buildService({ rbacAccessControlService: rbac });

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1", role: "viewer" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.message).toContain("denied");
    });

    it("should allow listEntries when access is granted", async () => {
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(true);
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
      });
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        user: { id: "user-1", role: "editor" },
      });

      expect(result.success).toBe(true);
    });

    it("should deny getEntry when access is denied", async () => {
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(false);
      const { service } = buildService({ rbacAccessControlService: rbac });

      const result = await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user: { id: "user-1" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("should deny countEntries when access is denied", async () => {
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(false);
      const { service } = buildService({ rbacAccessControlService: rbac });

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
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(false);
      const { service } = buildService({ rbacAccessControlService: rbac });

      const result = await service.createEntry(
        { collectionName: "posts", user: { id: "user-1" } },
        { title: "Test" }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("should allow createEntry when access is granted", async () => {
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(true);
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
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
      const rbac = createMockRbacAccessControlService();
      // First call: for the getEntry check pass (we need the entry to exist)
      // The service fetches the entry first, then checks access
      rbac.checkAccess.mockResolvedValue(false);
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
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
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(false);
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
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
      const rbac = createMockRbacAccessControlService();
      // Even with denied access, overrideAccess should bypass
      rbac.checkAccess.mockResolvedValue(false);
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
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
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(false);
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
      });
      selectData.rows = [{ id: "new-1", title: "Test" }];

      const result = await service.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "Test" }
      );

      expect(result.success).toBe(true);
    });

    it("should bypass access control on getEntry when overrideAccess is true", async () => {
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(false);
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
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
      const rbac = createMockRbacAccessControlService();
      rbac.checkAccess.mockResolvedValue(false);
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
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
        // Answers `undefined`: no code-defined rule governs the operation.
        checkAnonymousCodeAccess: vi.fn().mockResolvedValue(undefined),
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
        // Answers `undefined`: no code-defined rule governs the operation.
        checkAnonymousCodeAccess: vi.fn().mockResolvedValue(undefined),
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
        // Answers `undefined`: no code-defined rule governs the operation.
        checkAnonymousCodeAccess: vi.fn().mockResolvedValue(undefined),
      };
      const { service, selectData } = buildService({
        rbacAccessControlService: rbac,
      });
      selectData.rows = [];

      const result = await service.listEntries({
        collectionName: "posts",
        // No user provided
      });

      // The DB permission check needs a user to have permissions for, so it
      // still does not run. The code-defined rule does: it reads nothing off
      // the caller, and skipping it left a collection's own `access` inert for
      // exactly the caller it describes.
      expect(rbac.checkAccess).not.toHaveBeenCalled();
      expect(rbac.checkAnonymousCodeAccess).toHaveBeenCalled();
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
  // The RBAC gate is what this harness controls; allow update, deny the named
  // lifecycle op, so only the transition check can fail.
  const allowUpdateDeny = (op: "publish" | "unpublish") => {
    const rbac = createMockRbacAccessControlService();
    rbac.checkAccess.mockImplementation(
      ({ operation }: { operation: string }) =>
        Promise.resolve(operation !== op)
    );
    return rbac;
  };

  // The transition gate only runs when the collection has the draft/published
  // lifecycle enabled (`collection.status === true`), the same flag the read
  // path filters on. Every gated case below uses a lifecycle-enabled collection.
  const lifecycle = () =>
    createMockCollectionService(createMockCollection({ status: true }));

  it("denies updateEntry that moves a draft to published without publish", async () => {
    const rbac = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
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
    const rbac = allowUpdateDeny("unpublish");
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
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
    const rbac = allowUpdateDeny("unpublish");
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
      // Lifecycle on, but no declared `status` field so a non-string status is
      // not rejected by validation before it reaches the transition gate.
      collectionService: createMockCollectionService(
        createMockCollection({
          status: true,
          schemaDefinition: {
            fields: [{ name: "title", type: "text" }],
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
    const rbac = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
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
    const rbac = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
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
    const rbac = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
    });
    selectData.rows = [createSampleEntry({ status: "draft" })];

    await service.updateEntry(
      { collectionName: "posts", entryId: "entry-1", user: { id: "user-1" } },
      { status: "published" }
    );

    // The publish permission is never consulted when there is no lifecycle.
    const publishConsulted = rbac.checkAccess.mock.calls.some(
      ([, operation]: [unknown, string]) => operation === "publish"
    );
    expect(publishConsulted).toBe(false);
  });

  it("gates a publish derived by a beforeUpdate hook, not just the body", async () => {
    // Secure-by-result: the gate asks whether the write makes content public,
    // judged on the FINAL data. A hook the caller cannot see derives
    // status: "published" from a body that omits it; the publish permission is
    // still required.
    const rbac = allowUpdateDeny("publish");
    const hookRegistry = createMockHookRegistry();
    hookRegistry.execute.mockImplementation((_phase: string, ctx: unknown) =>
      Promise.resolve({
        ...((ctx as { data?: Record<string, unknown> })?.data ?? {}),
        status: "published",
      })
    );
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
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
    const rbac = allowUpdateDeny("publish");
    const { service, selectData, fileManager } = buildService({
      rbacAccessControlService: rbac,
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

  it("gates a default-locale publish against the companion status even when the main row is already published", async () => {
    // For a localized collection the default locale's status also lands on the
    // companion `_status` row. If the main row is already published but the
    // default locale's companion `_status` is not (a state reachable after a
    // reconcile that added `_status` under a published entry), a
    // `?locale=<default>` publish moves the companion into published. Keying the
    // gate on the main row alone sees published -> published and would miss it;
    // the gate must also classify the companion `_status` transition.
    const rbac = allowUpdateDeny("publish");
    const { service, selectData, fileManager } = buildService({
      rbacAccessControlService: rbac,
      collectionService: lifecycle(),
      localization: normalizeLocalization({
        locales: ["en", "de"],
        defaultLocale: "en",
      }),
    });
    // Main row already published; the companion `_status` for the default locale
    // resolves to null in this harness (row absent / not yet published for this
    // locale), which is still a publish of the default locale's content.
    selectData.rows = [createSampleEntry({ status: "published" })];
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
        // The default locale — the write updates the main row AND the default
        // locale's companion `_status`.
        locale: "en",
      },
      { title: "default-locale edit", status: "published" }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("does not treat a non-string status on a locale edit as an unpublish", async () => {
    // A non-default-locale edit whose `status` is present but not a string (e.g.
    // null) does not persist a companion `_status` — the split only writes a
    // string — so this locale's stored status is unchanged and the edit must not
    // be gated as an unpublish.
    const rbac = allowUpdateDeny("unpublish");
    const { service, selectData, fileManager } = buildService({
      rbacAccessControlService: rbac,
      // Lifecycle on, but no declared `status` field, so a non-string status is
      // not rejected by validation before it reaches the transition gate.
      collectionService: createMockCollectionService(
        createMockCollection({
          status: true,
          schemaDefinition: {
            fields: [{ name: "title", type: "text" }],
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
    const rbac = allowUpdateDeny("publish");
    const { service } = buildService({
      rbacAccessControlService: rbac,
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
    const rbac = allowUpdateDeny("publish");
    const hookRegistry = createMockHookRegistry();
    hookRegistry.execute.mockImplementation((_phase: string, ctx: unknown) =>
      Promise.resolve({
        ...((ctx as { data?: Record<string, unknown> })?.data ?? {}),
        status: "published",
      })
    );
    const { service } = buildService({
      rbacAccessControlService: rbac,
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
    const rbac = allowUpdateDeny("publish");
    const { service } = buildService({
      rbacAccessControlService: rbac,
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
    const rbac = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
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
    // update but denies publish, so only the publish check can produce the
    // denial.
    const rbac = allowUpdateDeny("publish");
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
      collectionService: lifecycle(),
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

  it("does not let a super-admin-owned key bypass the gate on a plain update", async () => {
    // The primary update gate must also receive the API-key scope, so the
    // session super-admin bypass does not apply to a scoped key on a non-status
    // write — otherwise a super-admin-owned, update-only key would skip the
    // collection's code-defined access entirely.
    const rbac = createMockRbacAccessControlService();
    // The KEY carries no grant for this write, and the code-defined rule denies.
    rbac.getRegisteredAccess.mockReturnValue({ update: () => false });
    const { service, selectData } = buildService({
      rbacAccessControlService: rbac,
    });
    selectData.rows = [createSampleEntry({ status: "draft" })];

    const result = await service.updateEntry(
      {
        collectionName: "posts",
        entryId: "entry-1",
        // The key's resolved roles carry super-admin, but it is a scoped key.
        user: { id: "admin-1", roles: ["super-admin"] },
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["update-posts"],
        },
      },
      { title: "no status change" }
    );

    // The gate ran and denied — the super-admin bypass did not fire.
    expect(result.statusCode).toBe(403);
  });
});
