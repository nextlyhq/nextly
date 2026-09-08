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

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  getSingleEntryServiceFromDI,
  getSingleMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
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

  it("updateSingleDocument forwards decoded roles into the user context", async () => {
    const registry = makeRegistry();
    const updateSpy = vi.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      message: "ok",
      data: { id: "doc1" },
    });
    wireDi(registry, makeEntry({ update: updateSpy }));

    await dispatchSingles(
      "updateSingleDocument",
      {
        slug: "site",
        _authenticatedUserId: "u1",
        _authenticatedUserRoles: JSON.stringify(["editor"]),
      },
      { title: "Updated" }
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

  /** The reserved params the route handler stamps once it has authenticated. */
  const authedParams = {
    slug: "site",
    _authenticatedUserId: "u1",
    _authenticatedUserName: "Ada",
    _authenticatedUserEmail: "ada@example.com",
    _authenticatedUserRoles: JSON.stringify(["editor", "author"]),
  };

  it("passes the authenticated user and attests route authorization", async () => {
    const entry = makeEntry({ get: vi.fn().mockResolvedValue(okResult) });
    wireDi(makeRegistry(), entry);

    await dispatchSingles("getSingleDocument", { ...authedParams }, undefined);

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
    // The route ran the coarse RBAC gate already; the stored rule still runs.
    expect(options.routeAuthorized).toBe(true);
  });

  it("sends no user for an anonymous caller", async () => {
    const entry = makeEntry({ get: vi.fn().mockResolvedValue(okResult) });
    wireDi(makeRegistry(), entry);

    await dispatchSingles("getSingleDocument", { slug: "site" }, undefined);

    const options = entry.get.mock.calls[0][1];
    // An absent user must never be mistaken for a trusted one, and nothing
    // attests authorization on its behalf.
    expect(options.user).toBeUndefined();
    expect(options.routeAuthorized).toBe(false);
  });

  it("forwards the API-key scope so a scoped key is judged on its own grant", async () => {
    const entry = makeEntry({ get: vi.fn().mockResolvedValue(okResult) });
    wireDi(makeRegistry(), entry);

    await dispatchSingles(
      "getSingleDocument",
      {
        ...authedParams,
        _authenticatedActorType: "apiKey",
        _authenticatedActorId: "key-1",
        _authenticatedPermissions: JSON.stringify(["singles:read"]),
      },
      undefined
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
