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
/**
 * Every string the built condition carries — identifiers and bound values.
 *
 * A localized member does not compile to a main-table column, so
 * {@link columnsIn} cannot see it: it becomes an EXISTS against the companion,
 * naming that table and binding the rule's value. Those strings are what
 * distinguishes a predicate that was APPLIED from one that was silently
 * dropped, and a mock database returning fixed rows cannot tell the two apart
 * on the response alone.
 */
function literalsIn(node: unknown, found = new Set<string>()): Set<string> {
  if (typeof node === "string") {
    found.add(node);
    return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) literalsIn(child, found);
    return found;
  }
  if (node && typeof node === "object") {
    for (const child of Object.values(node)) literalsIn(child, found);
  }
  return found;
}

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

  /**
   * Every predicate a read built, in the order it built them.
   *
   * `createMockDb` hands every `select()` the same chain, so a list read
   * records the page and the total it takes for `totalDocs` here in that order,
   * and {@link filteredColumns} returns their UNION. That union cannot answer
   * the question this suite exists for: an implementation that dropped the
   * predicate from the page and kept it on the count returns the rows the rule
   * withholds and still satisfies it.
   *
   * Reading `calls[0]` alone is NOT the fix, and the reason is worth keeping.
   * A page with no surviving conditions builds no `WHERE` at all, so it records
   * NOTHING and `calls[0]` is then the count's own predicate — the unfiltered
   * page reads as filtered, which is the same false pass one level down.
   * Measured: dropping the access predicate from the page takes this from two
   * calls to one, both of them carrying the rule's columns.
   *
   * So a caller asserts the COUNT of predicates as well as their contents.
   */
  function whereCalls(): unknown[] {
    return mockDb._selectChain.where.mock.calls.map((c: unknown[]) => c[0]);
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

    it("listEntries filters the PAGE by every column the rule named", async () => {
      await service.listEntries({ collectionName: "posts", user });

      // Two predicates: the page, then the total it takes for `totalDocs`.
      // Asserted because a page that filters on nothing builds no `WHERE` and
      // silently leaves the count's predicate as `calls[0]` — the rows reaching
      // the caller would be unfiltered while this still read as filtered.
      const built = whereCalls();
      expect(built).toHaveLength(2);

      // The PAGE's own predicate. The rows are what reach the caller, so a
      // constraint present only on the total still returns every withheld row.
      const pageColumns = columnsIn([built[0]]);
      expect(pageColumns).toContain(schema.tenant_id);
      expect(pageColumns).toContain(schema.price);
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

  // ── A rule that decides FROM the document id ─────────────────────────────

  describe("a custom read rule that reads the document id", () => {
    /**
     * The rule answers only when it is told which document is being judged.
     *
     * `CustomAccessFunction` receives the id, so a rule may legitimately decide
     * from it. That makes the id part of the QUESTION rather than a detail of
     * one caller: a read by id that asks the coarse gate with the id and then
     * resolves its row predicate without it has asked two different questions
     * and has to reconcile two different answers.
     */
    function buildIdDependent() {
      build(
        { read: { type: "custom", functionPath: "./permitted-id" } },
        TENANT_CONSTRAINT
      );
      const accessControlService = (
        service as unknown as {
          accessService: { accessControlService: { evaluateAccess: unknown } };
        }
      ).accessService.accessControlService;
      accessControlService.evaluateAccess = vi
        .fn()
        .mockImplementation((...args: unknown[]) => {
          // Signature: (rules, operation, context, documentId, document, ownerField)
          const documentId = args[3];
          return Promise.resolve(
            documentId === "entry-1"
              ? { allowed: true, query: TENANT_CONSTRAINT }
              : { allowed: false, reason: "not the permitted document" }
          );
        });
      return accessControlService as {
        evaluateAccess: { mock: { calls: unknown[][] } };
      };
    }

    it("getEntry resolves the predicate with the id it was given", async () => {
      buildIdDependent();

      const result = await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user,
      });

      // The rule ALLOWS this document. Resolving the predicate without the id
      // re-asks the same rule about no document at all, which it denies — and
      // the denial is raised, so an authorized read fails.
      expect(result.success).toBe(true);
    });

    it("asks the rule about the document under read, on every evaluation", async () => {
      const acs = buildIdDependent();

      await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user,
      });

      // Asserted over the calls the service actually made rather than over the
      // outcome: an implementation that reached the right answer while asking
      // about `undefined` somewhere is the state this guards against.
      const ids = acs.evaluateAccess.mock.calls.map(c => c[3]);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every(id => id === "entry-1")).toBe(true);
    });
  });

  // ── A rule naming a LOCALIZED field ──────────────────────────────────────

  describe("a custom read rule that names a localized field", () => {
    /** The rule filters on `region`, which lives only on the companion. */
    const LOCALIZED_CONSTRAINT = { region: { equals: "emea" } };

    /**
     * A localized collection: two locales and a companion carrying `region`.
     *
     * The column is deliberately absent from the main schema, because that is
     * what makes this the case under test — the field is unknown to the table
     * and knowable only through the companion context.
     */
    function buildLocalized() {
      build(
        { read: { type: "custom", functionPath: "./region-scope" } },
        LOCALIZED_CONSTRAINT
      );
      const fileManager = (
        service as unknown as {
          queryService: { fileManager: { loadCompanionSchema: unknown } };
        }
      ).queryService.fileManager;
      fileManager.loadCompanionSchema = vi.fn().mockResolvedValue({
        table: { region: Symbol("dc_locales.region") },
        companionTableName: "posts_locales",
        localizedFields: [{ name: "region", column: "region" }],
        hasStatus: false,
        hasUpdatedAt: true,
      });
      const queryService = (
        service as unknown as { queryService: { localization: unknown } }
      ).queryService;
      // The SANITIZED shape: every field present and `fallbackLocale` an
      // array. A partial fixture throws inside locale resolution long before
      // the predicate is built, and the read then answers 500 — which passes a
      // "not 403" assertion while testing nothing.
      queryService.localization = {
        locales: [
          { code: "en", label: "English", rtl: false, fallbackLocale: [] },
          { code: "fr", label: "French", rtl: false, fallbackLocale: ["en"] },
        ],
        defaultLocale: "en",
        fallback: true,
      };
    }

    it("getEntry admits the row the listing admits", async () => {
      buildLocalized();

      const result = await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user,
        locale: "en",
      });

      // Asserted POSITIVELY. `not.toBe(403)` is satisfied by a 500 as well,
      // and a malformed fixture that throws inside locale resolution answers
      // exactly that — the test would then pass while never reaching the
      // predicate it exists to judge.
      //
      // Judged without the companion context the field lives in, the shared
      // translator reports `region` as an unknown column and the read refuses.
      // The listing binds the same member as a companion EXISTS, so a refusal
      // here is the two paths answering differently for one rule.
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);

      // Admitting the read is only half of it. The mock database returns
      // `selectData.rows` without evaluating any SQL, so an implementation that
      // silently DROPPED the localized member would answer 200 here too — and
      // would return exactly the rows the rule excludes. So the predicate is
      // read off the query that was built: the companion table it filters
      // through, and the value the rule bound.
      const built = literalsIn(whereCalls()[0]);
      expect(built).toContain("posts_locales");
      expect(built).toContain("emea");
    });

    it("listEntries admits it too, which is the control", async () => {
      buildLocalized();

      const result = await service.listEntries({
        collectionName: "posts",
        user,
        locale: "en",
      });

      // Establishes that this constraint IS bindable, so the assertion above
      // reads as a divergence rather than as a rule nothing can express.
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });
  });

  // ── A refusal reports the same status on every path ──────────────────────

  describe("an untranslatable constraint refuses with the same status", () => {
    /** Names a column the schema does not carry, so it cannot be expressed. */
    const UNTRANSLATABLE = { secret_col: { equals: "x" } };

    it("getEntry answers 403, not a server fault", async () => {
      build(
        { read: { type: "custom", functionPath: "./tenant-scope" } },
        UNTRANSLATABLE
      );

      const result = await service.getEntry({
        collectionName: "posts",
        entryId: "entry-1",
        user,
      });

      expect(result.success).toBe(false);
      // The by-id path refuses through the same helper the listing uses, so it
      // owes the caller the same answer. Reporting a rule refusal as 500 tells
      // a client to retry something that will never succeed.
      expect(result.statusCode).toBe(403);
    });

    it("listEntries answers 403 for the same rule", async () => {
      build(
        { read: { type: "custom", functionPath: "./tenant-scope" } },
        UNTRANSLATABLE
      );

      const result = await service.listEntries({
        collectionName: "posts",
        user,
      });

      // The control: the status the by-id path has to match.
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
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
