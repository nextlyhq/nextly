// @vitest-environment jsdom

/**
 * Typing a block's text from the keyboard, on a canvas in a frame.
 *
 * Enter on a selected block names a node and no element, so the hook finds the
 * element itself — in the document the canvas is drawn in. On a canvas in a
 * frame that is the FRAME's document: the editor's own holds no block, and a
 * search there opens nothing and drops the edit.
 *
 * The page here is painted straight into a real iframe's document, which
 * jsdom gives a window of its own, and the provider names that frame.
 *
 * @module use-inline-frame.test
 */
import {
  clearBlocks,
  registerBlocks,
  RICH_TEXT_PROP_TYPE,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasFrameProvider } from "./canvas-frame-context";
import type { EditorState } from "./editor-state";
import { useInlineRichText } from "./use-inline-rich-text";
import { useInlineText } from "./use-inline-text";

afterEach(() => {
  clearBlocks();
  document.body.innerHTML = "";
});

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
    { source: "use-inline-frame-test" }
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

/** A frame holding the page, marked the way the renderer marks it. */
function framedPage(): { frame: HTMLIFrameElement; inside: Document } {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const inside = frame.contentDocument;
  if (inside === null) throw new Error("no frame document");
  inside.body.innerHTML = `
    <div class="nx-canvas">
      <div data-nx-node="a">
        <div data-nx-prop="content"><p>A passage</p></div>
        <span data-nx-prop="caption">A caption</span>
      </div>
    </div>`;
  // The control: nothing in the editor's own document carries the block.
  expect(document.querySelector('[data-nx-node="a"]')).toBeNull();
  return { frame, inside };
}

function inFrame(frame: HTMLIFrameElement) {
  return function Wrapper({ children }: { children?: React.ReactNode }) {
    return <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>;
  };
}

