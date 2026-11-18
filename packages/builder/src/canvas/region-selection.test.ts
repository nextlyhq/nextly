// @vitest-environment jsdom

/**
 * The canvas's second kind of selection: a region drawn from another
 * document, held beside the page's block selection and never with it.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useRegionSelection,
  type RegionSelectionEditor,
} from "./region-selection";

/** An editor whose block selection the test sets, recording each select. */
function editorWith(selectedId: string | null): RegionSelectionEditor & {
  select: ReturnType<typeof vi.fn<(id: null) => void>>;
} {
  return { selectedId, select: vi.fn<(id: null) => void>() };
}

describe("selecting a header or footer on the canvas", () => {
  it("selects the region and clears the block selection", () => {
    const editor = editorWith("heading");
    const { result, rerender } = renderHook(
      ({ editor: now }) => useRegionSelection(now, ["header", "footer"]),
      { initialProps: { editor } }
    );
    expect(result.current.area).toBeNull();
    act(() => result.current.select("header"));
    expect(editor.select).toHaveBeenCalledWith(null);
    // The editor's selection is cleared by that call.
    rerender({ editor: editorWith(null) });
    expect(result.current.area).toBe("header");
  });

  it("is never held beside a selected block: selecting one clears it for good", () => {
    const { result, rerender } = renderHook(
      ({ editor }) => useRegionSelection(editor, ["header", "footer"]),
      { initialProps: { editor: editorWith(null) } }
    );
    act(() => result.current.select("footer"));
    expect(result.current.area).toBe("footer");
    // A block is selected: the region is not, on this very render.
    rerender({ editor: editorWith("heading") });
    expect(result.current.area).toBeNull();
    // Clearing the block later brings nothing back.
    rerender({ editor: editorWith(null) });
    expect(result.current.area).toBeNull();
  });

  it("clears on request, and when the region is no longer drawn", () => {
    const editor = editorWith(null);
    const { result, rerender } = renderHook(
      ({ areas }) => useRegionSelection(editor, areas),
      {
        initialProps: {
          areas: ["header", "footer"] as readonly ("header" | "footer")[],
        },
      }
    );
    act(() => result.current.select("header"));
    act(() => result.current.clear());
    expect(result.current.area).toBeNull();
    act(() => result.current.select("header"));
    // The page's choice drops the header: nothing drawn, nothing selected.
    rerender({ areas: ["footer"] });
    expect(result.current.area).toBeNull();
    // Drawn again, it is not selected again on its own.
    rerender({ areas: ["header", "footer"] });
    expect(result.current.area).toBeNull();
  });

  it("keeps its verbs' identities across renders", () => {
    const { result, rerender } = renderHook(
      ({ editor }) => useRegionSelection(editor, ["header"]),
      { initialProps: { editor: editorWith(null) } }
    );
    const { select, clear } = result.current;
    rerender({ editor: editorWith(null) });
    expect(result.current.select).toBe(select);
    expect(result.current.clear).toBe(clear);
  });
});
