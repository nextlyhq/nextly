// Regression tests for the single-dispatcher op-types. Pin the
// canonical Response shapes per spec §5.1 so the handlers cannot
// regress.
//
// Coverage target (one representative test per op-type):
//   respondList:     listSingles (paginated, offset/limit synthesised)
//   respondDoc:      getSingleSchema (bare doc); getSingleDocument unwrap path
//   respondMutation: createSingle (201), updateSingleDocument (200),
//                    updateSingleSchema (200)
//   respondAction:   deleteSingle (no record to surface; slug echoed)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The dispatcher resolves its services via DI helpers. Mock the helpers
// up-front so each test can drop in a fake registry/entry pair without
// real DI initialisation. The DI container module is also referenced by
// the create/delete paths for adapter access; we mock the bare minimum
// so those branches don't try to load a real adapter.
vi.mock("../../helpers/di", () => ({
  getSingleRegistryFromDI: vi.fn(),
  getSingleEntryServiceFromDI: vi.fn(),
  getSingleMetadataServiceFromDI: vi.fn(),
  getComponentRegistryFromDI: vi.fn().mockReturnValue(undefined),
  getAdapterFromDI: vi.fn(),
}));

// Observed at the reader the removed-from-code mark derives its state from:
// which entities a handler asks about, and that it hands back the answer.
vi.mock(
  "../../../domains/dynamic-collections/services/removed-from-code-state",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../domains/dynamic-collections/services/removed-from-code-state")
    >()),
    readRemovedFromCodeStates: vi.fn(),
  })
);

vi.mock("../../../di/container", () => ({
  container: {
    has: vi.fn().mockReturnValue(false),
    get: vi.fn(),
  },
}));

// createSingle constructs DynamicCollectionSchemaService eagerly to
// build migration SQL. Its constructor touches env validation, which
// blows up in this test environment. The container.has("adapter")
// branch is false (see the container mock above), so the migration SQL
// is never executed; we only need a no-op class shape that returns a
// string from generateMigrationSQL / generateAlterTableMigration.
vi.mock(
  "../../../domains/dynamic-collections/services/dynamic-collection-schema-service",
  () => {
    class FakeDynamicCollectionSchemaService {
      generateMigrationSQL() {
        return "";
      }
      generateAlterTableMigration() {
        return "";
      }
    }
    return {
      DynamicCollectionSchemaService: FakeDynamicCollectionSchemaService,
    };
  }
);

