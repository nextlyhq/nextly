/**
 * The document panel steps aside while history is open, and the author's own
 * choice comes back once it closes. It shares the right side with the preview
 * pane: the preview folds it, and showing it closes the preview. Below the
 * docking width it opens over the fields only when asked for.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentPanel } from "../useDocumentPanel";

const at = (address: string) => window.history.replaceState(null, "", address);

beforeEach(() => window.localStorage.clear());
afterEach(() => at("/"));

describe("useDocumentPanel", () => {
  it("shows the panel while history is closed and the author has not collapsed it", () => {
    at("/admin/collections/posts/e1");
    const { result } = renderHook(() => useDocumentPanel());
    expect(result.current.collapsed).toBe(false);
  });

  it("puts the panel out of the way while history is open", () => {
    at("/admin/collections/posts/e1?history=1");
    const { result } = renderHook(() => useDocumentPanel());
    expect(result.current.collapsed).toBe(true);
  });

  it("keeps the author's choice to collapse it, history open or not", () => {
    at("/admin/collections/posts/e1");
    const { result } = renderHook(() => useDocumentPanel());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
  });

  it.each([
    ["shown", false],
    ["collapsed", true],
  ])(
    "gives back the panel %s, as the author left it, once history closes",
    (_label, collapsedByAuthor) => {
      at("/admin/collections/posts/e1");
      const { result } = renderHook(() => useDocumentPanel());
      if (collapsedByAuthor) act(() => result.current.toggle());
      // The address moves as back and forward move it.
      const moveTo = (address: string) =>
        act(() => {
          at(address);
          window.dispatchEvent(new PopStateEvent("popstate"));
        });

      moveTo("/admin/collections/posts/e1?history=1");
      expect(result.current.collapsed).toBe(true);
      moveTo("/admin/collections/posts/e1");

      expect(result.current.collapsed).toBe(collapsedByAuthor);
    }
  );
});

/** An editor frame this wide, as the browser would lay it out. */
function frameOf(width: number): HTMLElement {
  const frame = document.createElement("div");
  frame.getBoundingClientRect = () => ({ width }) as DOMRect;
  return frame;
}

describe("useDocumentPanel and the preview pane", () => {
  it("folds the docked panel while the preview is open, and gives it back once it closes", () => {
    at("/admin/collections/posts/e1");
    const { result, rerender } = renderHook(
      ({ previewOpen }) => useDocumentPanel({ previewOpen }),
      { initialProps: { previewOpen: false } }
    );
    expect(result.current.shown).toBe(true);
    rerender({ previewOpen: true });
    expect(result.current.shown).toBe(false);
    rerender({ previewOpen: false });
    expect(result.current.shown).toBe(true);
  });

  it("closes the preview when the panel is shown, and keeps it shown once the preview has gone", () => {
    at("/admin/collections/posts/e1");
    const closePreview = vi.fn();
    const { result, rerender } = renderHook(
      ({ previewOpen }) => useDocumentPanel({ previewOpen, closePreview }),
      { initialProps: { previewOpen: true } }
    );
    expect(result.current.shown).toBe(false);
    act(() => result.current.toggle());
    expect(closePreview).toHaveBeenCalledTimes(1);
    rerender({ previewOpen: false });
    expect(result.current.shown).toBe(true);
  });

  it("brings back a panel the author had folded once they ask for it over the preview", () => {
    at("/admin/collections/posts/e1");
    window.localStorage.setItem("nextly:admin:entry-rail-collapsed", "1");
    const { result, rerender } = renderHook(
      ({ previewOpen }) =>
        useDocumentPanel({ previewOpen, closePreview: vi.fn() }),
      { initialProps: { previewOpen: true } }
    );
    act(() => result.current.toggle());
    rerender({ previewOpen: false });
    expect(result.current.shown).toBe(true);
    expect(
      window.localStorage.getItem("nextly:admin:entry-rail-collapsed")
    ).toBe("0");
  });
});

describe("useDocumentPanel by the editor's width", () => {
  it.each([
    [1440, "docked"],
    [1000, "docked"],
    [999, "floating"],
    [860, "floating"],
    [600, "floating"],
    [599, "sheet"],
    [390, "sheet"],
  ] as const)("is %ipx wide: %s", (width, mode) => {
    at("/admin/collections/posts/e1");
    const { result } = renderHook(() => useDocumentPanel());
    act(() => result.current.measure(frameOf(width)));
    expect(result.current.mode).toBe(mode);
  });

  it.each([860, 390])(
    "opens over the fields at %ipx only when asked for, and leaves the author's docked choice alone",
    width => {
      at("/admin/collections/posts/e1");
      const { result } = renderHook(() => useDocumentPanel());
      act(() => result.current.measure(frameOf(width)));
      // Closed on arrival, though the docked panel is shown by default.
      expect(result.current.shown).toBe(false);
      act(() => result.current.toggle());
      expect(result.current.shown).toBe(true);
      act(() => result.current.hide());
      expect(result.current.shown).toBe(false);
      // Closing the overlay is not folding the docked panel.
      expect(
        window.localStorage.getItem("nextly:admin:entry-rail-collapsed")
      ).toBeNull();
    }
  );

  it("folds an open floating panel for good when the preview opens", () => {
    at("/admin/collections/posts/e1");
    const { result, rerender } = renderHook(
      ({ previewOpen }) => useDocumentPanel({ previewOpen }),
      { initialProps: { previewOpen: false } }
    );
    act(() => result.current.measure(frameOf(860)));
    act(() => result.current.toggle());
    expect(result.current.shown).toBe(true);
    rerender({ previewOpen: true });
    expect(result.current.shown).toBe(false);
    // Not sprung back over the fields once the preview closes.
    rerender({ previewOpen: false });
    expect(result.current.shown).toBe(false);
  });
});
