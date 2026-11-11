// Regression tests for the component-dispatcher op-types. Pin the
// canonical Response shapes per spec §5.1 so the handlers cannot
// regress.
//
// Coverage target (one representative test per op-type):
//   respondList:     listComponents (paginated, offset/limit synthesised)
//   respondDoc:      getComponent (bare doc body)
//   respondMutation: createComponent (201), updateComponent (200)
//   respondAction:   deleteComponent (no record to surface; slug echoed)

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getComponentRegistryFromDI: vi.fn(),
  getFieldGroupMetadataServiceFromDI: vi.fn(),
  getAdapterFromDI: vi.fn(),
  getLoggerFromDI: vi.fn(),
}));

// The field lists a list's use counts are read from, answered by each test.
const readFieldOwners = vi.hoisted(() => vi.fn());
vi.mock(
  "../../../domains/collections/services/collection-dependents",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../domains/collections/services/collection-dependents")
    >()),
    readFieldOwners,
  })
);

// Who is reading, and what their lists let them read. No reader by default,
// as outside a request; the tests about a reader set one.
const readAuthenticatedUser = vi.hoisted(() => vi.fn());
vi.mock("../../helpers/authenticated-user", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../helpers/authenticated-user")
  >()),
  readAuthenticatedUser,
}));
const readableSlugsOfKind = vi.hoisted(() => vi.fn());
vi.mock(
  "../../../services/lib/readable-slug-allowlist",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../services/lib/readable-slug-allowlist")
    >()),
    readableSlugsOfKind,
  })
);

vi.mock("../../../di/container", () => ({
  container: {
    has: vi.fn().mockReturnValue(false),
    get: vi.fn(),
  },
}));

import { FieldGroupMetadataService } from "../../../domains/field-groups/services/field-group-metadata-service";
import type { FieldGroupRegistryService } from "../../../services/field-groups/field-group-registry-service";
import {
  getAdapterFromDI,
  getComponentRegistryFromDI,
  getFieldGroupMetadataServiceFromDI,
  getLoggerFromDI,
} from "../../helpers/di";
import { NextlyError } from "../../../errors";
import { dispatchComponents } from "../component-dispatcher";

type Registry = {
  listComponents: ReturnType<typeof vi.fn>;
  registerComponent: ReturnType<typeof vi.fn>;
  getComponent: ReturnType<typeof vi.fn>;
  getComponentForWrite: ReturnType<typeof vi.fn>;
  updateComponent: ReturnType<typeof vi.fn>;
  deleteComponent: ReturnType<typeof vi.fn>;
  getComponentBySlug: ReturnType<typeof vi.fn>;
  getAllComponents: ReturnType<typeof vi.fn>;
  getAllFieldLists: ReturnType<typeof vi.fn>;
  isLocked: ReturnType<typeof vi.fn>;
};

