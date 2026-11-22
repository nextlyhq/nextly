/**
 * Which collections are closed to super-admin, and the question each way in
 * asks of a caller: the code's word wins, the admin's marks are read again
 * after a while, and only super-admin authority is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookups = vi.hoisted(() => ({ isSuperAdminOrRefuse: vi.fn() }));
vi.mock("../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../services/lib/permissions")>()),
  isSuperAdminOrRefuse: lookups.isSuperAdminOrRefuse,
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
  lookups.isSuperAdminOrRefuse.mockReset();
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

  it("never puts a transaction's read into the marks every request shares", async () => {
    vi.useFakeTimers();
    try {
      let pool: string[] = [];
      const read = vi.fn(async (executor?: unknown) =>
        // A transaction's snapshot from before the close.
        executor === undefined ? pool : []
      );
      useStoredClosedMarks(read);
      vi.setSystemTime(1_000_000);
      await refreshStoredClosedMarks();
      // The close commits; the shared marks are due again.
      pool = ["health"];
      vi.setSystemTime(1_000_000 + STORED_MARKS_TTL_MS + 1);

      // A question inside the transaction reads on it, and its answer stays
      // with that question: it is not kept, nor counted as a fresh read.
      lookups.isSuperAdminOrRefuse.mockResolvedValue(true);
      await superAdminRefusedOn("health", { userId: "root", executor: "tx" });
      expect(read).toHaveBeenLastCalledWith("tx");

      // So the next question outside it reads the pool, and sees the close.
      await refreshStoredClosedMarks();
      expect(read).toHaveBeenLastCalledWith();
      expect(isClosedToSuperAdmin("health")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses inside a transaction where either its own read or the shared marks close the collection", async () => {
    vi.useFakeTimers();
    try {
      lookups.isSuperAdminOrRefuse.mockResolvedValue(true);
      vi.setSystemTime(1_000_000);
      // A snapshot from before the close, the shared marks after it.
      useStoredClosedMarks(async executor =>
        executor === undefined ? ["health"] : []
      );
      await refreshStoredClosedMarks();
      expect(
        await superAdminRefusedOn("health", { userId: "root", executor: "tx" })
      ).toBe(true);
      // The transaction's own close, which the shared marks, now due, have
      // not read yet.
      holder.__nextly_closedToSuperAdmin = undefined;
      useStoredClosedMarks(async executor =>
        executor === undefined ? [] : ["notes"]
      );
      await refreshStoredClosedMarks();
      vi.setSystemTime(1_000_000 + STORED_MARKS_TTL_MS + 1);
      expect(
        await superAdminRefusedOn("notes", { userId: "root", executor: "tx" })
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps this instance's own change when a read that began before it ends after it", async () => {
    let finish: (slugs: string[]) => void = () => {};
    useStoredClosedMarks(
      () =>
        new Promise<string[]>(resolve => {
          finish = resolve;
        })
    );
    const pending = refreshStoredClosedMarks();
    noteStoredClosedMark("health", true);
    finish([]);
    await pending;
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
    lookups.isSuperAdminOrRefuse.mockResolvedValue(true);
    expect(await superAdminRefusedOn("pay", { userId: "root" })).toBe(true);
    expect(await superAdminRefusedOn("posts", { userId: "root" })).toBe(false);
  });

  it("refuses rather than letting a super-admin through when the roles cannot be read", async () => {
    lookups.isSuperAdminOrRefuse.mockRejectedValue(
      new Error("roles unreadable")
    );
    await expect(
      superAdminRefusedOn("pay", { userId: "root" })
    ).rejects.toThrow("roles unreadable");
  });

  it("asks on the caller's transaction where one is handed in", async () => {
    lookups.isSuperAdminOrRefuse.mockResolvedValue(true);
    await superAdminRefusedOn("pay", { userId: "root", executor: "tx" });
    expect(lookups.isSuperAdminOrRefuse).toHaveBeenCalledWith("root", "tx");
  });

  it("leaves any other person to the collection's own access", async () => {
    lookups.isSuperAdminOrRefuse.mockResolvedValue(false);
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
    expect(lookups.isSuperAdminOrRefuse).not.toHaveBeenCalled();
  });

  it("asks nothing about the caller for a collection that is not closed", async () => {
    expect(await superAdminRefusedOn("posts", { userId: "root" })).toBe(false);
    expect(lookups.isSuperAdminOrRefuse).not.toHaveBeenCalled();
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
