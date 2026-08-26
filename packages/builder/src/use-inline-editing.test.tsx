// @vitest-environment jsdom
/**
 * One gesture reaching the right editor.
 *
 * The routing is the only thing this module decides, and it is the thing a
 * hook's own state cannot show: sending a passage to the plain surface reads
 * back an empty string and commits it over the author's work, and sending a
 * line of text to the rich one stores a tree where every reader expects a
 * string. Both failures are silent, and both look like "the edit opened".
 *
 * So each case asserts WHICH surface opened, never merely that one did.
 *
 * @module use-inline-editing.test
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  RICH_TEXT_PROP_TYPE,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { useInlineEditing } from "./use-inline-editing";

afterEach(() => {
  clearBlocks();
  document.body.innerHTML = "";
});

/** A block with a passage and a line of text, both editable on the canvas. */
function registerArticle(): void {
  registerBlocks(
    [
      {
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
        name: "acme/article",
        props: {
          content: { type: RICH_TEXT_PROP_TYPE, inline: true },
          caption: { type: "text", inline: true },
        },
      },
    ] as never,
    { source: "use-inline-editing-test" }
  );
}

function editorState(): EditorState {
  const nodes = [
    {
      id: "a",
      type: "acme/article",
      version: 1,
      props: { caption: "A caption" },
    } as BlockNode,
  ];
  return {
    document: { formatVersion: 1, kind: "page", nodes } as BlockDocument,
    selectedId: "a",
    apply: vi.fn(() => null),
  } as unknown as EditorState;
}

/** The rendered canvas, marked the way the renderer marks it. */
function paint(): void {
  document.body.innerHTML = `
    <div data-nx-node="a">
      <div data-nx-prop="content"><p>A passage</p></div>
      <span data-nx-prop="caption">A caption</span>
    </div>`;
}

/** A loader that never resolves, so a test observes the ROUTING alone. */
function pendingLoader() {
  return vi.fn(() => new Promise<never>(() => {}));
}

function mount(load = pendingLoader()) {
  registerArticle();
  paint();
  const result = renderHook(() => useInlineEditing(editorState(), load));
  return { ...result, load };
}

/** Double-click whatever carries this prop. */
function doubleClickOn(prop: string): { target: EventTarget | null } {
  const element = document.querySelector(`[data-nx-prop="${prop}"]`);
  return { target: element };
}

describe("which editor a double-click reaches", () => {
  it("opens the RICH editor on a passage", () => {
    const { result, load } = mount();

    act(() => result.current.onDoubleClick(doubleClickOn("content")));

    expect(result.current.editingRich).toEqual({
      nodeId: "a",
      prop: "content",
    });
    // The plain surface must be untouched, not merely "also open".
    expect(result.current.editing).toBeNull();
    expect(load).toHaveBeenCalled();
  });

  it("opens the PLAIN editor on a line of text", () => {
    const { result, load } = mount();

    act(() => result.current.onDoubleClick(doubleClickOn("caption")));

    expect(result.current.editing).toEqual({ nodeId: "a", prop: "caption" });
    expect(result.current.editingRich).toBeNull();
    // The 630KB chunk is not fetched for a value that does not need it.
    expect(load).not.toHaveBeenCalled();
  });

  it("opens nothing when the gesture missed every value", () => {
    const { result } = mount();
    const outside = document.querySelector("[data-nx-node]");

    act(() => result.current.onDoubleClick({ target: outside }));

    expect(result.current.editing).toBeNull();
    expect(result.current.editingRich).toBeNull();
  });
});

describe("a keyboard caller, which has a block and no element", () => {
  it("reaches the passage when the block has one", () => {
    const { result } = mount();

    act(() => {
      result.current.begin("a");
    });

    expect(result.current.editingRich?.prop).toBe("content");
    expect(result.current.editing).toBeNull();
  });

  it("routes a NAMED value by what the block declared it to be", () => {
    const { result } = mount();

    act(() => {
      result.current.begin("a", "caption");
    });

    expect(result.current.editing?.prop).toBe("caption");
    expect(result.current.editingRich).toBeNull();
  });
});

describe("a host that supplies no rich-text editor", () => {
  it("still edits plain text, and simply does not open passages", () => {
    // A builder embedded somewhere without the admin bundle. The alternative is
    // an author double-clicking a passage and getting a caret backed by
    // nothing, which is worse than the gesture doing nothing at all.
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineEditing(editorState(), undefined)
    );

    act(() => result.current.onDoubleClick(doubleClickOn("content")));
    expect(result.current.editingRich).toBeNull();

    act(() => result.current.onDoubleClick(doubleClickOn("caption")));
    expect(result.current.editing?.prop).toBe("caption");
  });
});
