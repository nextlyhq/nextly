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
}));

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
} from "../../helpers/di";
import { dispatchComponents } from "../component-dispatcher";

type Registry = {
  listComponents: ReturnType<typeof vi.fn>;
  registerComponent: ReturnType<typeof vi.fn>;
  getComponent: ReturnType<typeof vi.fn>;
  updateComponent: ReturnType<typeof vi.fn>;
  deleteComponent: ReturnType<typeof vi.fn>;
  getComponentBySlug: ReturnType<typeof vi.fn>;
  getAllComponents: ReturnType<typeof vi.fn>;
  isLocked: ReturnType<typeof vi.fn>;
};

function makeRegistry(overrides: Partial<Registry> = {}): Registry {
  return {
    listComponents: vi.fn(),
    registerComponent: vi.fn(),
    getComponent: vi.fn(),
    updateComponent: vi.fn(),
    deleteComponent: vi.fn(),
    // Answers "no such slug" so a create reaches the path under test. The handler asks before it
    // converges any schema, so a double that cannot answer fails the request instead.
    getComponentBySlug: vi.fn().mockResolvedValue(null),
    // Answers "no field group owns that table" so a create reaches the path under test. The
    // handler asks before it emits any DDL, so a double that cannot answer fails the request.
    getAllComponents: vi.fn().mockResolvedValue([]),
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
      items: fakeComponents,
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
      getComponent: vi.fn().mockResolvedValue(existing),
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
      getComponent: vi.fn().mockResolvedValue(existing),
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
      getComponent: vi.fn().mockResolvedValue(existing),
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
