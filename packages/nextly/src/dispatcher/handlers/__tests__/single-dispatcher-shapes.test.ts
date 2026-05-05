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

import {
  getSingleEntryServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
import { dispatchSingles } from "../single-dispatcher";

type Registry = {
  listSingles: ReturnType<typeof vi.fn>;
  registerSingle: ReturnType<typeof vi.fn>;
  getSingleBySlug: ReturnType<typeof vi.fn>;
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
    getSingleBySlug: vi.fn(),
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
}

beforeEach(() => {
  vi.mocked(getSingleRegistryFromDI).mockReset();
  vi.mocked(getSingleEntryServiceFromDI).mockReset();
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
    // source: "code" means injectSingleDefaultFields returns input
    // unchanged, so the bare body is the original doc.
    expect(body).toEqual(fakeSingle);
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