import { SingleMetadataService } from "../../../domains/singles/services/single-metadata-service";
import type { SingleRegistryService } from "../../../domains/singles/services/single-registry-service";
import type { Logger } from "../../../shared/types";
import {
  getAdapterFromDI,
  getSingleEntryServiceFromDI,
  getSingleMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
import {
  asCaller,
  keyCaller,
  sessionCaller,
} from "../../__tests__/request-caller";
import { readRemovedFromCodeStates } from "../../../domains/dynamic-collections/services/removed-from-code-state";
import { publishDeclaredEntities } from "../../../domains/dynamic-collections/services/removed-from-code-writes";
import { dispatchSingles } from "../single-dispatcher";

/** Silent: these tests read Response shapes, not the log. */
const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

type Registry = {
  listSingles: ReturnType<typeof vi.fn>;
  registerSingle: ReturnType<typeof vi.fn>;
  updateMigrationStatus: ReturnType<typeof vi.fn>;
  getSingleBySlug: ReturnType<typeof vi.fn>;
  getAllSingles: ReturnType<typeof vi.fn>;
  updateSingle: ReturnType<typeof vi.fn>;
  deleteSingle: ReturnType<typeof vi.fn>;
};
type Entry = {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function makeRegistry(overrides: Partial<Registry> = {}): Registry {
  return {
    listSingles: vi.fn(),
    registerSingle: vi.fn(),
    // A create persists its intent as `pending` and records the outcome here afterwards, so a
    // double without it fails the request rather than the assertion under test.
    updateMigrationStatus: vi.fn(),
    getSingleBySlug: vi.fn(),
    // Answers "no single owns that table" so a create reaches the path under test. The handler
    // asks before it emits any DDL, so a double that cannot answer fails the request instead.
    getAllSingles: vi.fn().mockResolvedValue([]),
    updateSingle: vi.fn(),
    deleteSingle: vi.fn(),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    get: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

function wireDi(registry: Registry, entry: Entry) {
  vi.mocked(getSingleRegistryFromDI).mockReturnValue(
    registry as unknown as ReturnType<typeof getSingleRegistryFromDI>
  );
  vi.mocked(getSingleEntryServiceFromDI).mockReturnValue(
    entry as unknown as ReturnType<typeof getSingleEntryServiceFromDI>
  );
  // The real service over the same double, with no adapter — which is the state this file puts the
  // container in, and the state that leaves a create recorded as `pending`. A stub here would make
  // the pending message an assumption of the test rather than a consequence of the code.
  vi.mocked(getSingleMetadataServiceFromDI).mockReturnValue(
    new SingleMetadataService(
      registry as unknown as SingleRegistryService,
      logger
    )
  );
}

beforeEach(() => {
  vi.mocked(getSingleRegistryFromDI).mockReset();
  vi.mocked(getSingleEntryServiceFromDI).mockReset();
  vi.mocked(getSingleMetadataServiceFromDI).mockReset();
});

describe("dispatchSingles, paginated lists (respondList)", () => {
  it("listSingles returns Response with { items, meta } body and 200 status", async () => {
    // Code-first singles bypass injectSingleDefaultFields, so we set
    // source: "code" to keep the items array byte-equal across the
    // round-trip and isolate the wire-shape assertion.
    const fakeSingles = [
      { slug: "site", source: "code" },
      { slug: "settings", source: "code" },
    ];
    const registry = makeRegistry({
      listSingles: vi.fn().mockResolvedValue({
        data: fakeSingles,
        total: 2,
      }),
    });
    wireDi(registry, makeEntry());

    const result = await dispatchSingles(
      "listSingles",
      { limit: "10", offset: "0" },
      undefined
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body).toEqual({
      items: fakeSingles,
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
  });
});

describe("dispatchSingles, single-doc reads (respondDoc)", () => {
  it("getSingleSchema returns bare doc body", async () => {
    const fakeSingle = {
      slug: "site",
      label: "Site",
      source: "code",
      fields: [],
    };
    const registry = makeRegistry({
      getSingleBySlug: vi.fn().mockResolvedValue(fakeSingle),
    });
    wireDi(registry, makeEntry());

    const result = await dispatchSingles(
      "getSingleSchema",
      { slug: "site" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    // source: "code" means injectSingleDefaultFields returns the fields
    // unchanged, so the body is the original doc plus ONE derived field.
    // `draftsEnabled` is not decoration: it is how the admin learns whether a
    // status-less save will be stored as a working draft or written live, and
    // draft-split-eligibility.ts is explicit that every call site must derive
    // it from the same predicate -- a divergence shows the editor one
    // behaviour while the server performs the other.
    expect(body).toEqual({ ...fakeSingle, draftsEnabled: false });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });

  it("getSingleDocument unwraps the SingleResult envelope to a bare doc", async () => {
    const fakeDoc = { id: "doc1", title: "Welcome" };
    const registry = makeRegistry();
    const entry = makeEntry({
      get: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        data: fakeDoc,
      }),
    });
    wireDi(registry, entry);

    const result = await dispatchSingles(
      "getSingleDocument",
      { slug: "site" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(fakeDoc);
    expect(body).not.toHaveProperty("data");
  });
});

describe("dispatchSingles getSingleDocument — status forwarding (Task 7 PR-5)", () => {
  // Why: regression coverage for the admin's "I created a Single via
  // UI and got 404" bug. Auto-create defaults the new doc to
  // status='draft'; without forwarding `?status=`, the public-default
  // filter hides the freshly-created Single from its own author. The
  // dispatcher must accept 'all'/'draft'/'published' from the query
  // string and pass it to entry.get(). Anything else is dropped to
  // protect against arbitrary string injection.
  it("forwards ?status=all to entry.get", async () => {
    const entryGet = vi.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: "x" },
    });
    wireDi(makeRegistry(), makeEntry({ get: entryGet }));

    await dispatchSingles(
      "getSingleDocument",
      { slug: "site", status: "all" },
      undefined
    );

    expect(entryGet).toHaveBeenCalledWith(
      "site",
      expect.objectContaining({ status: "all" })
    );
  });

  it("forwards ?status=draft and ?status=published to entry.get", async () => {
    const entryGet = vi.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: "x" },
    });
    wireDi(makeRegistry(), makeEntry({ get: entryGet }));

    await dispatchSingles(
      "getSingleDocument",
      { slug: "site", status: "draft" },
      undefined
    );
    await dispatchSingles(
      "getSingleDocument",
      { slug: "site", status: "published" },
      undefined
    );

    expect(entryGet).toHaveBeenNthCalledWith(
      1,
      "site",
      expect.objectContaining({ status: "draft" })
    );
    expect(entryGet).toHaveBeenNthCalledWith(
      2,
      "site",
      expect.objectContaining({ status: "published" })
    );
  });

  it("rejects an unknown status value with 400 and never reads", async () => {
    const entryGet = vi.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: "x" },
    });
    wireDi(makeRegistry(), makeEntry({ get: entryGet }));

    // An invalid status is rejected rather than silently widened to "all"
    // (which would leak a draft Single): the handler throws before reading.
    await expect(
      dispatchSingles(
        "getSingleDocument",
        { slug: "site", status: "lol-injection" },
        undefined
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(entryGet).not.toHaveBeenCalled();
  });

  it("omits status when ?status= is absent (preserves default published-only filter)", async () => {
    const entryGet = vi.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: "x" },
    });
    wireDi(makeRegistry(), makeEntry({ get: entryGet }));

    await dispatchSingles("getSingleDocument", { slug: "site" }, undefined);

    expect(entryGet).toHaveBeenCalledWith(
      "site",
      expect.objectContaining({ status: undefined })
    );
  });
});

