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
  getAdapterFromDI: vi.fn(),
}));

vi.mock("../../../di/container", () => ({
  container: {
    has: vi.fn().mockReturnValue(false),
    get: vi.fn(),
  },
}));

import {
  getAdapterFromDI,
  getComponentRegistryFromDI,
} from "../../helpers/di";
import { dispatchComponents } from "../component-dispatcher";

type Registry = {
  listComponents: ReturnType<typeof vi.fn>;
  registerComponent: ReturnType<typeof vi.fn>;
  getComponent: ReturnType<typeof vi.fn>;
  updateComponent: ReturnType<typeof vi.fn>;
  deleteComponent: ReturnType<typeof vi.fn>;
  isLocked: ReturnType<typeof vi.fn>;
};

function makeRegistry(overrides: Partial<Registry> = {}): Registry {
  return {
    listComponents: vi.fn(),
    registerComponent: vi.fn(),
    getComponent: vi.fn(),
    updateComponent: vi.fn(),
    deleteComponent: vi.fn(),
    isLocked: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function wireRegistry(registry: Registry) {
  vi.mocked(getComponentRegistryFromDI).mockReturnValue(
    registry as unknown as ReturnType<typeof getComponentRegistryFromDI>
  );
}

beforeEach(() => {
  vi.mocked(getComponentRegistryFromDI).mockReset();
  vi.mocked(getAdapterFromDI).mockReturnValue(undefined);
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
    wireRegistry(registry);

    const result = await dispatchComponents(
      "updateComponent",
      { slug: "hero" },
      { label: "Hero (renamed)" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    // No fields update + existing migrationStatus "applied" carries
    // through, so the toast picks the "applied successfully" branch.
    expect(body).toEqual({
      message: 'Component "hero" updated and migration applied successfully.',
      item: updated,
    });
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
