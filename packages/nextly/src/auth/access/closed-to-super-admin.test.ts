/**
 * Which collections are closed to super-admin, and the question each way in
 * asks of a caller: the code's word wins, the admin's marks are read again
 * after a while, and only super-admin authority is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookups = vi.hoisted(() => ({ userIsSuperAdmin: vi.fn() }));
vi.mock("./resolve-actor", () => ({
  userIsSuperAdmin: lookups.userIsSuperAdmin,
}));

import {
  STORED_MARKS_TTL_MS,
  closedCollections,
  closedMarkOf,
  declareClosedToSuperAdmin,
  isClosedToSuperAdmin,
  noteStoredClosedMark,
  refreshStoredClosedMarks,
  useStoredClosedMarks,
} from "./closed-to-super-admin";
import { userActor } from "./actor";
import { superAdminRefusedOn } from "./closed-to-super-admin-refusal";
import { decide } from "./decide";

const holder = globalThis as { __nextly_closedToSuperAdmin?: unknown };

beforeEach(() => {
  holder.__nextly_closedToSuperAdmin = undefined;
  lookups.userIsSuperAdmin.mockReset();
});

afterEach(() => {
  holder.__nextly_closedToSuperAdmin = undefined;
});

describe("a collection's mark", () => {
  it("is the code's where the code says it, whatever the admin stored", async () => {
    declareClosedToSuperAdmin([
      { slug: "pay", closedToSuperAdmin: true },
      { slug: "notes", closedToSuperAdmin: false },
      { slug: "posts" },
    ]);
    useStoredClosedMarks(async () => ["notes", "health"]);
    await refreshStoredClosedMarks();

    expect(closedMarkOf("pay")).toEqual({ closed: true, setIn: "code" });
    expect(closedMarkOf("notes")).toEqual({ closed: false, setIn: "code" });
    expect(closedMarkOf("health")).toEqual({ closed: true, setIn: "admin" });
    expect(closedMarkOf("posts")).toEqual({ closed: false, setIn: null });
    expect(closedCollections()).toEqual(["health", "pay"]);
  });

  it("reads the admin's marks again only once they are older than the limit", async () => {
    let stored = ["health"];
    const read = vi.fn(async () => stored);
    useStoredClosedMarks(read);
    await refreshStoredClosedMarks({ now: 1_000_000 });
    stored = [];
    await refreshStoredClosedMarks({ now: 1_000_001 });
    expect(isClosedToSuperAdmin("health")).toBe(true);
    await refreshStoredClosedMarks({
      now: Date.now() + STORED_MARKS_TTL_MS + 1,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(isClosedToSuperAdmin("health")).toBe(false);
  });

  it("reads on the caller's transaction when asked inside one, joining no read on the pool", async () => {
    const read = vi.fn(async (_executor?: unknown) => ["health"]);
    useStoredClosedMarks(read);
    await refreshStoredClosedMarks({ executor: "tx" });
    expect(read).toHaveBeenCalledWith("tx");
    expect(isClosedToSuperAdmin("health")).toBe(true);
  });

  it("takes this instance's own change at once", () => {
    noteStoredClosedMark("health", true);
    expect(isClosedToSuperAdmin("health")).toBe(true);
    noteStoredClosedMark("health", false);
    expect(isClosedToSuperAdmin("health")).toBe(false);
  });

  it("fails the question rather than answering from marks it could not read", async () => {
    useStoredClosedMarks(async () => {
      throw new Error("the database is down");
    });
    await expect(
      superAdminRefusedOn("health", { userId: "u1" })
    ).rejects.toThrow("the database is down");
  });
});

describe("the question each way in asks", () => {
  beforeEach(() => {
    declareClosedToSuperAdmin([{ slug: "pay", closedToSuperAdmin: true }]);
  });

  it("refuses a super-admin person on a closed collection, and only there", async () => {
    lookups.userIsSuperAdmin.mockResolvedValue(true);
    expect(await superAdminRefusedOn("pay", { userId: "root" })).toBe(true);
    expect(await superAdminRefusedOn("posts", { userId: "root" })).toBe(false);
  });

  it("leaves any other person to the collection's own access", async () => {
    lookups.userIsSuperAdmin.mockResolvedValue(false);
    expect(await superAdminRefusedOn("pay", { userId: "editor" })).toBe(false);
    expect(await superAdminRefusedOn("pay", {})).toBe(false);
  });

  it("refuses a key carrying super-admin authority, and no other key", async () => {
    expect(
      await superAdminRefusedOn("pay", {
        userId: "root",
        keyHoldsSuperAdmin: true,
      })
    ).toBe(true);
    expect(
      await superAdminRefusedOn("pay", {
        userId: "root",
        keyHoldsSuperAdmin: false,
      })
    ).toBe(false);
    // A key is judged by its own authority, never by its maker's roles.
    expect(lookups.userIsSuperAdmin).not.toHaveBeenCalled();
  });

  it("asks nothing about the caller for a collection that is not closed", async () => {
    expect(await superAdminRefusedOn("posts", { userId: "root" })).toBe(false);
    expect(lookups.userIsSuperAdmin).not.toHaveBeenCalled();
  });
});

describe("the access decision", () => {
  it("refuses super-admin authority on a closed collection, and passes it elsewhere", async () => {
    declareClosedToSuperAdmin([{ slug: "pay", closedToSuperAdmin: true }]);
    const root = userActor({
      userId: "root",
      roles: ["super-admin"],
      permissions: [],
    });
    expect(
      await decide(root, "read", { kind: "collection", slug: "pay" })
    ).toEqual({
      allowed: false,
      reason: "closed-to-super-admin",
    });
    expect(
      (await decide(root, "read", { kind: "collection", slug: "posts" }))
        .allowed
    ).toBe(true);
    // A Single cannot be closed: a slug a collection closes does not close it.
    expect(
      (await decide(root, "read", { kind: "single", slug: "pay" })).allowed
    ).toBe(true);
  });
});
