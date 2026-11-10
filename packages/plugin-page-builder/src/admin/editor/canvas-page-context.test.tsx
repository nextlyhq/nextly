// @vitest-environment jsdom

/**
 * The page context the editor's canvas draws under: one object for the
 * editor's life, whose images resolve through the admin's media read.
 *
 * Without one the canvas drew under a stand-in whose media resolver answers
 * nothing, so an image chosen from the media library drew no picture at all.
 *
 * @module canvas-page-context.test
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const readMedia = vi.fn<(id: string) => Promise<unknown>>();
const identity = vi.fn<() => unknown>(() => null);
const userId = vi.fn<() => string>(() => "u1");
// The site's named queries, which the canvas's host is built from: none by
// default, answered per test where one asks.
const readPluginRoute = vi.fn<() => Promise<unknown>>(() =>
  Promise.resolve({ items: [], meta: {} })
);

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useMediaResolver: () => readMedia,
  useDocumentIdentity: () => identity(),
  useCurrentUserId: () => userId(),
  readPluginRoute: () => readPluginRoute(),
  writePluginRoute: vi.fn(),
}));

const {
  drawnListsOf,
  listEntryCollectionOf,
  namedHostRetryDelay,
  useCanvasPageContext,
  visitorListWords,
} = await import("./canvas-page-context");
const { canvasListReadsIn } = await import("../list-entries-client");

describe("the collection a document's lists read the entry of", () => {
  it("is a collection entry's collection, none on a Single, and not known without a document", () => {
    expect(listEntryCollectionOf({ kind: "collection", slug: "posts" })).toBe(
      "posts"
    );
    // A Single's page has no entry for a related list to read, which the
    // inspector says as the save refuses it.
    expect(listEntryCollectionOf({ kind: "single", slug: "home" })).toBeNull();
    expect(listEntryCollectionOf(null)).toBeUndefined();
  });

  it("is not known for a component, whatever entry stores it, as its save judges it", () => {
    // A component is drawn on the pages placing it, which are the entries.
    const component = { formatVersion: 1, kind: "component", nodes: [] };
    const store = { kind: "collection", slug: "nx_pb_components" };
    expect(listEntryCollectionOf(store, component)).toBeUndefined();
    // CONTROL: a page stored there is that collection's entry.
    expect(listEntryCollectionOf(store, { ...component, kind: "page" })).toBe(
      "nx_pb_components"
    );
  });
});

describe("the canvas's page context", () => {
  it("resolves a media id through the admin's media read", async () => {
    readMedia.mockResolvedValue({
      id: "m1",
      url: "/uploads/hero.jpg",
      altText: "The hero",
      width: 1600,
      height: 900,
    });
    const { result } = renderHook(() => useCanvasPageContext());
    await expect(result.current.resolveMedia("m1")).resolves.toEqual({
      url: "/uploads/hero.jpg",
      alt: "The hero",
      width: 1600,
      height: 900,
    });
    expect(readMedia).toHaveBeenCalledWith("m1");
  });

  it("answers nothing for an item the library cannot read", async () => {
    readMedia.mockResolvedValue(null);
    const { result } = renderHook(() => useCanvasPageContext());
    await expect(result.current.resolveMedia("gone")).resolves.toBeNull();
  });

  it("draws an icon from the set a published page draws with", async () => {
    const { result } = renderHook(() => useCanvasPageContext());
    const star = await result.current.resolveIcon?.("lucide:star");
    expect(star?.id).toBe("lucide:star");
    expect(star?.body).toContain("<path");
    // An id the set does not draw answers nothing, so the block draws nothing.
    await expect(
      result.current.resolveIcon?.("lucide:not-an-icon")
    ).resolves.toBeNull();
  });

  it("is one object for the editor's life, which the canvas keeps its drawn blocks by", () => {
    const { result, rerender } = renderHook(() => useCanvasPageContext());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("draws a list as an author looks at it, with entries read for the canvas", () => {
    const { result } = renderHook(() => useCanvasPageContext());
    expect(result.current.diagnostics).toBe(true);
    // The canvas can act on a note's action, which a preview cannot.
    expect(result.current.listNoteActions).toBe(true);
    // The canvas's own reader, not the stand-in that answers no rows.
    expect(typeof result.current.data?.find).toBe("function");
    expect(result.current.listsShowingEmpty).toBeUndefined();
  });

  it("names the lists shown empty, and is the editor's one object again when none is", () => {
    const { result, rerender } = renderHook(
      ({ empty }: { empty: ReadonlySet<string> | undefined }) =>
        useCanvasPageContext(empty),
      {
        initialProps: { empty: undefined } as {
          empty: ReadonlySet<string> | undefined;
        },
      }
    );
    const first = result.current;
    const chosen = new Set(["list"]);
    rerender({ empty: chosen });
    expect(result.current).not.toBe(first);
    expect(result.current.listsShowingEmpty).toBe(chosen);
    expect(result.current.resolveMedia).toBe(first.resolveMedia);
    rerender({ empty: new Set() });
    expect(result.current).toBe(first);
  });

  it("names the entry the document is stored on, so a list of its related entries reads it", () => {
    identity.mockReturnValue({
      kind: "collection",
      slug: "stories",
      documentId: "s1",
    });
    const { result } = renderHook(() => useCanvasPageContext());
    expect(result.current.entry).toEqual({ id: "s1" });
    expect(result.current.entryCollection).toBe("stories");
    identity.mockReturnValue(null);
  });

  it("reads its lists in the language being edited, through the reads its count shares", () => {
    const { result } = renderHook(() => useCanvasPageContext(undefined, "fr"));
    expect(result.current.locale).toBe("fr");
    expect(result.current.data).toBe(canvasListReadsIn("fr", "u1").data);
  });

  it("bounds each draw's reads, with a fresh allowance for the next draw", () => {
    const { result, rerender } = renderHook(() => useCanvasPageContext());
    const first = result.current;
    const budget = first.queries;
    expect(budget).toBeDefined();
    let taken = 0;
    while (budget?.take() === true && taken <= 10_000) taken += 1;
    // The published page's own allowance, then nothing more this draw.
    expect(taken).toBe(500);
    rerender();
    // Drawn again: the same object, which the canvas keeps its blocks by,
    // with its allowance renewed.
    expect(result.current).toBe(first);
    expect(result.current.queries?.take()).toBe(true);
  });
});

describe("the canvas's host for named queries", () => {
  it("asks again after a failed read of the site's queries, rather than drawing without them for the session", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Its own person, so no host an earlier test made is reused.
      userId.mockReturnValue("u-retry");
      readPluginRoute
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ items: [], meta: {} });
      const { result } = renderHook(() => useCanvasPageContext());
      // The first ask failed: no host yet, so a named list draws its template.
      await waitFor(() => expect(readPluginRoute).toHaveBeenCalled());
      expect(result.current.namedQueries).toBeUndefined();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(namedHostRetryDelay(1));
      });
      await waitFor(() => expect(result.current.namedQueries).toBeDefined());
    } finally {
      userId.mockReturnValue("u1");
      vi.useRealTimers();
    }
  });

  it("waits longer after each failure, to a cap", () => {
    expect(namedHostRetryDelay(1)).toBe(2000);
    expect(namedHostRetryDelay(2)).toBe(4000);
    expect(namedHostRetryDelay(10)).toBe(60_000);
  });
});

describe("a list the canvas reads as a visitor reads it", () => {
  const list = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: "core/collection-loop",
    version: 1,
    props: { collection: "posts", limit: 10 },
    ...extra,
  });

  it("is counted once for each list the page draws, none inside another's entries", () => {
    const nested = list("inner");
    // A list in another's empty state is drawn once, so it counts.
    const outer = list("outer", {
      slots: { children: [nested], empty: [list("when-empty")] },
    });
    const box = {
      id: "box",
      type: "core/container",
      version: 1,
      props: {},
      slots: { children: [list("boxed")] },
    };
    expect(drawnListsOf([outer, box]).map(found => found.id)).toEqual([
      "outer",
      "when-empty",
      "boxed",
    ]);
  });

  it("says so only where a visitor sees fewer entries", () => {
    expect(visitorListWords(6, 4)).toBe(
      "Showing what visitors see: 4 of 6 entries"
    );
    expect(visitorListWords(1, 0)).toBe(
      "Showing what visitors see: 0 of 1 entry"
    );
    expect(visitorListWords(4, 4)).toBeUndefined();
    expect(visitorListWords(undefined, 4)).toBeUndefined();
  });

  it("wears the words on the canvas: what the list drew as a visitor reads it, beside the person's own rows", async () => {
    const { writePluginRoute } = await import("@nextlyhq/plugin-sdk/admin");
    vi.mocked(writePluginRoute).mockReset();
    vi.mocked(writePluginRoute).mockImplementation(async request => {
      const body = (request as { body: Record<string, unknown> }).body;
      const total = body.visitor === undefined ? 6 : 4;
      return {
        items: Array.from({ length: total }, (_, at) => ({ id: `p${at}` })),
        meta: {
          total,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    });
    userId.mockReturnValue("visitor-notes");
    const asVisitor = {
      visitor: { collection: "pages", id: "p1" },
      nodes: [list("posts-list")],
    };
    const { result } = renderHook(() =>
      useCanvasPageContext(
        undefined,
        "en",
        undefined,
        undefined,
        undefined,
        asVisitor
      )
    );
    // The canvas's lists read as a visitor.
    await result.current.data.find({ collection: "posts" });
    expect(
      vi
        .mocked(writePluginRoute)
        .mock.calls.some(
          ([request]) =>
            (request as { body: Record<string, unknown> }).body.visitor !==
            undefined
        )
    ).toBe(true);
    // Nothing is said before the list has drawn.
    expect(result.current.listsShowingVisitors).toBeUndefined();
    // The list tells what it drew; a list drawing nothing (its allowance
    // spent, say) is said to show none, however many a read would find.
    act(() => {
      result.current.listShown?.("posts-list", 0);
    });
    await waitFor(() => {
      expect(result.current.listsShowingVisitors?.get("posts-list")).toBe(
        "Showing what visitors see: 0 of 6 entries"
      );
    });
    userId.mockReturnValue("u1");
  });
});
