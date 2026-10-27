/**
 * `/api/notices`: whose notices, and who may ask.
 *
 * The person is always the signed-in user. These tests assert what the route
 * asked of the service — the userId it passed — rather than only the response,
 * because a route that read a `userId` from the query would answer 200 with
 * someone else's notices and look exactly like one that did not.
 *
 * @module api/__tests__/notices-route.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthentication, service } = vi.hoisted(() => ({
  requireAuthentication: vi.fn(),
  service: {
    find: vi.fn(async () => ({ rows: [], total: 0, page: 1, limit: 20 })),
    count: vi.fn(async () => 3),
    markRead: vi.fn(async () => 2),
  },
}));

vi.mock("../../auth/middleware", () => ({
  requireAuthentication,
  isErrorResponse: () => false,
}));
vi.mock("../../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: (e: unknown) => e,
}));
vi.mock("../../di", () => ({ container: { get: () => service } }));

const { getNotices, getNoticeCount, markNoticesRead } = await import(
  "../notices"
);

const session = { userId: "alice", authMethod: "session" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthentication.mockResolvedValue(session);
});

const get = (path: string) =>
  new Request(`https://example.test/api/notices${path}`);
const post = (body: unknown) =>
  new Request("https://example.test/api/notices/read", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("/api/notices", () => {
  it("reads the signed-in person's notices, whatever the query names", async () => {
    const res = await getNotices(get("?userId=bob&unread=true&page=2&limit=5"));
    expect(res.status).toBe(200);
    expect(service.find).toHaveBeenCalledWith({
      userId: "alice",
      unread: true,
      page: 2,
      limit: 5,
    });
    // A per-person answer is never kept by a shared cache.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("counts the signed-in person's unread notices", async () => {
    const res = await getNoticeCount(get("/count?unread=true"));
    expect(await res.json()).toEqual({ total: 3 });
    expect(service.count).toHaveBeenCalledWith({
      userId: "alice",
      unread: true,
    });
  });

  it("marks read only for the signed-in person", async () => {
    const res = await markNoticesRead(post({ ids: ["n1", "n2"] }));
    expect(res.status).toBe(200);
    expect(service.markRead).toHaveBeenCalledWith({
      userId: "alice",
      ids: ["n1", "n2"],
    });
    await markNoticesRead(post({ all: true }));
    expect(service.markRead).toHaveBeenLastCalledWith({
      userId: "alice",
      all: true,
    });
  });

  it.each([
    ["a body naming another person", { ids: ["n1"], userId: "bob" }],
    ["a body with neither ids nor all", {}],
    ["`all` that is not true", { all: false }],
  ])("refuses %s", async (_, body) => {
    const res = await markNoticesRead(post(body));
    expect(res.status).toBe(400);
    expect(service.markRead).not.toHaveBeenCalled();
  });

  it.each([
    ["unread that is not true or false", "?unread=yes"],
    ["a page that is not a whole number", "?page=2a"],
  ])("refuses %s", async (_, query) => {
    const res = await getNotices(get(query));
    expect(res.status).toBe(400);
    expect(service.find).not.toHaveBeenCalled();
  });

  it("refuses an API key on every route, before reading anything", async () => {
    // Notices are a person's own inbox in the admin; a key has none.
    requireAuthentication.mockResolvedValue({
      userId: "alice",
      authMethod: "api-key",
    });
    for (const res of [
      await getNotices(get("")),
      await getNoticeCount(get("/count")),
      await markNoticesRead(post({ all: true })),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error: { message: "Only a signed-in person can have notices." },
      });
    }
    expect(service.find).not.toHaveBeenCalled();
    expect(service.count).not.toHaveBeenCalled();
    expect(service.markRead).not.toHaveBeenCalled();
  });
});
