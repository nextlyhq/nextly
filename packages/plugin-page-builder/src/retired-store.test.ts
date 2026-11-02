/**
 * The retired-ids store: what it reads, and that recording is idempotent.
 *
 * The properties under test are the ones a plausible store gets wrong: a read
 * made on a user's behalf (which the table answers with nothing), a read that
 * stops after the first page (a retired id left unknown is a value kept), and
 * a race with another publish read as a failure.
 */
import { describe, expect, it } from "vitest";

import { retiredKey } from "./collections/component-retired-exposures";
import { retiredStore, type RetiredDirectApi } from "./retired-store";

type Row = Record<string, unknown>;

/** A Direct API over an in-memory table, with the one filter the store uses. */
function fakeApi(rows: Row[], pageSize = 200) {
  const calls: { overrideAccess?: boolean }[] = [];
  const api: RetiredDirectApi = {
    find: async args => {
      calls.push(args);
      const ids = (args.where?.componentId as { in: string[] }).in;
      const all = rows.filter(row => ids.includes(row.componentId as string));
      const page = args.page ?? 1;
      const size = Math.min(args.limit ?? pageSize, pageSize);
      const items = all.slice((page - 1) * size, page * size);
      return { items, meta: { hasNext: page * size < all.length } };
    },
    create: async args => {
      calls.push(args);
      if (rows.some(row => row.identity === args.data.identity)) {
        throw new Error("duplicate key");
      }
      rows.push(args.data);
      return args.data;
    },
  };
  return { api, calls, rows };
}

const row = (componentId: string, kind: string, exposureId: string): Row => ({
  identity: retiredKey(componentId, kind as "property", exposureId),
  componentId,
  kind,
  exposureId,
});

describe("reading retired ids", () => {
  it("answers each component's ids, as the system, past the first page", async () => {
    const stored = [
      ...Array.from({ length: 5 }, (_, i) => row("hero", "property", `p${i}`)),
      row("hero", "slot", "aside"),
      row("other", "property", "x"),
    ];
    const { api, calls } = fakeApi(stored, 2);
    const store = retiredStore({ nextly: async () => api, collection: "t" });

    const retired = await store.of(["hero"]);

    expect(retired.get("hero")).toEqual({
      properties: ["p0", "p1", "p2", "p3", "p4"],
      slots: ["aside"],
    });
    expect(retired.has("other")).toBe(false);
    expect(calls.every(call => call.overrideAccess === true)).toBe(true);
  });

  it("reads nothing for no components", async () => {
    const { api, calls } = fakeApi([]);
    const store = retiredStore({ nextly: async () => api, collection: "t" });

    expect((await store.of([])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("recording retired ids", () => {
  it("records each id once, however often it is retired", async () => {
    const { api, rows } = fakeApi([row("hero", "property", "title")]);
    const store = retiredStore({ nextly: async () => api, collection: "t" });

    await store.retire("hero", {
      properties: ["title", "body"],
      slots: ["aside"],
    });
    await store.retire("hero", { properties: ["body"], slots: [] });

    expect(rows.map(stored => stored.identity).sort()).toEqual(
      [
        retiredKey("hero", "property", "title"),
        retiredKey("hero", "property", "body"),
        retiredKey("hero", "slot", "aside"),
      ].sort()
    );
  });

  it("accepts a concurrent publish recording the same id first", async () => {
    const { api, rows } = fakeApi([]);
    // The other publish lands between this store's read and its create.
    const racing: RetiredDirectApi = {
      ...api,
      create: async args => {
        rows.push(args.data);
        throw new Error("duplicate key");
      },
    };
    const store = retiredStore({ nextly: async () => racing, collection: "t" });

    await expect(
      store.retire("hero", { properties: ["title"], slots: [] })
    ).resolves.toBeUndefined();
  });

  it("raises a failed create that recorded nothing", async () => {
    const { api } = fakeApi([]);
    const failing: RetiredDirectApi = {
      ...api,
      create: async () => {
        throw new Error("database down");
      },
    };
    const store = retiredStore({
      nextly: async () => failing,
      collection: "t",
    });

    await expect(
      store.retire("hero", { properties: ["title"], slots: [] })
    ).rejects.toThrow("database down");
  });
});
