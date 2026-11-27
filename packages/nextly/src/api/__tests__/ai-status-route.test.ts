/**
 * `GET /api/ai/status`: any signed-in caller, judged as themselves, and an
 * optional `collection` and `id` naming the content the status is about.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthentication, status } = vi.hoisted(() => ({
  requireAuthentication: vi.fn(),
  status: vi.fn(async () => ({ configured: false })),
}));

vi.mock("../../auth/middleware", () => ({
  requireAuthentication,
  isErrorResponse: (value: { statusCode?: number }) =>
    value.statusCode !== undefined,
}));
vi.mock("../../domains/ai/ai-wiring", () => ({
  aiService: () => ({ status }),
}));

const { getAIStatus } = await import("../ai-status");

const session = { userId: "alice", authMethod: "session" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthentication.mockResolvedValue(session);
});

const get = (query = "") =>
  getAIStatus(new Request(`https://example.test/admin/api/ai/status${query}`));

describe("the AI status route", () => {
  it("answers the signed-in caller's status, never cached", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false });
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(status).toHaveBeenCalledWith(session, { target: undefined });
  });

  it.each([
    ["?collection=posts", { collection: "posts" }],
    ["?collection=posts&id=p1", { collection: "posts", id: "p1" }],
  ])("asks about the content %s names", async (query, target) => {
    await get(query);
    expect(status).toHaveBeenCalledWith(session, { target });
  });

  it.each(["?id=p1", "?collection=Posts%20Table", "?collection="])(
    "refuses a malformed target %s",
    async query => {
      const response = await get(query);
      expect(response.status).toBe(400);
      expect(status).not.toHaveBeenCalled();
    }
  );

  it("refuses a caller who is not signed in", async () => {
    requireAuthentication.mockResolvedValue({
      statusCode: 401,
      error: "Authentication required.",
    });
    const response = await get();
    expect(response.status).toBe(401);
    expect(status).not.toHaveBeenCalled();
  });
});
