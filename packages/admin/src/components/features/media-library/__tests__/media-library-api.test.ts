/**
 * Where an item is used, as the library reads the usage route's answer: the
 * documents and how many more, and, for the uses by address, the avatars and
 * logos keeping the address and whether the usage record has been built.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock("@admin/services/mediaApi", () => ({ mediaFetchJson: fetchJson }));

import {
  deleteMediaLater,
  fetchMediaUsage,
  undoMediaDelete,
} from "../media-library-api";

beforeEach(() => {
  fetchJson.mockReset();
});

describe("fetchMediaUsage", () => {
  it("reads the avatars and logos keeping the address, and whether the record is built", async () => {
    fetchJson.mockResolvedValue({
      items: [],
      meta: {
        hidden: [{ count: 2 }],
        heldByAddress: 3,
        usageRecorded: false,
      },
    });

    expect(await fetchMediaUsage("m1", { byAddress: true })).toEqual({
      items: [],
      hidden: 2,
      heldByAddress: 3,
      usageRecorded: false,
    });
    expect(fetchJson).toHaveBeenCalledWith(
      "/admin/api/media/m1/usage?byAddress=true",
      undefined
    );
  });

  it("counts none, and takes the record as not yet built, when the answer says nothing of them", async () => {
    fetchJson.mockResolvedValue({ items: [], meta: {} });

    expect(await fetchMediaUsage("m1")).toEqual({
      items: [],
      hidden: 0,
      heldByAddress: 0,
      usageRecorded: false,
    });
  });

  it("takes the record as built when the answer says so", async () => {
    // POSITIVE CONTROL for the one above.
    fetchJson.mockResolvedValue({ items: [], meta: { usageRecorded: true } });

    expect((await fetchMediaUsage("m1")).usageRecorded).toBe(true);
  });
});

/** `n` item ids, `m0` onward. */
function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `m${i}`);
}

/** The ids each request to `path` sent, in order. */
function sentTo(path: string): string[][] {
  return fetchJson.mock.calls
    .filter(([url]) => url === path)
    .map(
      ([, init]) => (JSON.parse(String(init.body)) as { ids: string[] }).ids
    );
}

describe("a delete of more items than one request takes", () => {
  it("sends the items in requests of at most a hundred, answering every id and the earliest deadline", async () => {
    const early = new Date(Date.now() + 9_000).toISOString();
    const late = new Date(Date.now() + 10_000).toISOString();
    fetchJson.mockImplementation((_url: string, init: RequestInit) => {
      const sent = (JSON.parse(String(init.body)) as { ids: string[] }).ids;
      return Promise.resolve({
        ids: sent,
        // The first batch was marked earlier, so its window ends first.
        deleteAfter: sent[0] === "m0" ? early : late,
      });
    });

    const pending = await deleteMediaLater(ids(150));

    expect(sentTo("/admin/api/media/deletions")).toEqual([
      ids(150).slice(0, 100),
      ids(150).slice(100),
    ]);
    expect(pending).toEqual({ ids: ids(150), deleteAfter: early });
  });

  it("brings back the batches already taken when a later one fails, and fails", async () => {
    fetchJson.mockImplementation((url: string, init: RequestInit) => {
      const sent = (JSON.parse(String(init.body)) as { ids: string[] }).ids;
      if (url === "/admin/api/media/deletions/undo") {
        return Promise.resolve({ restored: sent, gone: [] });
      }
      if (sent[0] === "m100") return Promise.reject(new Error("refused"));
      return Promise.resolve({
        ids: sent,
        deleteAfter: new Date(Date.now() + 10_000).toISOString(),
      });
    });

    await expect(deleteMediaLater(ids(150))).rejects.toThrow("refused");

    expect(sentTo("/admin/api/media/deletions/undo")).toEqual([
      ids(150).slice(0, 100),
    ]);
  });

  it("undoes in requests of at most a hundred, answering every id", async () => {
    fetchJson.mockImplementation((_url: string, init: RequestInit) => {
      const sent = (JSON.parse(String(init.body)) as { ids: string[] }).ids;
      // The last item's window had already ended.
      return Promise.resolve({
        restored: sent.filter(id => id !== "m149"),
        gone: sent.filter(id => id === "m149"),
      });
    });

    const undone = await undoMediaDelete(ids(150));

    expect(sentTo("/admin/api/media/deletions/undo")).toEqual([
      ids(150).slice(0, 100),
      ids(150).slice(100),
    ]);
    expect(undone).toEqual({
      restored: ids(149),
      gone: ["m149"],
    });
  });

  it("sends a delete of a hundred or fewer as one request", async () => {
    // POSITIVE CONTROL: a selection within the limit is unchanged.
    fetchJson.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve({
        ids: (JSON.parse(String(init.body)) as { ids: string[] }).ids,
        deleteAfter: new Date(Date.now() + 10_000).toISOString(),
      })
    );

    await deleteMediaLater(ids(100));

    expect(sentTo("/admin/api/media/deletions")).toEqual([ids(100)]);
  });
});
