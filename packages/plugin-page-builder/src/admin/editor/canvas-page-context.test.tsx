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
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const readMedia = vi.fn<(id: string) => Promise<unknown>>();
const identity = vi.fn<() => unknown>(() => null);

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useMediaResolver: () => readMedia,
  useDocumentIdentity: () => identity(),
}));

const { useCanvasPageContext } = await import("./canvas-page-context");

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
});
