// @vitest-environment jsdom

/**
 * Copy, Cut and Paste against the real editor state: one undo step each, the
 * locks Delete keeps, and the refusals a paste meets, with the clipboard's
 * text captured where a clipboard event would carry it.
 *
 * @module block-clipboard-verbs.test
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NestingSource,
} from "@nextlyhq/blocks-engine";
import { act, render, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FOREIGN_SITE_REFUSAL } from "./block-clipboard";
import {
  BlockClipboardEvents,
  blocksTakeClipboardEvent,
} from "./block-clipboard-events";
import {
  useBlockClipboardVerbs,
  type BlockClipboardVerbs,
  type ClipboardWrite,
} from "./block-clipboard-verbs";
import { useEditorState } from "./editor-state";
import { BUILDER_CHROME_CLASS } from "./shell-state";

const anyParent: NestingSource = { parentsOf: () => undefined };
const onlyInColumns: NestingSource = {
  parentsOf: type => (type === "core/column" ? ["core/columns"] : undefined),
};

function node(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {},
  children?: Record<string, BlockNode[]>
): BlockNode {
  return {
    id,
    type,
    version: 1,
    props: {},
    ...extra,
    ...(children === undefined ? {} : { slots: children }),
  };
}

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** The editor and its clipboard verbs, with what each verb said. */
function setUp(initialDocument: BlockDocument, nesting = anyParent) {
  const announce = vi.fn<(message: string) => void>();
  const notify = vi.fn<(message: string) => void>();
  const { result } = renderHook(() => {
    const editor = useEditorState({ initialDocument });
    const latest = React.useRef(editor);
    latest.current = editor;
    const verbs = useBlockClipboardVerbs({ latest, announce, notify, nesting });
    return { editor, verbs };
  });
  return { result, announce, notify };
}

/** A clipboard write that keeps the text, as a copy event's data would. */
function clipboard(): { write: (text: string) => boolean; text: () => string } {
  let held = "";
  return {
    write: text => {
      held = text;
      return true;
    },
    text: () => held,
  };
}

