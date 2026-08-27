/**
 * The three read paths must narrow rows by the SAME stored read rule.
 *
 * `listEntries`, `countEntries` and `getEntry` each fold the collection's read
 * rule into their SQL `WHERE`. A rule that narrows a listing and not a read by
 * id is worse than no rule at all: the caller cannot see the row in any list
 * and can still fetch it by guessing its id, which is the id-iteration leak the
 * predicate exists to close.
 *
 * The rule engine emits that predicate through one channel — `evaluateAccess`'s
 * `query` — for `owner-only` reads AND for a `custom` function returning an
 * object, a documented `CustomAccessFunction` return. `owner-only` is the case
 * both shapes of the predicate happen to agree on, so it is asserted here as
 * the control rather than as the coverage: a path can pass it while ignoring
 * every other rule that emits a constraint.
 *
 * Deliberately its own file, not part of `collection-query.test.ts`: that suite
 * mocks `query-operators`, so `buildWhereClause` returns null there and a
 * constraint could never reach a condition. These tests run the real
 * translation and read the predicate off the query the service actually built.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import { CollectionAccessService } from "../services/collection-access-service";

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
} from "./collection-test-helpers";

vi.mock("../../../di/container", () => ({
  container: { get: vi.fn(), has: vi.fn().mockReturnValue(false) },
}));

vi.mock("../../../database/index", () => ({
  getDialectTables: vi.fn(() => ({})),
}));

// The rule's predicate, as `evaluateAccess` emits it. Two members and a
// non-`equals` operator on purpose: a path that reads a single `equals` off the
// first key returns rows the rule excludes, and would pass a one-member fixture.
const TENANT_CONSTRAINT = {
  tenant_id: { equals: "tenant-1" },
  price: { greater_than: 10 },
};

const OWNER_CONSTRAINT = { created_by: { equals: "user-1" } };

const user = { id: "user-1", roles: ["editor"] };

/**
 * Every column the predicate names, as it reaches the compiled condition.
 *
 * The mock schema's columns are Symbols, and Drizzle embeds the column object
 * itself in the SQL it builds, so the symbols present in the built condition
 * are exactly the columns the read will filter on. Walking the built object is
 * what makes the assertion about the QUERY rather than about a call the service
 * made on the way there.
 */
function columnsIn(node: unknown, found = new Set<symbol>()): Set<symbol> {
  if (typeof node === "symbol") {
    found.add(node);
    return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) columnsIn(child, found);
    return found;
  }
  if (node && typeof node === "object") {
    for (const child of Object.values(node)) columnsIn(child, found);
  }
  return found;
}

