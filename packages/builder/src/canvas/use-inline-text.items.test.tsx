// @vitest-environment jsdom
/**
 * Typing a list's items on the canvas: Enter adds an item after the current
 * one, carrying the words after the caret, and Backspace in an empty item
 * removes it, the caret going on to the item beside it each time.
 *
 * Driven through the real editor state, so what is checked is the document an
 * author would undo, and the list is drawn from it as the canvas draws one:
 * each item's element marked with its own address.
 */
import {
  clearBlocks,
  itemPropName,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useEditorState, type EditorState } from "../editor-state";

import { useInlineText, type UseInlineTextResult } from "./use-inline-text";

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/list",
        version: 1,
        description: "A list.",
        example: { props: {} },
        props: { items: { type: "array", of: "text", inline: true } },
        render: () => null,
      },
    ] as never,
    { source: "inline-items-keys-test" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

const item = (index: number) => itemPropName("items", index);

let editor: EditorState | null = null;
let inline: UseInlineTextResult | null = null;

/** The editor, and the list drawn from its document as the canvas draws it. */
function Canvas({ initial }: { initial: BlockDocument }) {
  const state = useEditorState({ initialDocument: initial });
  editor = state;
  inline = useInlineText(state);
  const node = state.document.nodes[0];
  const items = (node?.props.items as string[] | undefined) ?? [];
  return (
    <ul data-nx-node="l">
      {items.map((words, index) => (
        <li key={index} data-nx-prop={item(index)}>
          {words}
        </li>
      ))}
    </ul>
  );
}

function open(items: string[], at: number): void {
  const initial = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "l", type: "acme/list", version: 1, props: { items } } as BlockNode,
    ],
  } as BlockDocument;
  render(<Canvas initial={initial} />);
  act(() => {
    inline?.begin("l", item(at));
  });
}

const itemsNow = () => editor?.document.nodes[0]?.props.items;
const element = (index: number) =>
  document.querySelector<HTMLElement>(`[data-nx-prop="${item(index)}"]`)!;

/** Put the caret in an item, `offset` characters in. */
function caretAt(index: number, offset: number): void {
  const text = element(index).firstChild ?? element(index);
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Press a key in the item being typed, as the browser delivers it. */
function press(index: number, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    element(index).dispatchEvent(event);
  });
  return event;
}

/** Where the caret is: the item it is in and how far along. */
function caret(): { prop: string | null; offset: number; collapsed: boolean } {
  const selection = window.getSelection()!;
  const range = selection.getRangeAt(0);
  const holder =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement);
  const before = document.createRange();
  before.selectNodeContents(holder!);
  before.setEnd(range.startContainer, range.startOffset);
  return {
    prop: holder?.getAttribute("data-nx-prop") ?? null,
    offset: before.toString().length,
    collapsed: range.collapsed,
  };
}

describe("Enter in a list item", () => {
  it("adds the next item with the words after the caret, the caret at its start", () => {
    open(["One", "Two"], 0);
    caretAt(0, 1);
    const event = press(0, "Enter");
    expect(event.defaultPrevented).toBe(true);
    expect(itemsNow()).toEqual(["O", "ne", "Two"]);
    expect(inline?.editing?.prop).toBe(item(1));
    expect(element(1).getAttribute("contenteditable")).toBe("plaintext-only");
    expect(caret()).toEqual({ prop: item(1), offset: 0, collapsed: true });
  });

  it("at an item's end adds an empty one after it", () => {
    open(["One", "Two"], 1);
    caretAt(1, 3);
    press(1, "Enter");
    expect(itemsNow()).toEqual(["One", "Two", ""]);
    expect(inline?.editing?.prop).toBe(item(2));
  });

  it("is one step back for undo", async () => {
    open(["One", "Two"], 0);
    caretAt(0, 3);
    press(0, "Enter");
    await act(async () => {
      await editor?.undo();
    });
    expect(itemsNow()).toEqual(["One", "Two"]);
  });
});

describe("Backspace in a list item", () => {
  it("removes an empty item, the caret going to the end of the one before", () => {
    open(["One", "", "Three"], 1);
    const event = press(1, "Backspace");
    expect(event.defaultPrevented).toBe(true);
    expect(itemsNow()).toEqual(["One", "Three"]);
    expect(inline?.editing?.prop).toBe(item(0));
    expect(caret()).toEqual({ prop: item(0), offset: 3, collapsed: true });
  });

  it("leaves an item with words in it to the browser", () => {
    open(["One", "Two"], 1);
    caretAt(1, 0);
    const event = press(1, "Backspace");
    expect(event.defaultPrevented).toBe(false);
    expect(itemsNow()).toEqual(["One", "Two"]);
    expect(inline?.editing?.prop).toBe(item(1));
  });
});