describe("copying and pasting blocks", () => {
  it("pastes a copy as one undo step, selected, with new ids", () => {
    const { result } = setUp(page(node("h", "core/heading")));
    const board = clipboard();
    act(() => result.current.editor.select("h"));
    act(() => {
      result.current.verbs.copy(board.write);
    });
    // Copying changes nothing on the page.
    expect(result.current.editor.undoDepth).toBe(0);

    act(() => {
      expect(result.current.verbs.pasteText(board.text())).toBe(true);
    });
    const nodes = result.current.editor.document.nodes;
    expect(nodes).toHaveLength(2);
    const copy = nodes[1];
    expect(copy?.id).not.toBe("h");
    expect(result.current.editor.selection.ids).toEqual([copy?.id]);
    expect(result.current.editor.undoDepth).toBe(1);

    act(() => {
      void result.current.editor.undo();
    });
    expect(result.current.editor.document.nodes).toHaveLength(1);
  });

  it("refuses blocks copied on another site, and changes nothing", () => {
    const { result, notify } = setUp(page(node("h", "core/heading")));
    const foreign = JSON.stringify({
      nextlyBlocks: 1,
      origin: "https://other.example",
      blocks: [node("x", "core/heading")],
    });
    act(() => {
      expect(result.current.verbs.pasteText(foreign)).toBe(true);
    });
    expect(notify).toHaveBeenCalledWith(FOREIGN_SITE_REFUSAL);
    expect(result.current.editor.document.nodes).toHaveLength(1);
  });

  it("refuses a paste the placement rule refuses, through the same checks, and changes nothing", () => {
    const { result, notify } = setUp(
      page(node("h", "core/heading")),
      onlyInColumns
    );
    const column = JSON.stringify({
      nextlyBlocks: 1,
      origin: globalThis.location.origin,
      blocks: [node("c", "core/column")],
    });
    act(() => {
      result.current.verbs.pasteText(column);
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/only works inside another one/)
    );
    expect(result.current.editor.document.nodes).toHaveLength(1);
    expect(result.current.editor.undoDepth).toBe(0);
  });

  it("leaves text that is not copied blocks to the page", () => {
    const { result, notify } = setUp(page(node("h", "core/heading")));
    let taken = true;
    act(() => {
      taken = result.current.verbs.pasteText("Plain words");
    });
    expect(taken).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("a paste with a list showing its empty message", () => {
  // The list's two regions, as the registry the editor reads declares them.
  beforeEach(() => {
    registerBlocks(
      [
        {
          name: "core/collection-loop",
          version: 1,
          description: "A list.",
          example: { props: {} },
          render: () => null,
          slots: { children: {}, empty: {} },
        },
      ] as never,
      { source: "test" }
    );
  });
  afterEach(() => clearBlocks());

  it("lands in the empty message the canvas shows", () => {
    const { result } = setUp(
      page(
        node(
          "list",
          "core/collection-loop",
          { props: { limit: 3, collection: "posts" } },
          { children: [node("entry-h", "core/heading")], empty: [] }
        )
      )
    );
    act(() => result.current.editor.showListEmpty?.("list", true));
    act(() => result.current.editor.select("list"));
    act(() => {
      result.current.verbs.pasteText(
        JSON.stringify({
          nextlyBlocks: 1,
          origin: globalThis.location.origin,
          blocks: [node("note", "core/heading")],
        })
      );
    });
    const list = result.current.editor.document.nodes[0];
    expect(list?.slots?.empty).toHaveLength(1);
    expect(list?.slots?.children).toHaveLength(1);
  });
});

describe("several blocks at once", () => {
  it("cuts and pastes a run of blocks as one undo step each", () => {
    const { result } = setUp(
      page(
        node("a", "core/heading"),
        node("b", "core/heading"),
        node("c", "core/heading")
      )
    );
    const board = clipboard();
    act(() => result.current.editor.select("a"));
    act(() => result.current.editor.select("b", "toggle"));
    act(() => {
      result.current.verbs.cut(board.write);
    });
    expect(result.current.editor.document.nodes.map(each => each.id)).toEqual([
      "c",
    ]);
    expect(result.current.editor.undoDepth).toBe(1);

    act(() => result.current.editor.select(null));
    act(() => {
      result.current.verbs.pasteText(board.text());
    });
    const nodes = result.current.editor.document.nodes;
    expect(nodes).toHaveLength(3);
    expect(result.current.editor.selection.ids).toEqual([
      nodes[1]?.id,
      nodes[2]?.id,
    ]);
    // Two undo steps in all: the cut, then the paste.
    expect(result.current.editor.undoDepth).toBe(2);
    act(() => {
      void result.current.editor.undo();
    });
    expect(result.current.editor.document.nodes.map(each => each.id)).toEqual([
      "c",
    ]);
  });
});

describe("a clipboard that will not take the copy", () => {
  it("cuts nothing when the write fails, and says so", () => {
    const { result, notify } = setUp(
      page(node("a", "core/heading"), node("b", "core/heading"))
    );
    act(() => result.current.editor.select("a"));
    act(() => {
      result.current.verbs.cut(() => false);
    });
    expect(result.current.editor.document.nodes).toHaveLength(2);
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/couldn’t be put on the clipboard/)
    );
  });

  it("removes the blocks only once a write that answers later succeeds", async () => {
    const { result } = setUp(
      page(node("a", "core/heading"), node("b", "core/heading"))
    );
    act(() => result.current.editor.select("a"));
    let answer: (ok: boolean) => void = () => undefined;
    act(() => {
      result.current.verbs.cut(
        () => new Promise<boolean>(resolve => (answer = resolve))
      );
    });
    // Nothing removed while the clipboard has not answered.
    expect(result.current.editor.document.nodes).toHaveLength(2);
    await act(async () => answer(true));
    expect(result.current.editor.document.nodes.map(each => each.id)).toEqual([
      "b",
    ]);
  });

  it("keeps the blocks when a write that answers later fails", async () => {
    const { result, notify } = setUp(
      page(node("a", "core/heading"), node("b", "core/heading"))
    );
    act(() => result.current.editor.select("a"));
    await act(async () => {
      result.current.verbs.cut(() => Promise.resolve(false));
    });
    expect(result.current.editor.document.nodes).toHaveLength(2);
    expect(notify).toHaveBeenCalled();
  });
});

describe("cutting blocks", () => {
  it("copies then removes, as one undo step", () => {
    const { result } = setUp(
      page(node("a", "core/heading"), node("b", "core/heading"))
    );
    const board = clipboard();
    act(() => result.current.editor.select("a"));
    act(() => {
      expect(result.current.verbs.cut(board.write)).toBe(true);
    });
    expect(result.current.editor.document.nodes.map(each => each.id)).toEqual([
      "b",
    ]);
    expect(result.current.editor.undoDepth).toBe(1);
    expect(JSON.parse(board.text()).blocks[0].id).toBe("a");

    act(() => {
      void result.current.editor.undo();
    });
    expect(result.current.editor.document.nodes).toHaveLength(2);
  });

  it("refuses a locked block with the lock's reason, as Delete does, and copies nothing", () => {
    const { result, announce } = setUp(
      page(node("a", "core/heading", { locked: true, name: "Caption" }))
    );
    const board = clipboard();
    act(() => result.current.editor.select("a"));
    act(() => {
      expect(result.current.verbs.cut(board.write)).toBe(false);
    });
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/locked/i));
    expect(board.text()).toBe("");
    expect(findNode(result.current.editor.document.nodes, "a")).toBeDefined();
    expect(result.current.editor.undoDepth).toBe(0);
  });
});

