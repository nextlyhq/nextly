// @vitest-environment jsdom

/**
 * Escape while typing on the canvas keeps what was typed, as the editor's
 * design asks: it ends the edit, and the next Escape selects the block's
 * parent. It used to throw the typing away, which an author pressing Escape to
 * get out of the text met as lost work.
 *
 * @module use-inline-escape.test
 */
import {
  hasBlock,
  RICH_TEXT_PROP_TYPE,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { useInlineRichText } from "./use-inline-rich-text";
import { useInlineText } from "./use-inline-text";

afterEach(() => {
  document.body.innerHTML = "";
});

function registerArticle(): void {
  if (hasBlock("acme/escape-article")) return;
  registerBlocks(
    [
      {
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
        name: "acme/escape-article",
        props: {
          content: { type: RICH_TEXT_PROP_TYPE, inline: true },
          caption: { type: "text", inline: true },
        },
      },
    ] as never,
    { source: "use-inline-escape-test" }
  );
}

function editorState(): EditorState & { apply: ReturnType<typeof vi.fn> } {
  const nodes = [
    {
      id: "a",
      type: "acme/escape-article",
      version: 1,
      props: { caption: "A caption" },
    } as BlockNode,
  ];
  const document = { formatVersion: 1, kind: "page", nodes } as BlockDocument;
  return {
    document,
    selectedId: "a",
    apply: vi.fn(() => document),
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

/** The page, marked the way the renderer marks it. */
function page(): void {
  document.body.innerHTML = `
    <div class="nx-canvas">
      <div data-nx-node="a">
        <div data-nx-prop="content"><p>A passage</p></div>
        <span data-nx-prop="caption">A caption</span>
      </div>
    </div>`;
}

function escape(element: Element): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
  );
}

describe("Escape while typing", () => {
  it("keeps the typing in a line of text, and ends the edit", () => {
    registerArticle();
    page();
    const editor = editorState();
    const { result } = renderHook(() => useInlineText(editor));
    act(() => {
      result.current.begin("a", "caption");
    });
    const caption = document.querySelector('[data-nx-prop="caption"]');
    if (caption === null) throw new Error("no caption");
    caption.textContent = "A better caption";

    act(() => escape(caption));

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(editor.apply.mock.calls[0]?.[0])).toContain(
      "A better caption"
    );
    expect(result.current.editing).toBeNull();
    expect(caption.textContent).toBe("A better caption");
  });

  it("keeps the typing in a passage, and ends the edit", async () => {
    registerArticle();
    page();
    const editor = editorState();
    // What the passage held when it opened, then what the author typed: the
    // editor reads the first as its baseline and the second when it writes.
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
    const attach = vi.fn(() => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => (reads++ === 0 ? stored : typed),
        detach: () => {},
        hold: () => {},
      },
    }));
    const load = vi.fn(async () => ({ attach }));
    const { result } = renderHook(() =>
      useInlineRichText(editor, load as never)
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    const passage = document.querySelector('[data-nx-prop="content"]');
    if (passage === null) throw new Error("no passage");

    await act(async () => escape(passage));

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(result.current.editing).toBeNull();
  });

  it("leaves a passage open when the write is refused, and lets it go on a second Escape", async () => {
    // The words are the author's only copy: a refused write keeps them on
    // screen, and the second Escape is the deliberate way out.
    registerArticle();
    page();
    const editor = editorState();
    editor.apply.mockImplementation(() => null);
    let reads = 0;
    const stored = { root: { type: "root", children: [] } };
    const typed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Typed" }] },
        ],
      },
    };
    const attach = vi.fn(() => ({
      status: "attached",
      session: {
        focus: () => {},
        read: () => (reads++ === 0 ? stored : typed),
        detach: () => {},
        hold: () => {},
      },
    }));
    const load = vi.fn(async () => ({ attach }));
    const { result } = renderHook(() =>
      useInlineRichText(editor, load as never)
    );
    await act(async () => {
      result.current.begin("a", "content");
    });
    const passage = document.querySelector('[data-nx-prop="content"]');
    if (passage === null) throw new Error("no passage");

    await act(async () => escape(passage));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(result.current.editing).not.toBeNull();

    await act(async () => escape(passage));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(result.current.editing).toBeNull();
  });
});