function makeRegistry(overrides: Partial<Registry> = {}): Registry {
  return {
    listComponents: vi.fn(),
    registerComponent: vi.fn(),
    getComponent: vi.fn(),
    // An update reads the component as stored, past the registry row cache.
    getComponentForWrite: vi.fn(),
    updateComponent: vi.fn(),
    deleteComponent: vi.fn(),
    // Answers "no such slug" so a create reaches the path under test. The handler asks before it
    // converges any schema, so a double that cannot answer fails the request instead.
    getComponentBySlug: vi.fn().mockResolvedValue(null),
    // Answers "no field group owns that table" so a create reaches the path under test. The
    // handler asks before it emits any DDL, so a double that cannot answer fails the request.
    getAllComponents: vi.fn().mockResolvedValue([]),
    // No field group stored, so a save's cycle check finds nothing to close a cycle with.
    getAllFieldLists: vi.fn().mockResolvedValue([]),
    isLocked: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

/**
 * Wire the dispatcher's two dependencies and hand back the SERVICE.
 *
 * Returned rather than kept private because delegation is a claim about which object the handler
 * called, and only the service can witness it: the registry is reached either way, so observing
 * the registry alone answers "was the row written" and not "who wrote it".
 */
function wireRegistry(registry: Registry) {
  vi.mocked(getComponentRegistryFromDI).mockReturnValue(
    registry as unknown as ReturnType<typeof getComponentRegistryFromDI>
  );
  // The real service with NO adapter, which is this suite's own premise: the create generates its
  // statements and runs none, so these stay tests of the response shape rather than of DDL.
  const service = new FieldGroupMetadataService(
    registry as unknown as FieldGroupRegistryService,
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  );
  vi.mocked(getFieldGroupMetadataServiceFromDI).mockReturnValue(service);
  return service;
}

beforeEach(() => {
  vi.mocked(getComponentRegistryFromDI).mockReset();
  vi.mocked(getAdapterFromDI).mockReturnValue(undefined);
});

describe("listComponents, the page the admin asks for", () => {
  /**
   * The admin's list asks by 1-based `page`, as every list's shared query builder writes it. Read
   * as an offset, so the second page is the second page: ignored, every page was the first.
   */
  it("reads a 1-based page as the offset of that page", async () => {
    const listComponents = vi.fn().mockResolvedValue({ data: [], total: 25 });
    wireRegistry(makeRegistry({ listComponents }));

    const response = (await dispatchComponents(
      "listComponents",
      { limit: "10", page: "2" },
      undefined
    )) as Response;

    expect(listComponents.mock.calls[0]?.[0]).toMatchObject({
      limit: 10,
      offset: 10,
    });
    const body = (await response.json()) as {
      meta: { page: number; hasNext: boolean };
    };
    expect(body.meta.page).toBe(2);
    expect(body.meta.hasNext).toBe(true);
  });

  it("lets an explicit offset win over a page", async () => {
    const listComponents = vi.fn().mockResolvedValue({ data: [], total: 0 });
    wireRegistry(makeRegistry({ listComponents }));

    await dispatchComponents(
      "listComponents",
      { limit: "10", page: "3", offset: "5" },
      undefined
    );

    expect(listComponents.mock.calls[0]?.[0]?.offset).toBe(5);
  });
});

describe("listComponents, the migrationStatus filter", () => {
  /**
   * The filter has to reach the DATABASE. Applied client-side to one page it can only search that
   * page, so selecting "diverged" shows an empty table whenever the diverged group sits on another
   * one — hiding the state an operator opened the screen to find.
   *
   * Observed on the registry call rather than reconstructed in the test, so it keeps watching the
   * line it is about: a handler that stopped forwarding the filter would still satisfy any
   * assertion built from a hand-copied argument list.
   */
  it("forwards the status to the registry rather than filtering a page", async () => {
    const listComponents = vi.fn().mockResolvedValue({ data: [], total: 0 });
    wireRegistry(makeRegistry({ listComponents }));

    await dispatchComponents(
      "listComponents",
      { limit: "10", offset: "0", migrationStatus: "diverged" },
      undefined
    );

    expect(listComponents).toHaveBeenCalledTimes(1);
    expect(listComponents.mock.calls[0]?.[0]).toMatchObject({
      migrationStatus: "diverged",
    });
  });

  // Absence of the parameter IS "do not filter", so it must not become a value the query narrows on.
  it("omits the filter entirely when none was asked for", async () => {
    const listComponents = vi.fn().mockResolvedValue({ data: [], total: 0 });
    wireRegistry(makeRegistry({ listComponents }));

    await dispatchComponents("listComponents", { limit: "10" }, undefined);

    expect(listComponents.mock.calls[0]?.[0]?.migrationStatus).toBeUndefined();
  });

  /**
   * 🔴 Rejected rather than ignored. Passing an unknown value through returns an empty list, which a
   * caller cannot tell from "nothing is in that state"; dropping it returns everything while looking
   * filtered. Both are silent, and only a refusal is actionable.
   */
  it("refuses a status this system does not have, and says which are valid", async () => {
    const listComponents = vi.fn().mockResolvedValue({ data: [], total: 0 });
    wireRegistry(makeRegistry({ listComponents }));

    const failure = await dispatchComponents(
      "listComponents",
      { migrationStatus: "bogus" },
      undefined
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          expect.objectContaining({
            path: "migrationStatus",
            code: "INVALID_VALUE",
          }),
        ],
      },
    });
    // The message NAMES the accepted values; "invalid" alone leaves a caller guessing.
    expect(
      (failure as { publicData?: { errors?: { message?: string }[] } })
        .publicData?.errors?.[0]?.message
    ).toContain("diverged");
    // And it refused before querying at all.
    expect(listComponents).not.toHaveBeenCalled();
  });
});

