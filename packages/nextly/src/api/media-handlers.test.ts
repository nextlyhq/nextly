import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../di/container";

import { createMediaHandlers } from "./media-handlers";

const mocks = vi.hoisted(() => {
  return {
    mediaService: {
      listMedia: vi.fn(),
      upload: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
    },
    requirePermission: vi.fn(),
  };
});

vi.mock("../init", () => ({
  getNextly: vi.fn(async () => ({})),
  getCachedNextly: vi.fn(async () => ({})),
}));

vi.mock("../di", () => ({
  getService: vi.fn(() => mocks.mediaService),
}));

// Partial mock: keep the real ErrorResponse helpers (pure functions) and only
// drive `requirePermission` from the test.
vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  return { ...actual, requirePermission: mocks.requirePermission };
});

describe("createMediaHandlers timezone formatting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container.clear();
  });

  afterEach(() => {
    container.clear();
  });

  it("normalizes media timestamps with configured timezone for dynamic route handlers", async () => {
    container.registerSingleton("generalSettingsService", () => ({
      getTimezone: async () => "Asia/Tokyo",
    }));

    mocks.mediaService.listMedia.mockResolvedValue({
      data: [
        {
          id: "media-1",
          filename: "sample.png",
          originalFilename: "sample.png",
          mimeType: "image/png",
          size: 1234,
          url: "/uploads/sample.png",
          uploadedAt: "2026-04-03T12:34:56",
          updatedAt: "2026-04-03 13:00:00",
        },
      ],
      pagination: {
        total: 1,
      },
    });

    const handlers = createMediaHandlers();
    const response = await handlers.GET(
      new Request("http://localhost/api/media"),
      {
        params: Promise.resolve({}),
      }
    );

    expect(response.status).toBe(200);

    // The list endpoint emits respondList `{ items, meta }`.
    const json = (await response.json()) as {
      items: Array<{ uploadedAt: string; updatedAt: string }>;
    };

    expect(json.items[0].uploadedAt).toContain("+09:00");
    expect(json.items[0].updatedAt).toContain("+09:00");
  });
});

describe("createMediaHandlers authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container.clear();
  });

  afterEach(() => {
    container.clear();
  });

  it("does not serve writes on the public mount (upload 404s, permission never consulted)", async () => {
    const handlers = createMediaHandlers(); // public: requireAuth defaults false
    const response = await handlers.POST(
      new Request("http://localhost/api/media", { method: "POST" }),
      { params: Promise.resolve({}) } // empty path + POST → upload-media
    );

    // The public surface has no write endpoint — the write is refused exactly
    // like an unknown route, and no permission check (or upload) happens.
    expect(response.status).toBe(404);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.mediaService.upload).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request on the gated mount with the permission's error", async () => {
    mocks.requirePermission.mockResolvedValue({
      success: false,
      statusCode: 401,
      message: "Authentication required",
      error: "You must be logged in to access this resource",
      data: null,
      code: "AUTH_REQUIRED",
    });

    const handlers = createMediaHandlers({ requireAuth: true });
    const response = await handlers.DELETE(
      new Request("http://localhost/admin/api/media/some-id", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ path: ["some-id"] }) } // delete-media
    );

    expect(response.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "delete",
      "media"
    );
    expect(mocks.mediaService.delete).not.toHaveBeenCalled();
  });

  it("attributes a create to the authenticated caller, never a client-supplied identity", async () => {
    mocks.requirePermission.mockResolvedValue({
      userId: "real-admin",
      permissions: [],
      roles: [],
      authMethod: "session",
    });
    mocks.mediaService.createFolder.mockResolvedValue({ id: "folder-1" });

    const handlers = createMediaHandlers({ requireAuth: true });
    const response = await handlers.POST(
      new Request("http://localhost/admin/api/media/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A spoofed createdBy in the body must be ignored.
        body: JSON.stringify({ name: "Photos", createdBy: "attacker" }),
      }),
      { params: Promise.resolve({ path: ["folders"] }) } // create-folder
    );

    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "create",
      "media"
    );
    expect(response.status).toBe(201);

    // The folder is created for the session user, not the body's `createdBy`.
    const [, context] = mocks.mediaService.createFolder.mock.calls[0];
    expect(context.user.id).toBe("real-admin");
  });
});