describe("dispatchSingles, mutations (respondMutation)", () => {
  it("createSingle returns { message, item } body and 201 status", async () => {
    // The container mock returns has() => false, so the migration
    // branch is skipped and migrationStatus stays "pending". That
    // pins the message to the "pending" branch in the handler:
    //   `Single "${slug}" created. Run migrations to apply the table.`
    // The handler also auto-seeds permissions via
    // container.has("permissionSeedService"), which is also false here,
    // so the permission seed branch is skipped too.
    const fakeSingle = {
      slug: "site",
      label: "Site",
      tableName: "single_site",
      source: "ui",
      locked: false,
      fields: [{ name: "body", type: "text" }],
      schemaHash: "abc123",
      migrationStatus: "pending" as const,
    };
    const registry = makeRegistry({
      registerSingle: vi.fn().mockResolvedValue(fakeSingle),
    });
    wireDi(registry, makeEntry());

    const result = await dispatchSingles(
      "createSingle",
      {},
      {
        slug: "site",
        label: "Site",
        fields: [{ name: "body", type: "text" }],
      }
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body).toEqual({
      message: 'Single "site" created. Run migrations to apply the table.',
      item: fakeSingle,
    });
    // Regression guard: respondMutation does not nest under data.
    expect(body).not.toHaveProperty("data");
  });

  it("updateSingleDocument returns { message, item } body and 200 status", async () => {
    const fakeDoc = { id: "doc1", title: "Updated" };
    const registry = makeRegistry();
    const entry = makeEntry({
      update: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "Single updated successfully.",
        data: fakeDoc,
      }),
    });
    wireDi(registry, entry);

    const result = await dispatchSingles(
      "updateSingleDocument",
      { slug: "site" },
      { title: "Updated" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "Single updated successfully.",
      item: fakeDoc,
    });
    expect(body).not.toHaveProperty("data");
  });

  it("updateSingleDocument forwards the caller's roles into the user context", async () => {
    const registry = makeRegistry();
    const updateSpy = vi.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      message: "ok",
      data: { id: "doc1" },
    });
    wireDi(registry, makeEntry({ update: updateSpy }));

    await asCaller(sessionCaller({ userId: "u1", roles: ["editor"] }), () =>
      dispatchSingles(
        "updateSingleDocument",
        { slug: "site" },
        { title: "Updated" }
      )
    );

    // Field-level access.read redaction on the response must see the caller's
    // roles, so role-allowed fields are not stripped for an authorized editor.
    // The dispatcher runs the update as the real user with overrideAccess:false
    // (stored single access + field-level write access stay enforced);
    // routeAuthorized only elides the redundant RBAC re-check the middleware
    // already performed.
    expect(updateSpy).toHaveBeenCalledWith(
      "site",
      { title: "Updated" },
      expect.objectContaining({
        user: expect.objectContaining({ id: "u1", roles: ["editor"] }),
        overrideAccess: false,
        routeAuthorized: true,
      })
    );
  });

  it("updateSingleSchema returns { message, item } body and 200 status", async () => {
    const existing = {
      slug: "site",
      tableName: "single_site",
      locked: false,
      fields: [],
      migrationStatus: "applied" as const,
    };
    const updated = { ...existing, label: "Site (renamed)" };
    const registry = makeRegistry({
      getSingleBySlug: vi.fn().mockResolvedValue(existing),
      updateSingle: vi.fn().mockResolvedValue(updated),
    });
    wireDi(registry, makeEntry());

    const result = await dispatchSingles(
      "updateSingleSchema",
      { slug: "site" },
      { label: "Site (renamed)" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    // Without a fields update, migrationStatus stays "applied" so the
    // toast copy reflects the success branch.
    expect(body).toEqual({
      message:
        'Single "site" schema updated and migration applied successfully',
      item: updated,
    });
  });
});

