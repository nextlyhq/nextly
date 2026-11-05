// @vitest-environment jsdom
/**
 * The canvas's data provider: each distinct read once, kept a short while,
 * and a refusal handed back in the shape the renderer recognises, so a sort
 * the reader refused falls back to id order on the canvas.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ writePluginRoute: vi.fn() }));

const { canvasListCount, canvasListData } = await import(
  "./list-entries-client"
);

const ANSWER = {
  items: [{ id: "p1" }],
  meta: {
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
};

describe("the canvas's list data", () => {
  it("reads each distinct query once while its answer is kept, and again after", async () => {
    let clock = 0;
    const read = vi.fn(async () => ANSWER);
    const data = canvasListData(read, () => clock);
    const query = { collection: "posts", limit: 3 };
    expect(await data.find(query)).toEqual({ items: ANSWER.items, total: 1 });
    await data.find({ ...query });
    expect(read).toHaveBeenCalledTimes(1);
    await data.find({ collection: "posts", limit: 4 });
    expect(read).toHaveBeenCalledTimes(2);
    clock = 60_000;
    await data.find(query);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("keeps no refusal, so the next draw asks again", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(ANSWER);
    const data = canvasListData(read, () => 0);
    await expect(data.find({ collection: "posts" })).rejects.toThrow("down");
    await expect(data.find({ collection: "posts" })).resolves.toEqual({
      items: ANSWER.items,
      total: 1,
    });
  });
});

describe("a refusal, as the renderer reads it", () => {
  it("carries the route's code and problems as a server-side read's error does", async () => {
    const { writePluginRoute } = await import("@nextlyhq/plugin-sdk/admin");
    vi.mocked(writePluginRoute).mockRejectedValue(
      Object.assign(new Error("Validation failed."), {
        status: 400,
        code: "VALIDATION_ERROR",
        data: {
          errors: [{ path: "sort.rating", code: "FIELD_NOT_SORTABLE" }],
        },
      })
    );
    const data = canvasListData();
    const refused = await data
      .find({ collection: "posts", sort: "-rating" })
      .catch((error: unknown) => error);
    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      publicMessage: "Validation failed.",
      publicData: {
        errors: [{ path: "sort.rating", code: "FIELD_NOT_SORTABLE" }],
      },
    });
  });
});

describe("the editor's count of a list", () => {
  const counted = (total: number) => ({
    ...ANSWER,
    meta: { ...ANSWER.meta, total },
  });

  it("is one read of the list's filtered ids, its window applied to the total", async () => {
    const read = vi.fn(async () => counted(7));
    const count = canvasListCount(canvasListData(read, () => 0));
    const filters = [{ field: "title", op: "contains", value: "build" }];
    const props = { collection: "posts", filters, limit: 3, offset: 5 };
    expect(await count(props)).toEqual({ matching: 7, shown: 2 });
    // The list's own filters, one row of ids, no sort and no window.
    expect(read).toHaveBeenCalledWith({
      collection: "posts",
      filters,
      limit: 1,
      select: ["id"],
    });
    // Another window or sort over the same entries counts nothing again.
    expect(await count({ ...props, offset: 0, sort: "-title" })).toEqual({
      matching: 7,
      shown: 3,
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads nothing for a list one read cannot count", async () => {
    const read = vi.fn(async () => counted(7));
    const count = canvasListCount(canvasListData(read, () => 0));
    await expect(
      count({
        collection: "posts",
        relation: { of: "entry", field: "related" },
      })
    ).resolves.toBeUndefined();
    await expect(count({})).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});
