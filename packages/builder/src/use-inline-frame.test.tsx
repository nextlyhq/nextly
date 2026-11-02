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
});