describe("Enter on a selected block, on a canvas in a frame", () => {
  it("opens the caret in a plain value, in the frame's document", () => {
    registerArticle();
    const { frame, inside } = framedPage();
    const { result } = renderHook(() => useInlineText(editorState()), {
      wrapper: inFrame(frame),
    });

    // The keyboard route: a node and a value, no element.
    act(() => {
      result.current.begin("a", "caption");
    });

    expect(result.current.editing).toEqual({ nodeId: "a", prop: "caption" });
    const caption = inside.querySelector('[data-nx-prop="caption"]');
    expect(caption?.getAttribute("contenteditable")).toBe("plaintext-only");
  });

  it("hands a passage's element to the rich editor, in the frame's document", async () => {
    registerArticle();
    const { frame, inside } = framedPage();
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => null,
        detach: () => {},
        hold: () => {},
      },
    }));
    const load = vi.fn(async () => ({ attach }));
    const { result } = renderHook(
      () => useInlineRichText(editorState(), load as never),
      { wrapper: inFrame(frame) }
    );

    await act(async () => {
      result.current.begin("a", "content");
    });

    expect(result.current.editing).toEqual({ nodeId: "a", prop: "content" });
    const passage = inside.querySelector('[data-nx-prop="content"]');
    expect(load).toHaveBeenCalled();
    expect(passage).not.toBeNull();
    expect(attach.mock.calls[0]?.[0]).toBe(passage);
  });

  it("carries a passage's typing into the frame's new page, unwritten, when the frame replaces its document", async () => {
    // A frame reload replaces the page under an open passage. Committing on
    // the way out would write an edit the author has not finished, and lose
    // it outright when the write is refused; the passage goes on in the new
    // page's element with the same words instead.
    registerArticle();
    const first = framedPage();
    let frame = first.frame;
    function Wrapper({ children }: { children?: React.ReactNode }) {
      return (
        <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>
      );
    }
    const stored = { root: { type: "root", children: [] } };
    const typed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Typed" }] },
        ],
      },
    };
    let reads = 0;
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => (reads++ === 0 ? stored : typed),
        detach: () => {},
        hold: () => {},
      },
    }));
    const load = vi.fn(async () => ({ attach }));
    const editor = editorState();
    const { result, rerender } = renderHook(
      () => useInlineRichText(editor, load as never),
      { wrapper: Wrapper }
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    expect(attach).toHaveBeenCalledTimes(1);

    const second = framedPage();
    frame = second.frame;
    await act(async () => {
      rerender();
    });

    expect(editor.apply).not.toHaveBeenCalled();
    expect(result.current.editing).toEqual({ nodeId: "a", prop: "content" });
    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach.mock.calls[1]?.[0]).toBe(
      second.inside.querySelector('[data-nx-prop="content"]')
    );
    expect(attach.mock.calls[1]?.[1]).toEqual(typed);
  });

  it("keeps carried typing through a second page replacement before the editor loads again", async () => {
    // Two reloads in quick succession: the second arrives while the editor
    // for the first is still loading. The words must reach the third page.
    registerArticle();
    const first = framedPage();
    let frame = first.frame;
    function Wrapper({ children }: { children?: React.ReactNode }) {
      return (
        <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>
      );
    }
    const stored = { root: { type: "root", children: [] } };
    const typed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Typed" }] },
        ],
      },
    };
    let reads = 0;
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => (reads++ === 0 ? stored : typed),
        detach: () => {},
        hold: () => {},
      },
    }));
    let arrive: (() => void) | undefined;
    const load = vi
      .fn()
      .mockImplementationOnce(async () => ({ attach }))
      .mockImplementation(
        () =>
          new Promise(resolve => {
            arrive = () => resolve({ attach });
          })
      );
    const editor = editorState();
    const { result, rerender } = renderHook(
      () => useInlineRichText(editor, load as never),
      { wrapper: Wrapper }
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    // The first reload, and the second before the editor has loaded for it.
    frame = framedPage().frame;
    await act(async () => {
      rerender();
    });
    const third = framedPage();
    frame = third.frame;
    await act(async () => {
      rerender();
    });
    await act(async () => {
      arrive?.();
    });

    expect(editor.apply).not.toHaveBeenCalled();
    const last = attach.mock.calls.at(-1);
    expect(last?.[0]).toBe(
      third.inside.querySelector('[data-nx-prop="content"]')
    );
    expect(last?.[1]).toEqual(typed);
  });

  it("writes carried typing when the new page no longer draws the passage", async () => {
    // Nowhere to carry the words: they are written, as finishing the edit
    // would write them, rather than lost with the old page.
    registerArticle();
    const first = framedPage();
    let frame = first.frame;
    function Wrapper({ children }: { children?: React.ReactNode }) {
      return (
        <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>
      );
    }
    const stored = { root: { type: "root", children: [] } };
    const typed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Typed" }] },
        ],
      },
    };
    let reads = 0;
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => (reads++ === 0 ? stored : typed),
        detach: () => {},
        hold: () => {},
      },
    }));
    const load = vi.fn(async () => ({ attach }));
    const editor = editorState();
    editor.apply = vi.fn(() => editor.document);
    const finished = vi.fn();
    const { result, rerender } = renderHook(
      () => useInlineRichText(editor, load as never, finished),
      { wrapper: Wrapper }
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    const second = framedPage();
    second.inside.querySelector('[data-nx-prop="content"]')?.remove();
    frame = second.frame;
    await act(async () => {
      rerender();
    });

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(vi.mocked(editor.apply).mock.calls[0]?.[0])
    ).toContain("Typed");
    expect(finished).toHaveBeenCalledWith(
      expect.objectContaining({ status: "written" })
    );
    expect(result.current.editing).toBeNull();
  });

  it("resumes a carried passage where the caret was", async () => {
    // The author was typing mid-passage when the page was replaced; the
    // caret goes back to that place, not to the end of the passage.
    registerArticle();
    const first = framedPage();
    let frame = first.frame;
    function Wrapper({ children }: { children?: React.ReactNode }) {
      return (
        <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>
      );
    }
    const focus = vi.fn();
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      status: "attached",
      session: { focus, read: () => null, detach: () => {}, hold: () => {} },
    }));
    const load = vi.fn(async () => ({ attach }));
    const { result, rerender } = renderHook(
      () => useInlineRichText(editorState(), load as never),
      { wrapper: Wrapper }
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    // The caret after "A pa", as typing leaves it.
    const text = first.inside.querySelector(
      '[data-nx-prop="content"] p'
    )?.firstChild;
    if (text === null || text === undefined) throw new Error("no text");
    const selection = first.inside.getSelection();
    const range = first.inside.createRange();
    range.setStart(text, 4);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    first.inside.dispatchEvent(new Event("selectionchange"));

    frame = framedPage().frame;
    await act(async () => {
      rerender();
    });
    expect(attach).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenLastCalledWith(4);
  });

  it("finishes a carried passage when the editor can no longer be loaded", async () => {
    // The host stops supplying the editor in the same render that replaces
    // the page: the carried words are written, not stranded.
    registerArticle();
    const first = framedPage();
    let frame = first.frame;
    function Wrapper({ children }: { children?: React.ReactNode }) {
      return (
        <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>
      );
    }
    const stored = { root: { type: "root", children: [] } };
    const typed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Typed" }] },
        ],
      },
    };
    let reads = 0;
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => (reads++ === 0 ? stored : typed),
        detach: () => {},
        hold: () => {},
      },
    }));
    let load: (() => Promise<unknown>) | undefined = vi.fn(async () => ({
      attach,
    }));
    const editor = editorState();
    editor.apply = vi.fn(() => editor.document);
    const { result, rerender } = renderHook(
      () => useInlineRichText(editor, load as never),
      { wrapper: Wrapper }
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    load = undefined;
    frame = framedPage().frame;
    await act(async () => {
      rerender();
    });
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(result.current.editing).toBeNull();
  });

  /** A passage edit whose page is replaced while the next editor is loading. */
  async function carriedWhileLoading(): Promise<{
    result: { current: ReturnType<typeof useInlineRichText> };
    editor: EditorState;
  }> {
    registerArticle();
    const first = framedPage();
    let frame = first.frame;
    function Wrapper({ children }: { children?: React.ReactNode }) {
      return (
        <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>
      );
    }
    const stored = { root: { type: "root", children: [] } };
    const typed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Typed" }] },
        ],
      },
    };
    let reads = 0;
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => (reads++ === 0 ? stored : typed),
        detach: () => {},
        hold: () => {},
      },
    }));
    const load = vi
      .fn()
      .mockImplementationOnce(async () => ({ attach }))
      .mockImplementation(() => new Promise(() => {}));
    const editor = editorState();
    editor.apply = vi.fn(() => editor.document);
    const { result, rerender } = renderHook(
      () => useInlineRichText(editor, load as never),
      { wrapper: Wrapper }
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    frame = framedPage().frame;
    await act(async () => {
      rerender();
    });
    return { result, editor };
  }

  it("writes carried typing when the host finishes the edit while the editor loads", async () => {
    // A save or a navigation asks for the edit's outcome before closing; the
    // carried words are that outcome, written now, not after it closed.
    const { result, editor } = await carriedWhileLoading();
    let outcome: unknown;
    act(() => {
      outcome = result.current.commit();
    });
    expect(outcome).toEqual(expect.objectContaining({ status: "written" }));
    expect(editor.apply).toHaveBeenCalledTimes(1);
  });

  it("drops carried typing when the edit is cancelled while the editor loads", async () => {
    // Cancel means the words go, as it does for an open passage.
    const { result, editor } = await carriedWhileLoading();
    await act(async () => {
      result.current.cancel();
    });
    expect(editor.apply).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
  });

  it("takes the caret into the frame's new page when the frame replaces its document mid-edit", () => {
    registerArticle();
    const first = framedPage();
    let frame = first.frame;
    function Wrapper({ children }: { children?: React.ReactNode }) {
      return (
        <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>
      );
    }
    const { result, rerender } = renderHook(
      () => useInlineText(editorState()),
      {
        wrapper: Wrapper,
      }
    );
    // The pointer route: the element pressed, in the first page.
    const pressed = first.inside.querySelector('[data-nx-prop="caption"]');
    act(() => {
      result.current.onDoubleClick({ target: pressed });
    });
    expect(pressed?.getAttribute("contenteditable")).toBe("plaintext-only");
    // Typing the edit has not committed yet.
    if (pressed !== null && pressed !== undefined) {
      pressed.textContent = "Typed, not yet saved";
    }

    // The frame's page is replaced, as a reload does: the same block, drawn
    // again in a new document.
    const second = framedPage();
    frame = second.frame;
    rerender();

    const redrawn = second.inside.querySelector('[data-nx-prop="caption"]');
    expect(redrawn?.getAttribute("contenteditable")).toBe("plaintext-only");
    // The typing goes with the edit rather than being lost with the old page.
    expect(redrawn?.textContent).toBe("Typed, not yet saved");
  });
});
