/**
 * Phase 4 Task 12: routeHandler direct-branch tests pin the canonical
 * respondX wire shapes for the seven endpoints that bypass the dispatcher
 * and live as private branches inside `routeHandler.ts` (or its delegated
 * REST handler in `api/image-sizes.ts`):
 *
 *   handleAdminMetaRequest         GET    /admin-meta
 *   handleAdminMetaSidebarGroups   PATCH  /admin-meta/sidebar-groups
 *   listImageSizes                 GET    /image-sizes
 *   getImageSizeById               GET    /image-sizes/:id
 *   createImageSize                POST   /image-sizes
 *   updateImageSize                PATCH  /image-sizes/:id
 *   deleteImageSize                DELETE /image-sizes/:id
 *
 * Every assertion includes a regression guard (`not.toHaveProperty("data")`)
 * to make sure the legacy `{ data: ... }` envelope cannot regress through
 * these branches. Mocks isolate the handlers from the DI container, the
 * generalSettingsService, and the underlying ImageSizeService.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (must come before SUT imports so vi.mock hoisting wires up
// before module evaluation) ---------------------------------------------

// Auth middleware: the SUTs call requireAnyPermission / requirePermission
// to gate access. Tests force the happy path (auth allowed); negative auth
// paths are covered by other test suites.
vi.mock("../auth/middleware", () => ({
  requireAnyPermission: vi.fn(),
  requirePermission: vi.fn(),
  requireAuthentication: vi.fn(),
  requireCollectionAccess: vi.fn(),
  isErrorResponse: vi.fn(),
  createJsonErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

// Image-size handlers cache an instance keyed off `getCachedNextly` and
// `container.get("adapter")`. Stub both so the cached path resolves without
// real adapter wiring; the actual ImageSizeService is replaced below.
vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

// container.has is consulted by the admin-meta branch to decide whether
// to pull DB-overridden branding values; container.get is consulted by the
// image-sizes service factory and the sidebar-groups branch.
vi.mock("../di/container", () => ({
  container: {
    has: vi.fn().mockReturnValue(false),
    get: vi.fn(),
  },
}));

// `services/lib/permissions` is pulled into routeHandler for super-admin
// guards. None of the tested branches hit those guards but the import must
// resolve.
vi.mock("../services/lib/permissions", () => ({
  isSuperAdmin: vi.fn().mockResolvedValue(false),
  containsSuperAdminRole: vi.fn().mockResolvedValue(false),
  hasSuperAdminExcluding: vi.fn().mockResolvedValue(false),
}));

// Replace the ImageSizeService class with a vi.fn-backed constructor whose
// instance methods can be reassigned per test via `mockImageSizeServiceImpl`.
// The factory closes over a mutable holder so each test can swap behavior
// without re-mocking the module.
const mockImageSizeServiceImpl: {
  list: ReturnType<typeof vi.fn>;
  getById: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} = {
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

// Use a real constructor function (not an arrow factory) so vitest's spy
// machinery can be invoked with `new` from the SUT. Returning the shared
// mock object lets each test reach into `mockImageSizeServiceImpl.<method>`
// without re-mocking the module.
vi.mock("../services/image-size", () => ({
  ImageSizeService: vi.fn(function MockImageSizeService(this: unknown) {
    return mockImageSizeServiceImpl;
  }),
}));

// The handler-config helper drives admin-meta branding; we feed it from
// `mockHandlerConfig` so individual tests can swap branding payloads.
const mockHandlerConfig: {
  admin?: {
    branding?: Record<string, unknown>;
    pluginOverrides?: Record<string, unknown>;
  };
  plugins?: unknown[];
} = {};

vi.mock("../route-handler", async () => {
  const actual =
    await vi.importActual<typeof import("../route-handler")>("../route-handler");
  return {
    ...actual,
    // Only the config getter is consulted by the admin-meta branch; the
    // rest of the route-handler surface (parseRestRoute, getDispatcher,
    // etc.) is irrelevant here so we keep the actual implementations.
    getHandlerConfig: vi.fn(() => mockHandlerConfig),
  };
});

// --- SUT imports (must come AFTER vi.mock calls so the mocks apply) -----

import {
  isErrorResponse,
  requireAnyPermission,
  requirePermission,
  createJsonErrorResponse,
} from "../auth/middleware";
import { container } from "../di/container";
import {
  _handleAdminMetaRequestForTest,
  _handleAdminMetaSidebarGroupsForTest,
} from "../routeHandler";
import {
  createImageSize,
  deleteImageSize,
  getImageSizeById,
  listImageSizes,
  updateImageSize,
} from "../api/image-sizes";

// --- Fixtures -----------------------------------------------------------

const IMAGE_SIZE = {
  id: "sz_1",
  name: "thumb",
  width: 320,
  height: 240,
  fit: "inside",
  quality: 80,
  format: "auto",
  isDefault: false,
  sortOrder: 0,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every auth gate allows the request through.
  (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user-1",
    authMethod: "session",
  });
  (requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user-1",
    authMethod: "session",
  });
  // Reset the swapped-in handler config to an empty branding payload so
  // admin-meta defaults apply unless a test overrides them.
  for (const k of Object.keys(mockHandlerConfig)) {
    delete (mockHandlerConfig as Record<string, unknown>)[k];
  }
});

// =======================================================================
// admin-meta GET (handleAdminMetaRequest)
// =======================================================================

describe("handleAdminMetaRequest (GET /admin-meta)", () => {
  it("emits respondData (bare object body) with the resolved branding payload", async () => {
    // Provide a representative branding config so the response body has a
    // discriminating field beyond the always-included `showBuilder`.
    mockHandlerConfig.admin = {
      branding: {
        logoText: "Test Co.",
        showBuilder: false,
      },
    };

    const res = await _handleAdminMetaRequestForTest();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const json = (await res.json()) as Record<string, unknown>;
    // Regression guard: legacy `{ data: ... }` envelope must not return.
    expect(json).not.toHaveProperty("data");
    // Bare body shape: branding fields live at the top level.
    expect(json.logoText).toBe("Test Co.");
    expect(json.showBuilder).toBe(false);
  });
});

// =======================================================================
// admin-meta sidebar-groups PATCH (handleAdminMetaSidebarGroups)
// =======================================================================

describe("handleAdminMetaSidebarGroups (PATCH /admin-meta/sidebar-groups)", () => {
  it("emits respondMutation { message, item } with the updated groups", async () => {
    // Sidebar-groups requires the generalSettingsService from the DI
    // container. Wire `container.has` to true and `container.get` to a
    // service stub whose updateCustomSidebarGroups echoes the validated
    // input.
    const updated = [
      { slug: "marketing", name: "Marketing" },
      { slug: "ops", name: "Operations", icon: "wrench" },
    ];
    (container.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      updateCustomSidebarGroups: vi.fn().mockResolvedValue(updated),
    });

    const res = await _handleAdminMetaSidebarGroupsForTest(
      new Request("http://x/api/admin-meta/sidebar-groups", {
        method: "PATCH",
        body: JSON.stringify({ groups: updated }),
      })
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { message: string; item: unknown };
    // Regression guard: legacy `{ data: ... }` envelope must not return.
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/updated/i);
    expect(json.item).toEqual(updated);
  });
});

// =======================================================================
// image-sizes endpoints (api/image-sizes.ts handlers, which the
// handleImageSizesRequest branch in routeHandler.ts delegates to)
// =======================================================================

describe("listImageSizes (GET /image-sizes)", () => {
  it("emits respondList with synthetic single-page meta", async () => {
    // Service returns two sizes; endpoint is not server-paginated so meta
    // is synthesised to total=2, page=1, totalPages=1.
    mockImageSizeServiceImpl.list.mockResolvedValueOnce([
      IMAGE_SIZE,
      IMAGE_SIZE,
    ]);
    // The factory pulls the adapter via container.get; return a sentinel
    // (never actually used because ImageSizeService is fully mocked).
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({});

    const res = await listImageSizes(new Request("http://x/api/image-sizes"));

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      items: unknown[];
      meta: { total: number; page: number; totalPages: number };
    };
    expect(json).not.toHaveProperty("data");
    expect(json.items).toHaveLength(2);
    expect(json.meta).toMatchObject({
      total: 2,
      page: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });
});

describe("getImageSizeById (GET /image-sizes/:id)", () => {
  it("emits respondDoc (bare doc body)", async () => {
    mockImageSizeServiceImpl.getById.mockResolvedValueOnce(IMAGE_SIZE);
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({});

    const res = await getImageSizeById(
      new Request("http://x/api/image-sizes/sz_1"),
      "sz_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).not.toHaveProperty("item");
    // Doc body matches the service result (Date fields serialise to ISO
    // strings through JSON.stringify, so we compare structural fields).
    expect(json.id).toBe(IMAGE_SIZE.id);
    expect(json.name).toBe(IMAGE_SIZE.name);
  });
});

describe("createImageSize (POST /image-sizes)", () => {
  it("emits respondMutation with status 201 and the created row as item", async () => {
    const created = { ...IMAGE_SIZE, id: "sz_2", name: "hero" };
    mockImageSizeServiceImpl.create.mockResolvedValueOnce(created);
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({});

    const res = await createImageSize(
      new Request("http://x/api/image-sizes", {
        method: "POST",
        body: JSON.stringify({
          name: "hero",
          width: 1920,
          height: 1080,
        }),
      })
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as { message: string; item: { id: string } };
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/created/i);
    expect(json.item.id).toBe("sz_2");
  });
});

describe("updateImageSize (PATCH /image-sizes/:id)", () => {
  it("emits respondMutation with the updated row as item", async () => {
    const updated = { ...IMAGE_SIZE, name: "thumb-renamed" };
    mockImageSizeServiceImpl.update.mockResolvedValueOnce(updated);
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({});

    const res = await updateImageSize(
      new Request("http://x/api/image-sizes/sz_1", {
        method: "PATCH",
        body: JSON.stringify({ name: "thumb-renamed" }),
      }),
      "sz_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      message: string;
      item: { name: string };
    };
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/updated/i);
    expect(json.item.name).toBe("thumb-renamed");
  });
});

describe("deleteImageSize (DELETE /image-sizes/:id)", () => {
  it("emits respondAction with the deleted id alongside the message", async () => {
    // service.delete returns void; the handler surfaces the id via the
    // respondAction result spread (mirrors the deleteSingle precedent).
    mockImageSizeServiceImpl.delete.mockResolvedValueOnce(undefined);
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({});

    const res = await deleteImageSize(
      new Request("http://x/api/image-sizes/sz_1", { method: "DELETE" }),
      "sz_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).not.toHaveProperty("item");
    expect(json.message).toMatch(/deleted/i);
    expect(json.id).toBe("sz_1");
  });
});

// Reference the imported helpers so unused-import lint stays quiet on the
// rare auth helpers we mock for completeness but do not invoke directly
// in any test branch (different SUTs reach them via the auth/middleware
// barrel).
void createJsonErrorResponse;
