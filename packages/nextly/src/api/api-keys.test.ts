// Phase 4 Task 11: api-keys handler tests pin the canonical respondX wire
// shapes for all five endpoints (list / get / create / update / revoke).
// We exercise the handlers in isolation, focusing on the response envelope.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", () => ({
  requireAnyPermission: vi.fn(),
  isErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../di", () => ({
  container: {
    get: vi.fn(),
  },
}));

vi.mock("../services/lib/permissions", () => ({
  isSuperAdmin: vi.fn().mockResolvedValue(false),
}));

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { container } from "../di";

import {
  createApiKey,
  getApiKeyById,
  listApiKeys,
  revokeApiKey,
  updateApiKey,
} from "./api-keys";

const KEY_META = {
  id: "ak_1",
  name: "Frontend",
  description: null,
  tokenType: "full-access",
  roleId: null,
  isActive: true,
  expiresAt: null,
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
  userId: "user-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

describe("listApiKeys", () => {
  it("emits respondList with synthetic single-page meta", async () => {
    (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
      authMethod: "session",
    });
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      listApiKeys: vi.fn().mockResolvedValue([KEY_META, KEY_META]),
    });

    const res = await listApiKeys(new Request("http://x/api/api-keys"));

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

describe("getApiKeyById", () => {
  it("emits respondDoc (bare doc body)", async () => {
    (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
      authMethod: "session",
    });
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getApiKeyById: vi.fn().mockResolvedValue(KEY_META),
    });

    const res = await getApiKeyById(
      new Request("http://x/api/api-keys/ak_1"),
      "ak_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).not.toHaveProperty("item");
    expect(json).toEqual(KEY_META);
  });
});

describe("createApiKey", () => {
  it("emits respondMutation with status 201 and { doc, key } as item", async () => {
    (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
      authMethod: "session",
    });
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      createApiKey: vi
        .fn()
        .mockResolvedValue({ meta: KEY_META, key: "raw-secret" }),
    });

    const res = await createApiKey(
      new Request("http://x/api/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: "Frontend",
          tokenType: "full-access",
          expiresIn: "unlimited",
        }),
      })
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      message: string;
      item: { doc: unknown; key: string };
    };
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/created/i);
    expect(json.item.key).toBe("raw-secret");
    expect(json.item.doc).toEqual(KEY_META);
  });
});

describe("updateApiKey", () => {
  it("emits respondMutation with the updated row as item", async () => {
    (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
      authMethod: "session",
    });
    const updated = { ...KEY_META, name: "Renamed" };
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      updateApiKey: vi.fn().mockResolvedValue(updated),
    });

    const res = await updateApiKey(
      new Request("http://x/api/api-keys/ak_1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed" }),
      }),
      "ak_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { message: string; item: unknown };
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/updated/i);
    expect(json.item).toEqual(updated);
  });
});

describe("revokeApiKey", () => {
  it("emits respondAction with the revoked id alongside the message", async () => {
    (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
      authMethod: "session",
    });
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      revokeApiKey: vi.fn().mockResolvedValue(undefined),
    });

    const res = await revokeApiKey(
      new Request("http://x/api/api-keys/ak_1", { method: "DELETE" }),
      "ak_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).not.toHaveProperty("item");
    expect(json.message).toMatch(/revoked/i);
    expect(json.id).toBe("ak_1");
  });
});
