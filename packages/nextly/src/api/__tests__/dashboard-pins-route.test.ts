/**
 * `/api/dashboard/pins`: what the read answers about the pins its reader may
 * no longer open (how many, never which), and the one request that removes
 * them, as the signed-in person and only for them.
 *
 * The service is the test's, so each case asserts what the route asked of it,
 * not only what it answered: a route that removed every pin, or named the
 * caller from the query, would answer 200 all the same.
 *
 * @module api/__tests__/dashboard-pins-route.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signedInPerson, service } = vi.hoisted(() => ({
  signedInPerson: vi.fn(),
  service: {
    read: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
    removeUnreadable: vi.fn(),
  },
}));

vi.mock("../signed-in-person", () => ({ signedInPerson }));
vi.mock("../authenticated-read", async importOriginal => ({
  ...(await importOriginal<typeof import("../authenticated-read")>()),
  readCaller: async (auth: { userId: string }) => ({
    user: { id: auth.userId },
  }),
}));
vi.mock("../../services/dashboard/dashboard-pins-service", () => ({
  dashboardPinsService: () => service,
}));

const { getDashboardPins, deleteDashboardPin } = await import(
  "../dashboard-pins"
);

const URL_BASE = "https://example.test/api/dashboard/pins";

beforeEach(() => {
  vi.clearAllMocks();
  signedInPerson.mockResolvedValue({ userId: "ana", authMethod: "session" });
});

describe("/api/dashboard/pins", () => {
  it("answers how many pins the reader may no longer open, and never which", async () => {
    service.read.mockResolvedValue({
      shown: [
        {
          targetType: "collection",
          targetSlug: "posts",
          entryId: "p1",
          title: "Hello",
          pinnedAt: "2026-11-17T09:00:00.000Z",
        },
      ],
      unreadableCount: 2,
    });

    const res = await getDashboardPins(new Request(URL_BASE));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.unreadableCount).toBe(2);
    // 🔴 No list of closed pins rides along under any name.
    expect(body).not.toHaveProperty("unreadable");
    expect(Object.keys(body).sort()).toEqual([
      "items",
      "meta",
      "unreadableCount",
    ]);
    expect(service.read).toHaveBeenCalledWith({ user: { id: "ana" } });
  });

  it("removes the signed-in reader's closed pins with ?unreadable=1, reading no body", async () => {
    service.removeUnreadable.mockResolvedValue(3);

    const res = await deleteDashboardPin(
      new Request(`${URL_BASE}?unreadable=1&userId=ben`, { method: "DELETE" })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "Removed 3 pins you could no longer open.",
      removed: 3,
    });
    // The signed-in person, whatever the query names.
    expect(service.removeUnreadable).toHaveBeenCalledWith({
      user: { id: "ana" },
    });
    expect(service.unpin).not.toHaveBeenCalled();
  });

  it("says one removal in the singular", async () => {
    service.removeUnreadable.mockResolvedValue(1);

    const res = await deleteDashboardPin(
      new Request(`${URL_BASE}?unreadable=1`, { method: "DELETE" })
    );

    expect(await res.json()).toEqual({
      message: "Removed 1 pin you could no longer open.",
      removed: 1,
    });
  });

  it("refuses an unreadable value other than 1, removing nothing", async () => {
    const res = await deleteDashboardPin(
      new Request(`${URL_BASE}?unreadable=all`, { method: "DELETE" })
    );

    expect(res.status).toBe(400);
    expect(service.removeUnreadable).not.toHaveBeenCalled();
    expect(service.unpin).not.toHaveBeenCalled();
  });

  it("asks who is signed in before removing anything", async () => {
    signedInPerson.mockRejectedValue(
      Object.assign(new Error("Only a signed-in person can do that."), {
        statusCode: 403,
      })
    );

    const res = await deleteDashboardPin(
      new Request(`${URL_BASE}?unreadable=1`, { method: "DELETE" })
    );

    expect(res.ok).toBe(false);
    expect(service.removeUnreadable).not.toHaveBeenCalled();
  });

  it("still unpins the one target a body names, without the query", async () => {
    service.unpin.mockResolvedValue(true);

    const res = await deleteDashboardPin(
      new Request(URL_BASE, {
        method: "DELETE",
        body: JSON.stringify({ targetType: "single", targetSlug: "site" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(await res.json()).toEqual({ message: "Unpinned.", unpinned: true });
    expect(service.unpin).toHaveBeenCalledWith(
      { user: { id: "ana" } },
      { targetType: "single", targetSlug: "site" }
    );
    expect(service.removeUnreadable).not.toHaveBeenCalled();
  });
});