describe("dispatchComponents, paginated lists (respondList)", () => {
  it("listComponents returns Response with { items, meta } body and 200 status", async () => {
    const fakeComponents = [
      { slug: "hero", tableName: "comp_hero" },
      { slug: "cta", tableName: "comp_cta" },
    ];
    const registry = makeRegistry({
      listComponents: vi.fn().mockResolvedValue({
        data: fakeComponents,
        total: 2,
      }),
    });
    wireRegistry(registry);

    const result = await dispatchComponents(
      "listComponents",
      { limit: "10", offset: "0" },
      undefined
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body).toEqual({
      // No database adapter here, so no use count can be read: each row says
      // so with `null` rather than claiming nothing uses it.
      items: fakeComponents.map(component => ({
        ...component,
        placedBy: null,
      })),
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

describe("dispatchComponents, listComponents use counts", () => {
  const page = [
    { slug: "card", tableName: "comp_card" },
    { slug: "seo", tableName: "comp_seo" },
  ];

  beforeEach(() => {
    wireRegistry(
      makeRegistry({
        listComponents: vi.fn().mockResolvedValue({ data: page, total: 2 }),
      })
    );
    vi.mocked(getAdapterFromDI).mockReturnValue(
      {} as ReturnType<typeof getAdapterFromDI>
    );
  });

  it("gives each row the number of fields that place it, one field group's use of another included", async () => {
    readFieldOwners.mockResolvedValue([
      {
        entityType: "fieldGroup",
        entitySlug: "card",
        fields: [{ name: "meta", type: "component", component: "seo" }],
      },
      {
        entityType: "collection",
        entitySlug: "pages",
        fields: [
          { name: "teaser", type: "component", component: "card" },
          { name: "footer", type: "component", component: "card" },
        ],
      },
    ]);
    const body = await (
      (await dispatchComponents("listComponents", {}, undefined)) as Response
    ).json();
    expect(body.items).toEqual([
      { slug: "card", tableName: "comp_card", placedBy: 2 },
      { slug: "seo", tableName: "comp_seo", placedBy: 1 },
    ]);
    expect(readFieldOwners).toHaveBeenCalledTimes(1);
  });

  it("counts no field of a collection the reader may not read", async () => {
    readFieldOwners.mockResolvedValue([
      {
        entityType: "collection",
        entitySlug: "pages",
        fields: [{ name: "teaser", type: "component", component: "card" }],
      },
      {
        entityType: "collection",
        entitySlug: "secret",
        fields: [{ name: "teaser", type: "component", component: "card" }],
      },
    ]);
    readAuthenticatedUser.mockReturnValue({ id: "u1", role: "editor" });
    readableSlugsOfKind.mockImplementation(
      async (_caller: unknown, kind: string) => ({
        slugs: kind === "collection" ? ["pages"] : [],
        reachable: true,
      })
    );
    try {
      const body = await (
        (await dispatchComponents("listComponents", {}, undefined)) as Response
      ).json();
      // "secret" places "card" too, but this reader's list hides it.
      expect(body.items[0]).toMatchObject({ slug: "card", placedBy: 1 });
    } finally {
      readAuthenticatedUser.mockReset();
      readableSlugsOfKind.mockReset();
    }
  });

  it("shows no count, rather than a smaller one, when the reader's Singles cannot be listed", async () => {
    readFieldOwners.mockResolvedValue([
      {
        entityType: "single",
        entitySlug: "home",
        fields: [{ name: "teaser", type: "component", component: "card" }],
      },
    ]);
    readAuthenticatedUser.mockReturnValue({ id: "u1", role: "editor" });
    readableSlugsOfKind.mockImplementation(
      async (_caller: unknown, kind: string) =>
        kind === "single"
          ? { slugs: [], reachable: false }
          : { slugs: [], reachable: true }
    );
    vi.mocked(getLoggerFromDI).mockReturnValue({
      warn: vi.fn(),
    } as unknown as ReturnType<typeof getLoggerFromDI>);
    try {
      const body = await (
        (await dispatchComponents("listComponents", {}, undefined)) as Response
      ).json();
      expect(body.items[0]).toMatchObject({ slug: "card", placedBy: null });
    } finally {
      readAuthenticatedUser.mockReset();
      readableSlugsOfKind.mockReset();
    }
  });

  it("still lists the field groups when the field lists cannot be read, with no count", async () => {
    readFieldOwners.mockRejectedValue(new Error("registry unreadable"));
    const warn = vi.fn();
    vi.mocked(getLoggerFromDI).mockReturnValue({
      warn,
    } as unknown as ReturnType<typeof getLoggerFromDI>);
    const response = (await dispatchComponents(
      "listComponents",
      {},
      undefined
    )) as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.items.map((item: { placedBy: unknown }) => item.placedBy)
    ).toEqual([null, null]);
    // Said in the log, so an unreadable registry is not mistaken for unused groups.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("use counts could not be read"),
      { error: "registry unreadable" }
    );
  });
});

describe("dispatchComponents, single-doc reads (respondDoc)", () => {
  it("getComponent returns bare doc body", async () => {
    const fakeComponent = {
      slug: "hero",
      tableName: "comp_hero",
      fields: [{ name: "title", type: "text" }],
    };
    const registry = makeRegistry({
      getComponent: vi.fn().mockResolvedValue(fakeComponent),
    });
    wireRegistry(registry);

    const result = await dispatchComponents(
      "getComponent",
      { slug: "hero" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(fakeComponent);
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });
});

describe("dispatchComponents, mutations (respondMutation)", () => {
  it("createComponent returns { message, item } body and 201 status", async () => {
    const created = {
      slug: "hero",
      tableName: "comp_hero",
      migrationStatus: "pending" as const,
    };
    const registry = makeRegistry({
      registerComponent: vi.fn().mockResolvedValue(created),
    });
    wireRegistry(registry);

    const result = await dispatchComponents(
      "createComponent",
      {},
      {
        slug: "hero",
        label: "Hero",
        fields: [{ name: "title", type: "text" }],
      }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    // No adapter in DI → migrationStatus stays "pending" → "Run migrations" copy.
    expect(body).toEqual({
      message: 'Component "hero" created. Run migrations to apply the table.',
      item: created,
    });
    expect(body).not.toHaveProperty("data");
  });

  it("updateComponent returns { message, item } body and 200 status", async () => {
    const existing = {
      slug: "hero",
      tableName: "comp_hero",
      fields: [],
      migrationStatus: "applied" as const,
    };
    const updated = { ...existing, label: "Hero (renamed)" };
    const registry = makeRegistry({
      isLocked: vi.fn().mockResolvedValue(false),
      getComponentForWrite: vi.fn().mockResolvedValue(existing),
      updateComponent: vi.fn().mockResolvedValue(updated),
    });
    const service = wireRegistry(registry);
    // Spied rather than replaced: the real method still runs, so the registry assertion below is
    // still describing a real call rather than one this spy invented.
    const updateFieldGroup = vi.spyOn(service, "updateFieldGroup");

    const result = await dispatchComponents(
      "updateComponent",
      { slug: "hero" },
      { label: "Hero (renamed)" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: 'Component "hero" updated.',
      item: updated,
    });

    // 🔴 The handler is a transport now, so what makes this test load-bearing is WHERE the write
    // went — and this has to be observed on the SERVICE, not on the registry.
    //
    // The registry is reached on both paths: through the service, and by a handler that writes the
    // row itself. So `expect(registry.updateComponent).toHaveBeenCalledWith(...)` is satisfied by
    // exactly the regression it was written to catch — the state that let two other transports
    // write the row and skip the schema half entirely. It answers "was the row written", which is
    // a neighbouring question to "who wrote it".
    expect(updateFieldGroup).toHaveBeenCalledWith({
      slug: "hero",
      label: "Hero (renamed)",
      source: "ui",
    });

    // Kept as well, because it pins something the service call does not: what the service passes
    // ON, unsent properties excluded.
    expect(registry.updateComponent).toHaveBeenCalledWith(
      "hero",
      { label: "Hero (renamed)" },
      { source: "ui" }
    );
  });

  // A property of the SERVICE, asserted through the dispatcher because that is where a caller meets
  // it: a PATCH naming only `label` must not clear the description, the admin block or the fields.
  // The registry translates absent-means-untouched, so handing it an explicit `undefined` for every
  // unsent property would erase them.
  it("updateComponent sends only the properties the request carried", async () => {
    const existing = {
      slug: "hero",
      tableName: "comp_hero",
      fields: [],
      migrationStatus: "applied" as const,
    };
    const registry = makeRegistry({
      isLocked: vi.fn().mockResolvedValue(false),
      getComponentForWrite: vi.fn().mockResolvedValue(existing),
      updateComponent: vi.fn().mockResolvedValue(existing),
    });
    wireRegistry(registry);

    await dispatchComponents(
      "updateComponent",
      { slug: "hero" },
      { description: "Only this." }
    );

    const [, patch] = registry.updateComponent.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(Object.keys(patch)).toEqual(["description"]);
  });

  // 🔴 The body is a type ASSERTION over whatever JSON arrived, so a non-boolean survives it. The
  // string "false" is truthy, which would take the ENABLED branch and drop the main table's
  // translatable columns — while the registry, which stores `localized === true`, recorded the
  // group DISABLED. Refusing is the only outcome that keeps those two agreeing.
  it("updateComponent refuses a non-boolean localized rather than acting on it", async () => {
    const existing = {
      slug: "hero",
      tableName: "comp_hero",
      fields: [],
      localized: false,
      migrationStatus: "applied" as const,
    };
    const registry = makeRegistry({
      isLocked: vi.fn().mockResolvedValue(false),
      getComponentForWrite: vi.fn().mockResolvedValue(existing),
      updateComponent: vi.fn().mockResolvedValue(existing),
    });
    wireRegistry(registry);

    // 🔴 Asserted on the REASON, not the code. Reading the raw body instead makes `"false"` truthy,
    // which takes the enable branch and is refused by the localization-config gate — also a
    // VALIDATION_ERROR. A code-only assertion passes on both the fixed and the broken code and
    // certifies nothing; the path is what separates them.
    await expect(
      dispatchComponents("updateComponent", { slug: "hero" }, {
        localized: "false",
      } as unknown as Record<string, unknown>)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          expect.objectContaining({
            path: "localized",
            code: "invalid_type",
          }),
        ],
      },
    });

    // Nothing was written: the refusal has to happen before the row moves, not after.
    expect(registry.updateComponent).not.toHaveBeenCalled();
  });
});

describe("dispatchComponents, actions (respondAction)", () => {
  it("deleteComponent returns { message, slug } body and 200 status", async () => {
    const registry = makeRegistry({
      isLocked: vi.fn().mockResolvedValue(false),
      deleteComponent: vi.fn().mockResolvedValue(undefined),
    });
    wireRegistry(registry);

    const result = await dispatchComponents(
      "deleteComponent",
      { slug: "hero" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: 'Component "hero" deleted successfully.',
      slug: "hero",
    });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });
});

describe("dispatchComponents, where a field group is used (getComponentUsedBy)", () => {
  const owners = [
    {
      entityType: "fieldGroup",
      entitySlug: "card",
      fields: [{ name: "meta", type: "component", component: "seo" }],
    },
    {
      entityType: "collection",
      entitySlug: "pages",
      fields: [{ name: "seo", type: "component", component: "seo" }],
    },
    {
      entityType: "single",
      entitySlug: "home",
      fields: [{ name: "seo", type: "component", component: "seo" }],
    },
  ];

  beforeEach(() => {
    readFieldOwners.mockReset();
    vi.mocked(getAdapterFromDI).mockReturnValue(
      {} as ReturnType<typeof getAdapterFromDI>
    );
  });

  it("lists each field that places the field group, and what holds it, as { items, meta }", async () => {
    wireRegistry(
      makeRegistry({ getComponent: vi.fn().mockResolvedValue({ slug: "seo" }) })
    );
    readFieldOwners.mockResolvedValue(owners);
    const response = (await dispatchComponents(
      "getComponentUsedBy",
      { slug: "seo" },
      undefined
    )) as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([
      { entityType: "fieldGroup", entitySlug: "card", fieldPath: "meta" },
      { entityType: "collection", entitySlug: "pages", fieldPath: "seo" },
      { entityType: "single", entitySlug: "home", fieldPath: "seo" },
    ]);
    expect(body.meta).toMatchObject({ total: 3 });
  });

  it("names no collection or Single the reader may not read, as their own lists hide them", async () => {
    wireRegistry(
      makeRegistry({ getComponent: vi.fn().mockResolvedValue({ slug: "seo" }) })
    );
    readFieldOwners.mockResolvedValue(owners);
    readAuthenticatedUser.mockReturnValue({ id: "u1", role: "editor" });
    // The reader may read no Single, and of the collections only "posts".
    readableSlugsOfKind.mockImplementation(
      async (_caller: unknown, kind: string) => ({
        slugs: kind === "collection" ? ["posts"] : [],
        reachable: true,
      })
    );
    try {
      const body = await (
        (await dispatchComponents(
          "getComponentUsedBy",
          { slug: "seo" },
          undefined
        )) as Response
      ).json();
      // "pages" and "home" are hidden from this reader's lists, so the answer
      // names neither; a field group has no per-reader rule and stays.
      expect(body.items).toEqual([
        { entityType: "fieldGroup", entitySlug: "card", fieldPath: "meta" },
      ]);
      expect(readableSlugsOfKind).toHaveBeenCalledWith(
        expect.anything(),
        "collection"
      );
      expect(readableSlugsOfKind).toHaveBeenCalledWith(
        expect.anything(),
        "single"
      );
    } finally {
      readAuthenticatedUser.mockReset();
      readableSlugsOfKind.mockReset();
    }
  });

  it("refuses, rather than leaving a kind out, when the reader's collections cannot be listed", async () => {
    wireRegistry(
      makeRegistry({ getComponent: vi.fn().mockResolvedValue({ slug: "seo" }) })
    );
    readFieldOwners.mockResolvedValue(owners);
    readAuthenticatedUser.mockReturnValue({ id: "u1", role: "editor" });
    readableSlugsOfKind.mockImplementation(
      async (_caller: unknown, kind: string) =>
        kind === "collection"
          ? { slugs: [], reachable: false }
          : { slugs: ["home"], reachable: true }
    );
    try {
      // Every collection left out would read as fewer uses, or none.
      await expect(
        dispatchComponents("getComponentUsedBy", { slug: "seo" }, undefined)
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        logContext: { reason: "field-group-placements-unreadable" },
      });
    } finally {
      readAuthenticatedUser.mockReset();
      readableSlugsOfKind.mockReset();
    }
  });

  it("answers not found for a field group that does not exist, before reading any field list", async () => {
    wireRegistry(
      makeRegistry({
        getComponent: vi
          .fn()
          .mockRejectedValue(NextlyError.notFound({ logContext: {} })),
      })
    );
    await expect(
      dispatchComponents("getComponentUsedBy", { slug: "gone" }, undefined)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(readFieldOwners).not.toHaveBeenCalled();
  });

  it("refuses when the field lists cannot be read, rather than answering it is used nowhere", async () => {
    wireRegistry(
      makeRegistry({ getComponent: vi.fn().mockResolvedValue({ slug: "seo" }) })
    );
    readFieldOwners.mockRejectedValue(new Error("registry unreadable"));
    await expect(
      dispatchComponents("getComponentUsedBy", { slug: "seo" }, undefined)
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      logContext: { reason: "field-group-placements-unreadable", slug: "seo" },
    });
  });
});
