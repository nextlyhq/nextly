// @vitest-environment jsdom
/**
 * The editor's change check: one ask on opening, hidden or not, then a
 * minute after the last ask while the builder's tab is visible, none on the
 * minute while it is hidden and one on coming back to it; one again whenever
 * what the canvas kept is dropped; a different mark drops what the canvas
 * kept, the same mark nothing. What was kept also goes when the canvas starts
 * reading a new source, on signing out, on closing the editor and when this
 * editor stores the document.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** When the document was last stored, as the editor's document actions say. */
const stored = vi.hoisted(() => ({ at: null as Date | null }));
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: vi.fn(),
  useDocumentActions: () => ({ storedAt: stored.at }),
}));

const { canvasSourcesChanged, onCanvasSourcesChanged } = await import(
  "../canvas-sources"
);
const {
  SOURCE_CHECK_EVERY_MS,
  firstReadsInOf,
  useCanvasSourceCheck,
  useDropKeptReadsOnSave,
} = await import("./canvas-source-check");

const ASKED = {
  source: { kind: "collection" as const, slug: "pages", id: "p1" },
  singles: ["home"],
  lists: ["posts"],
};

let visibility: DocumentVisibilityState = "visible";
let dropped = 0;
let stopHearing: () => void = () => {};

function show(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // A frame is the next microtask here, so a case reads its asks once it
  // awaits the clock; the one about paint takes the frames itself.
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    queueMicrotask(() => run(0));
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility
  );
  dropped = 0;
  stopHearing = onCanvasSourcesChanged(() => {
    dropped += 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  stopHearing();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the canvas's change check", () => {
  it("asks once on opening, then once a minute while the tab is visible", async () => {
    const ask = vi.fn(async () => "same");
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask));
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(ASKED);
    await vi.advanceTimersByTimeAsync(5 * SOURCE_CHECK_EVERY_MS);
    expect(ask).toHaveBeenCalledTimes(6);
    // The same mark each time: nothing the canvas kept is dropped.
    expect(dropped).toBe(0);
  });

  it("asks nothing on a fresh open until the canvas's first reads are in, then asks once", async () => {
    const ask = vi.fn(async () => "same");
    const { rerender } = renderHook(
      ({ firstReadsIn }) =>
        useCanvasSourceCheck(ASKED, "u1", ask, firstReadsIn),
      { initialProps: { firstReadsIn: false } }
    );
    await vi.advanceTimersByTimeAsync(5_000);
    // Opening the builder sends nothing for the check while the canvas reads.
    expect(ask).not.toHaveBeenCalled();
    rerender({ firstReadsIn: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(1);
    // An answer that comes in again later asks nothing more on its own.
    rerender({ firstReadsIn: false });
    rerender({ firstReadsIn: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("takes the first mark only once the canvas has painted, two frames on", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.push(run);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const ask = vi.fn(async () => "same");
    const { unmount } = renderHook(() =>
      useCanvasSourceCheck(ASKED, "u1", ask, true)
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).not.toHaveBeenCalled();
    // The frame that paints what the first reads drew...
    frames.shift()?.(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).not.toHaveBeenCalled();
    // ...and the next one, after it painted.
    frames.shift()?.(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("takes the mark on the minute when the canvas's first reads never answer", async () => {
    const ask = vi.fn(async () => "same");
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask, false));
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS - 1);
    expect(ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(1);
    // And goes on each minute from there.
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("asks once when the tab comes back before the first reads, and not again when they arrive", async () => {
    visibility = "hidden";
    const ask = vi.fn(async () => "same");
    const { rerender } = renderHook(
      ({ firstReadsIn }) =>
        useCanvasSourceCheck(ASKED, "u1", ask, firstReadsIn),
      { initialProps: { firstReadsIn: false } }
    );
    await vi.advanceTimersByTimeAsync(0);
    show("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(1);
    rerender({ firstReadsIn: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("still asks at once when what was kept is dropped before the first reads are in", async () => {
    const ask = vi.fn(async () => "same");
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask, false));
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).not.toHaveBeenCalled();
    // A save here drops what the canvas kept: it reads again now, so the mark
    // is taken now too.
    act(() => canvasSourcesChanged());
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("takes its first mark on opening in a hidden tab, then asks nothing until the tab is back", async () => {
    visibility = "hidden";
    let mark = "opened";
    const ask = vi.fn(async () => mark);
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask));
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(1);
    mark = "saved elsewhere";
    await vi.advanceTimersByTimeAsync(5 * SOURCE_CHECK_EVERY_MS);
    expect(ask).toHaveBeenCalledTimes(1);
    show("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(2);
    // Compared with the mark taken when the canvas read: the change shows.
    expect(dropped).toBe(1);
  });

  it("counts the minute from the check on coming back, not from the one before", async () => {
    const ask = vi.fn(async () => "same");
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask));
    await vi.advanceTimersByTimeAsync(0);
    show("hidden");
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS / 2);
    show("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(2);
    // Half a minute on, the minute the opening check started has passed,
    // and nothing is asked: the next ask is a minute after the return.
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS / 2 + 1);
    expect(ask).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS / 2);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("drops what the canvas kept once the mark changes, and only then", async () => {
    let mark = "before";
    const ask = vi.fn(async () => mark);
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask));
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(0);
    mark = "after";
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(1);
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(1);
  });

  it("takes the mark again at once when what was kept is dropped, so a save elsewhere just after is seen", async () => {
    let mark = "opened";
    const ask = vi.fn(async () => mark);
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask));
    await vi.advanceTimersByTimeAsync(0);
    // A save in this editor: the canvas reads again, and so does the check.
    mark = "saved here";
    act(() => canvasSourcesChanged());
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(dropped).toBe(1);
    // A colleague saves ten seconds later: the next check sees it.
    await vi.advanceTimersByTimeAsync(10_000);
    mark = "saved elsewhere";
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(2);
  });

  it("goes on checking after a check slower than a minute", async () => {
    let answer: (mark: string) => void = () => undefined;
    const ask = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("opened")
      .mockImplementationOnce(
        () =>
          new Promise<string>(resolve => {
            answer = resolve;
          })
      )
      .mockResolvedValue("opened");
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask));
    await vi.advanceTimersByTimeAsync(0);
    // The minute's check is asked, and takes a minute and a half.
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(ask).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS * 1.5);
    expect(ask).toHaveBeenCalledTimes(2);
    answer("opened");
    // A minute after it settled, the next is asked.
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("drops what was kept when the check that was to take the first mark failed", async () => {
    const ask = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("saved elsewhere meanwhile");
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask));
    await vi.advanceTimersByTimeAsync(0);
    expect(dropped).toBe(0);
    // The next check's mark cannot be compared with what was kept: it drops.
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(1);
    // Then it compares as usual.
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(1);
  });

  it("changes nothing when a check fails, and compares the next with the last mark it read", async () => {
    let answer: () => Promise<string> = async () => "before";
    const ask = vi.fn(() => answer());
    renderHook(() => useCanvasSourceCheck(ASKED, "u1", ask));
    await vi.advanceTimersByTimeAsync(0);
    answer = async () => {
      throw new Error("offline");
    };
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(0);
    answer = async () => "before";
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(0);
  });

  it("drops what was kept whenever the sources the canvas reads change, and not when they stay the same", async () => {
    const ask = vi.fn(async () => "same");
    const { rerender } = renderHook(
      ({ asked }: { asked: typeof ASKED }) =>
        useCanvasSourceCheck(asked, "u1", ask),
      { initialProps: { asked: ASKED } }
    );
    await vi.advanceTimersByTimeAsync(0);
    // The same sources, asked as a new object: nothing is dropped.
    rerender({ asked: { ...ASKED } });
    await vi.advanceTimersByTimeAsync(0);
    expect(dropped).toBe(0);
    // A source goes: the mark of the rest cannot be compared with the last,
    // so what was kept is dropped and read again with the new first mark.
    rerender({ asked: { ...ASKED, lists: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(dropped).toBe(1);
    // It comes back: what was kept for it predates every mark since.
    rerender({ asked: ASKED });
    await vi.advanceTimersByTimeAsync(0);
    expect(dropped).toBe(2);
  });

  it("drops what was kept on signing out and on closing the editor", async () => {
    const ask = vi.fn(async () => "same");
    const { rerender, unmount } = renderHook(
      ({ userId }: { userId: string | null }) =>
        useCanvasSourceCheck(ASKED, userId, ask),
      { initialProps: { userId: "u1" as string | null } }
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(dropped).toBe(0);
    rerender({ userId: null });
    expect(dropped).toBe(1);
    unmount();
    expect(dropped).toBe(2);
  });

  it("asks nothing for a page that reads no source, or for a person not yet known", async () => {
    const ask = vi.fn(async () => "same");
    renderHook(() => useCanvasSourceCheck(undefined, "u1", ask));
    renderHook(() => useCanvasSourceCheck(ASKED, null, ask));
    await vi.advanceTimersByTimeAsync(2 * SOURCE_CHECK_EVERY_MS);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("a store made in this editor", () => {
  it("drops what the canvas kept at once, each time it stores, and nothing before the first", () => {
    stored.at = null;
    const { rerender } = renderHook(() => useDropKeptReadsOnSave());
    expect(dropped).toBe(0);
    stored.at = new Date(1_000);
    rerender();
    expect(dropped).toBe(1);
    // The same store, drawn again: nothing more.
    stored.at = new Date(1_000);
    rerender();
    expect(dropped).toBe(1);
    // Stored again, whatever changed or did not: dropped again.
    stored.at = new Date(2_000);
    rerender();
    expect(dropped).toBe(2);
  });
});

describe("whether the canvas's first reads are in", () => {
  it("is so once the bindings are answered, or at once for a page that reads none", () => {
    expect(firstReadsInOf(undefined, undefined)).toBe(true);
    expect(firstReadsInOf({ asked: true }, undefined)).toBe(false);
    expect(firstReadsInOf({ asked: true }, { answered: true })).toBe(true);
  });
});
