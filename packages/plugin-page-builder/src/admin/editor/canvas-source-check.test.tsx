// @vitest-environment jsdom
/**
 * The editor's change check: one ask on opening, then at most once a minute
 * while the builder's tab is visible, none while it is hidden and one on
 * coming back to it; a different mark drops what the canvas kept, the same
 * mark nothing; and a save in this editor drops it at once.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ writePluginRoute: vi.fn() }));

const { onCanvasSourcesChanged } = await import("../canvas-sources");
const { SOURCE_CHECK_EVERY_MS, useCanvasSourceCheck, useDropKeptReadsOnSave } =
  await import("./canvas-source-check");

const REQUEST = {
  source: { kind: "collection" as const, slug: "pages", id: "p1" },
  demand: {
    singles: { home: { fields: [], follows: {} } },
    site: false,
    formatsDates: false,
  },
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
  stopHearing();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the canvas's change check", () => {
  it("asks once on opening, then at most once a minute while the tab is visible", async () => {
    const ask = vi.fn(async () => "same");
    renderHook(() => useCanvasSourceCheck(REQUEST, "u1", ask));
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith({
      source: REQUEST.source,
      singles: ["home"],
      lists: ["posts"],
    });
    await vi.advanceTimersByTimeAsync(5 * SOURCE_CHECK_EVERY_MS);
    expect(ask).toHaveBeenCalledTimes(6);
    // The same mark each time: nothing the canvas kept is dropped.
    expect(dropped).toBe(0);
  });

  it("asks nothing while the tab is hidden, and once on coming back to it", async () => {
    const ask = vi.fn(async () => "same");
    renderHook(() => useCanvasSourceCheck(REQUEST, "u1", ask));
    await vi.advanceTimersByTimeAsync(0);
    show("hidden");
    await vi.advanceTimersByTimeAsync(5 * SOURCE_CHECK_EVERY_MS);
    expect(ask).toHaveBeenCalledTimes(1);
    show("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("drops what the canvas kept once the mark changes, and only then", async () => {
    let mark = "before";
    const ask = vi.fn(async () => mark);
    renderHook(() => useCanvasSourceCheck(REQUEST, "u1", ask));
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(0);
    mark = "after";
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(1);
    await vi.advanceTimersByTimeAsync(SOURCE_CHECK_EVERY_MS);
    expect(dropped).toBe(1);
  });

  it("asks nothing for a page that reads no source, or for a person not yet known", async () => {
    const ask = vi.fn(async () => "same");
    renderHook(() => useCanvasSourceCheck(undefined, "u1", ask));
    renderHook(() => useCanvasSourceCheck(REQUEST, null, ask));
    await vi.advanceTimersByTimeAsync(2 * SOURCE_CHECK_EVERY_MS);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("a save in this editor", () => {
  it("drops what the canvas kept at once, and the document as opened drops nothing", () => {
    const { rerender } = renderHook(
      ({ savedAt }: { savedAt: number }) => useDropKeptReadsOnSave(savedAt),
      { initialProps: { savedAt: 1 } }
    );
    expect(dropped).toBe(0);
    rerender({ savedAt: 2 });
    expect(dropped).toBe(1);
    rerender({ savedAt: 2 });
    expect(dropped).toBe(1);
  });
});
