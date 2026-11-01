/**
 * Where an item is used, as the library reads the usage route's answer: the
 * documents and how many more, and, for the uses by address, the avatars and
 * logos keeping the address and whether the usage record has been built.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock("@admin/services/mediaApi", () => ({ mediaFetchJson: fetchJson }));

import { fetchMediaUsage } from "../media-library-api";

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

  it("counts none and takes the record as built when the answer says nothing of them", async () => {
    fetchJson.mockResolvedValue({ items: [], meta: {} });

    expect(await fetchMediaUsage("m1")).toEqual({
      items: [],
      hidden: 0,
      heldByAddress: 0,
      usageRecorded: true,
    });
  });
});