describe("read paths narrow by the same stored read rule", () => {
  let service: CollectionEntryService;
  let schema: ReturnType<typeof createMockSchema> & {
    tenant_id: symbol;
    created_by: symbol;
  };
  let selectData: { rows: unknown[] };
  let mockDb: ReturnType<typeof createMockDb>;

  /** Builds the service around a read rule and the predicate it emits. */
  function build(
    accessRules: Record<string, unknown>,
    constraint: Record<string, unknown>
  ) {
    schema = {
      ...createMockSchema(),
      tenant_id: Symbol("dc.tenant_id"),
      created_by: Symbol("dc.created_by"),
    } as typeof schema;
    selectData = { rows: [{ id: "entry-1", title: "t" }] };
    mockDb = createMockDb(selectData);

    const accessControlService = createMockAccessControlService();
    // The single channel both constraint methods read. `allowed` is what the
    // coarse gate consults and `query` is the predicate the row filter needs —
    // returning both is what a rule that narrows rather than refuses looks like.
    accessControlService.evaluateAccess = vi
      .fn()
      .mockResolvedValue({ allowed: true, query: constraint });

    service = new CollectionEntryService(
      createMockAdapter(mockDb) as never,
      silentLogger as never,
      createMockFileManager(schema) as never,
      createMockCollectionService(
        createMockCollection({ accessRules })
      ) as never,
      createMockRelationshipService() as never,
      createMockHookRegistry() as never,
      accessControlService as never,
      createMockComponentDataService() as never,
      undefined
    );
  }

  /**
   * The columns the query the service built will actually filter on.
   *
   * No `where` call at all is a legitimate answer — an unfiltered read builds
   * no predicate — so this returns the empty set rather than asserting one was
   * made. A test reading absence from it therefore has to establish separately
   * that this harness DOES report the column when the predicate is applied;
   * every such test below asserts the presence case first, in the same run.
   */
  function filteredColumns(): Set<symbol> {
    const calls = mockDb._selectChain.where.mock.calls;
    return columnsIn(calls.map((c: unknown[]) => c[0]));
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── The rule type the two predicate shapes agree on ──────────────────────

  describe("owner-only read rule (control)", () => {
    beforeEach(() => {
      build({ read: { type: "owner-only" } }, OWNER_CONSTRAINT);
    });

    it("listEntries filters by the owner column", async () => {
      await service.listEntries({ collectionName: "posts", user });
      expect(filteredColumns()).toContain(schema.created_by);
    });

    it("getEntry filters by the owner column", async () => {
      await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user,
      });
      expect(filteredColumns()).toContain(schema.created_by);
    });
  });

  // ── The rule type that separates a real predicate from an owner check ────

  describe("custom read rule returning a query constraint", () => {
    beforeEach(() => {
      build(
        { read: { type: "custom", functionPath: "./tenant-scope" } },
        TENANT_CONSTRAINT
      );
    });

    it("listEntries filters by every column the rule named", async () => {
      await service.listEntries({ collectionName: "posts", user });

      const columns = filteredColumns();
      expect(columns).toContain(schema.tenant_id);
      expect(columns).toContain(schema.price);
    });

    it("getEntry filters by every column the rule named", async () => {
      await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user,
      });

      // Without this the row is returned to a caller no listing would show it
      // to, and an id is all it takes to reach it.
      const columns = filteredColumns();
      expect(columns).toContain(schema.tenant_id);
      expect(columns).toContain(schema.price);
    });

    it("countEntries filters by every column the rule named", async () => {
      await service.countEntries({ collectionName: "posts", user });

      // A total taken under a weaker predicate than the rows describes rows the
      // list correctly withheld.
      const columns = filteredColumns();
      expect(columns).toContain(schema.tenant_id);
      expect(columns).toContain(schema.price);
    });
  });

  // ── The bypasses, which must stay identical across the three paths ───────

  describe("bypasses apply to the by-id path as they do to the list path", () => {
    beforeEach(() => {
      build(
        { read: { type: "custom", functionPath: "./tenant-scope" } },
        TENANT_CONSTRAINT
      );
    });

    it("overrideAccess lifts the predicate on both paths", async () => {
      // The presence case first, so the absences below are read from a harness
      // that has just been shown to report this column. Without it "no tenant
      // filter" is satisfied by a read that never reached the rule at all.
      await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user,
      });
      expect(filteredColumns()).toContain(schema.tenant_id);

      mockDb._selectChain.where.mockClear();

      await service.listEntries({
        collectionName: "posts",
        user,
        overrideAccess: true,
      });
      expect(filteredColumns()).not.toContain(schema.tenant_id);

      mockDb._selectChain.where.mockClear();

      await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user,
        overrideAccess: true,
      });
      expect(filteredColumns()).not.toContain(schema.tenant_id);
    });

    it("a super-admin-owned scoped API key keeps the predicate on both paths", async () => {
      const superAdmin = { id: "user-1", roles: ["super-admin"] };
      const authenticatedScope = {
        actorType: "apiKey" as const,
        permissions: ["read-posts"],
      };

      await service.listEntries({
        collectionName: "posts",
        user: superAdmin,
        routeAuthorized: true,
        authenticatedScope,
      });
      expect(filteredColumns()).toContain(schema.tenant_id);

      mockDb._selectChain.where.mockClear();

      // The key is authoritative on its own grant, never on its owner's roles —
      // so the session super-admin bypass must not lift the predicate here
      // either.
      await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user: superAdmin,
        routeAuthorized: true,
        authenticatedScope,
      });
      expect(filteredColumns()).toContain(schema.tenant_id);
    });
  });

  // ── The constraint methods themselves ────────────────────────────────────

  describe("the access service emits one predicate for both shapes", () => {
    it("getAccessQueryConstraint returns a custom rule's constraint", async () => {
      build(
        { read: { type: "custom", functionPath: "./tenant-scope" } },
        TENANT_CONSTRAINT
      );
      const access = (
        service as unknown as { accessService: CollectionAccessService }
      ).accessService;

      expect(
        await access.getAccessQueryConstraint("posts", user, false)
      ).toEqual(TENANT_CONSTRAINT);
    });

    it("getOwnerConstraint cannot express one, which is why reads must not use it", async () => {
      build(
        { read: { type: "custom", functionPath: "./tenant-scope" } },
        TENANT_CONSTRAINT
      );
      const access = (
        service as unknown as { accessService: CollectionAccessService }
      ).accessService;

      // It answers only `owner-only`, and returns a flat `{field, value}` pair
      // that a multi-member or non-`equals` predicate has no shape for. It is
      // correct for the write paths that fold one equality into an UPDATE or
      // DELETE; it is not the question a read asks.
      expect(
        await access.getOwnerConstraint("posts", "read", user, false)
      ).toBeNull();
    });
  });
});
