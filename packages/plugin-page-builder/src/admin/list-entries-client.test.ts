// @vitest-environment jsdom
/**
 * The canvas's data provider: each distinct read once, kept a short while,
 * and a refusal handed back in the shape the renderer recognises, so a sort
 * the reader refused falls back to id order on the canvas.
 */
import {
  createBlockResolver,
  createStandaloneContext,
  PageRenderer,
  type PageContext,
} from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ writePluginRoute: vi.fn() }));

const { canvasListCount, canvasListData, canvasListReadsIn } = await import(
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

  /** Draw a list as the canvas does: the renderer, reading through `data`. */
  async function drawList(
    props: Record<string, unknown>,
    context: Pick<PageContext, "data" | "locale">
  ): Promise<void> {
    const stream = await renderToReadableStream(
      createElement(PageRenderer, {
        document: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            { id: "list", type: "core/collection-loop", version: 1, props },
          ],
        },
        blocks: createBlockResolver(coreBlocks),
        context: { ...createStandaloneContext(), ...context },
        bindings: {},
      })
    );
    await stream.allReady;
    await new Response(stream).text();
  }

  it("is taken from the canvas's own read of the list, reading nothing more", async () => {
    const read = vi.fn(async () => counted(7));
    const data = canvasListData(read, () => 0);
    const count = canvasListCount(data, { locale: "fr" });
    const filters = [{ field: "title", op: "contains", value: "build" }];
    const props = {
      collection: "posts",
      filters,
      sort: "-title",
      limit: 3,
      offset: 5,
    };
    await drawList(props, { data, locale: "fr" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(await count(props)).toEqual({ matching: 7, shown: 2 });
    // The rows drawn and the count are one answer: no second read.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads in the language being edited, as the canvas does", async () => {
    const reads = canvasListReadsIn("fr", "u1");
    expect(canvasListReadsIn("fr", "u1")).toBe(reads);
    const { writePluginRoute } = await import("@nextlyhq/plugin-sdk/admin");
    vi.mocked(writePluginRoute).mockReset();
    vi.mocked(writePluginRoute).mockResolvedValue(counted(4));
    await expect(
      reads.count({ collection: "posts", limit: 2 })
    ).resolves.toEqual({ matching: 4, shown: 2 });
    expect(vi.mocked(writePluginRoute).mock.calls[0]?.[0]).toMatchObject({
      body: { query: { collection: "posts", locale: "fr" } },
    });
  });

  it("never hands one person's kept rows to another", async () => {
    const { writePluginRoute } = await import("@nextlyhq/plugin-sdk/admin");
    vi.mocked(writePluginRoute).mockReset();
    vi.mocked(writePluginRoute).mockResolvedValue(counted(3));
    const first = canvasListReadsIn("en", "author-a");
    await first.count({ collection: "posts", limit: 2 });
    expect(vi.mocked(writePluginRoute)).toHaveBeenCalledTimes(1);
    // Another person signs in in the same tab: their reads are their own,
    // and asking again reads again rather than answering from A's.
    const second = canvasListReadsIn("en", "author-b");
    expect(second).not.toBe(first);
    await second.count({ collection: "posts", limit: 2 });
    expect(vi.mocked(writePluginRoute)).toHaveBeenCalledTimes(2);
    // And A's are gone: coming back reads afresh too.
    expect(canvasListReadsIn("en", "author-a")).not.toBe(first);
  });

  it("reads nothing for a list one read cannot count", async () => {
    const read = vi.fn(async () => counted(7));
    const count = canvasListCount(
      canvasListData(read, () => 0),
      {}
    );
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