describe("dispatchSingles, actions (respondAction)", () => {
  it("deleteSingle returns { message, slug } body and 200 status", async () => {
    const existing = {
      slug: "site",
      tableName: "single_site",
      locked: false,
      fields: [],
      migrationStatus: "applied" as const,
    };
    const registry = makeRegistry({
      getSingleBySlug: vi.fn().mockResolvedValue(existing),
      deleteSingle: vi.fn().mockResolvedValue(undefined),
    });
    wireDi(registry, makeEntry());

    const result = await dispatchSingles(
      "deleteSingle",
      { slug: "site" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: 'Single "site" deleted successfully',
      slug: "site",
    });
    // Regression guard: respondAction does not nest under data/item.
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });
});

// A Single's stored read rule can only be evaluated against a caller, so the
// read handler has to hand one over. Without it the service falls back to the
// rule-less default and the read setting an admin configured does nothing over
// HTTP, while the same rule already holds on the write paths and in the Direct
// API.
describe("dispatchSingles getSingleDocument — read access forwarding", () => {
  const okResult = {
    success: true,
    statusCode: 200,
    data: { id: "doc1", title: "Welcome" },
  };

  /** The caller the route handler sets once it has authenticated. */
  const authedFields = {
    userId: "u1",
    name: "Ada",
    email: "ada@example.com",
    roles: ["editor", "author"],
  };

  it("passes the authenticated user and attests route authorization", async () => {
    const entry = makeEntry({ get: vi.fn().mockResolvedValue(okResult) });
    wireDi(makeRegistry(), entry);

    await asCaller(sessionCaller(authedFields), () =>
      dispatchSingles("getSingleDocument", { slug: "site" }, undefined)
    );

    const options = entry.get.mock.calls[0][1];
    expect(options.user).toEqual({
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      roles: ["editor", "author"],
      // Rules and field callbacks written against a single-role model read
      // `user.role`; without it an authorized caller would have fields stripped.
      role: "editor",
    });
    // The route ran the coarse RBAC gate already, so it is not run again.
    expect(options.routeAuthorized).toBe(true);
  });

  it("sends no user for an anonymous caller", async () => {
    const entry = makeEntry({ get: vi.fn().mockResolvedValue(okResult) });
    wireDi(makeRegistry(), entry);

    await asCaller(undefined, () =>
      dispatchSingles("getSingleDocument", { slug: "site" }, undefined)
    );

    const options = entry.get.mock.calls[0][1];
    // An absent user must never be mistaken for a trusted one, and nothing
    // attests authorization on its behalf.
    expect(options.user).toBeUndefined();
    expect(options.routeAuthorized).toBe(false);
  });

  it("forwards the API-key scope so a scoped key is judged on its own grant", async () => {
    const entry = makeEntry({ get: vi.fn().mockResolvedValue(okResult) });
    wireDi(makeRegistry(), entry);

    // The key's own grant, pinned as its scope by the route handler.
    await asCaller(
      keyCaller("key-1", authedFields),
      () => dispatchSingles("getSingleDocument", { slug: "site" }, undefined),
      { actorType: "apiKey", permissions: ["singles:read"] }
    );

    const options = entry.get.mock.calls[0][1];
    // Without this a super-admin-owned key would take the owner's session
    // bypass and read past its own scope.
    expect(options.authenticatedScope).toEqual({
      actorType: "apiKey",
      permissions: ["singles:read"],
    });
  });
});

