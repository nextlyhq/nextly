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
        hiddenCount: 2,
        heldByAddress: 3,
        usageRecorded: false,
      },
    });

    expect(await fetchMediaUsage("m1", { byAddress: true })).toEqual({
      items: [],
      hidden: 2,
      // Not counted by the answer: the documents it names.
      total: 2,
      hasNext: false,
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
      total: 0,
      hasNext: false,
      heldByAddress: 0,
      usageRecorded: false,
    });
  });

  it("asks for a later page, and reads how many documents there are in all", async () => {
    fetchJson.mockResolvedValue({
      items: [],
      meta: { total: 45, hasNext: true, hiddenCount: 1 },
    });

    const usage = await fetchMediaUsage("m1", { byAddress: true, page: 2 });

    expect(usage).toMatchObject({ total: 45, hasNext: true, hidden: 1 });
    expect(fetchJson).toHaveBeenCalledWith(
      "/admin/api/media/m1/usage?byAddress=true&page=2",
      undefined
    );
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

describe("a delete of many items", () => {
  it("sends every item in one request, so the server marks them whole or not at all", async () => {
    const deleteAfter = new Date(Date.now() + 10_000).toISOString();
    fetchJson.mockImplementation((_url: string, init: RequestInit) => {
      const sent = (JSON.parse(String(init.body)) as { ids: string[] }).ids;
      return Promise.resolve({ ids: sent, marked: sent, deleteAfter });
    });

    const pending = await deleteMediaLater(ids(150));

    expect(sentTo("/admin/api/media/deletions")).toEqual([ids(150)]);
    expect(pending).toEqual({
      ids: ids(150),
      marked: ids(150),
      deleteAfter,
    });
  });

  it("undoes every item in one request", async () => {
    fetchJson.mockImplementation((_url: string, init: RequestInit) => {
      const sent = (JSON.parse(String(init.body)) as { ids: string[] }).ids;
      return Promise.resolve({ restored: sent, gone: [] });
    });

    await undoMediaDelete(ids(150));

    expect(sentTo("/admin/api/media/deletions/undo")).toEqual([ids(150)]);
  });
});