/** A clipboard event as a browser raises it, carrying `data`. */
function clipboardEvent(type: string, data: Record<string, string> = {}) {
  const held = { ...data };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (kind: string) => held[kind] ?? "",
      setData: (kind: string, text: string) => {
        held[kind] = text;
      },
    },
  });
  return { event, held };
}

describe("which clipboard events are the blocks'", () => {
  function chrome(): HTMLElement {
    const root = document.createElement("div");
    root.className = BUILDER_CHROME_CLASS;
    document.body.append(root);
    return root;
  }

  it("takes a press on a control inside the editor", () => {
    const button = document.createElement("button");
    chrome().append(button);
    const { event } = clipboardEvent("copy");
    Object.defineProperty(event, "target", { value: button });
    expect(blocksTakeClipboardEvent(event, document)).toBe(true);
  });

  it("leaves a text field's copy to the text", () => {
    const field = document.createElement("input");
    chrome().append(field);
    const { event } = clipboardEvent("copy");
    Object.defineProperty(event, "target", { value: field });
    expect(blocksTakeClipboardEvent(event, document)).toBe(false);
  });

  it("leaves a block's text being edited to the text", () => {
    const text = document.createElement("p");
    text.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    text.append(inner);
    chrome().append(text);
    const { event } = clipboardEvent("copy");
    Object.defineProperty(event, "target", { value: inner });
    expect(blocksTakeClipboardEvent(event, document)).toBe(false);
  });

  it("leaves text the author highlighted to the text", () => {
    const words = document.createElement("p");
    words.textContent = "Some words";
    chrome().append(words);
    const range = document.createRange();
    range.selectNodeContents(words);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const { event } = clipboardEvent("copy");
    Object.defineProperty(event, "target", { value: words });
    expect(blocksTakeClipboardEvent(event, document)).toBe(false);
    document.getSelection()?.removeAllRanges();
  });

  it("takes a copy over row labels highlighted in Layers, whose rows select blocks", () => {
    const tree = document.createElement("div");
    tree.setAttribute("role", "tree");
    const row = document.createElement("span");
    row.textContent = "Heading";
    tree.append(row);
    chrome().append(tree);
    const range = document.createRange();
    range.selectNodeContents(row);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const { event } = clipboardEvent("copy");
    Object.defineProperty(event, "target", { value: row });
    expect(blocksTakeClipboardEvent(event, document)).toBe(true);
    document.getSelection()?.removeAllRanges();
  });

  it("takes a paste over highlighted text that cannot be edited", () => {
    const words = document.createElement("p");
    words.textContent = "Some words";
    chrome().append(words);
    const range = document.createRange();
    range.selectNodeContents(words);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const { event } = clipboardEvent("paste");
    Object.defineProperty(event, "target", { value: words });
    expect(blocksTakeClipboardEvent(event, document)).toBe(true);
    document.getSelection()?.removeAllRanges();
  });

  it("leaves the hosting page's own controls alone", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const { event } = clipboardEvent("copy");
    Object.defineProperty(event, "target", { value: outside });
    expect(blocksTakeClipboardEvent(event, document)).toBe(false);
  });

  it("copies on ⌘C from inside the editor, and pastes copied blocks on ⌘V", () => {
    const button = document.createElement("button");
    chrome().append(button);
    const verbs: BlockClipboardVerbs = {
      copy: vi.fn((write?: ClipboardWrite) => {
        void write?.("copied");
        return true;
      }),
      cut: vi.fn(() => true),
      paste: vi.fn(),
      pasteText: vi.fn((text: string) => text === "copied"),
    };
    render(<BlockClipboardEvents verbs={verbs} enabled />);

    const copy = clipboardEvent("copy");
    button.dispatchEvent(copy.event);
    expect(copy.held["text/plain"]).toBe("copied");
    expect(copy.event.defaultPrevented).toBe(true);

    const paste = clipboardEvent("paste", { "text/plain": "copied" });
    button.dispatchEvent(paste.event);
    expect(verbs.pasteText).toHaveBeenCalledWith("copied");
    expect(paste.event.defaultPrevented).toBe(true);

    // Other text is left to the page.
    const other = clipboardEvent("paste", { "text/plain": "words" });
    button.dispatchEvent(other.event);
    expect(other.event.defaultPrevented).toBe(false);
  });
});