/**
 * A listing or schema read of a collection or Single removed from code (a
 * code row whose slug the published configuration no longer declares) marks
 * it, with where its retirement stands, and leaves every other row's body as
 * it was: a Builder row, a plugin row and a declared code row are never
 * marked. The state is the reader's answer, handed back as it is.
 */
const fakeRetirementAdapter = {
  dialect: "sqlite" as const,
  tableExists: vi.fn(),
  getDrizzle: vi.fn(),
};

function answerRemovedStates(): void {
  vi.mocked(readRemovedFromCodeStates).mockReset();
  vi.mocked(readRemovedFromCodeStates).mockImplementation(
    async ({ entities }) =>
      new Map(
        entities.map(entity => [
          `${entity.kind}:${entity.slug}`,
          entity.kind === "single"
            ? { state: "half-retired" as const }
            : { state: "drop-pending" as const, migration: "0002_drop.sql" },
        ])
      )
  );
}

describe("dispatchSingles, the removed-from-code mark", () => {
  const rows = [
    { slug: "settings", source: "code", tableName: "single_settings" },
    { slug: "banner", source: "code", tableName: "single_banner" },
    { slug: "footer", source: "ui", tableName: "single_footer" },
  ];
  const bodyOf = async (result: unknown) =>
    (await (result as Response).json()) as Record<string, unknown>;

  beforeEach(() => {
    publishDeclaredEntities({
      collections: [],
      singles: [{ slug: "settings" }],
    });
    vi.mocked(getAdapterFromDI).mockReturnValue(fakeRetirementAdapter as never);
    answerRemovedStates();
    wireDi(
      makeRegistry({
        listSingles: vi.fn().mockResolvedValue({ data: rows, total: 3 }),
        getSingleBySlug: vi.fn(async (slug: string) =>
          rows.find(row => row.slug === slug)
        ),
      }),
      makeEntry()
    );
  });

  afterEach(() => {
    publishDeclaredEntities(undefined);
    vi.mocked(getAdapterFromDI).mockReset();
  });

  it("listSingles marks the removed Single with its state, and no other", async () => {
    const body = await bodyOf(
      await dispatchSingles("listSingles", {}, undefined)
    );
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.map(item => [item.slug, item.removedFromCode])).toEqual([
      ["settings", undefined],
      ["banner", true],
      ["footer", undefined],
    ]);
    expect(items[1]!.removedFromCodeState).toEqual({ state: "half-retired" });
    expect(
      vi.mocked(readRemovedFromCodeStates).mock.calls[0]![0].entities
    ).toEqual([{ kind: "single", slug: "banner", tableName: "single_banner" }]);
  });

  it("getSingleSchema marks the removed Single, and leaves another as it was", async () => {
    expect(
      await bodyOf(
        await dispatchSingles("getSingleSchema", { slug: "banner" }, undefined)
      )
    ).toMatchObject({
      slug: "banner",
      removedFromCode: true,
      removedFromCodeState: { state: "half-retired" },
    });
    expect(
      await bodyOf(
        await dispatchSingles("getSingleSchema", { slug: "footer" }, undefined)
      )
    ).not.toHaveProperty("removedFromCode");
  });
});
