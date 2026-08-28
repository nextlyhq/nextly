// @vitest-environment jsdom

/**
 * The menu's wiring, which is the half `toolbar-actions.test.ts` cannot see.
 *
 * That file already decides which verbs appear and whether each is available.
 * What is only true HERE is that the menu opens on the gesture at all, that it
 * offers the SAME verbs the bar offers rather than a second list, and that
 * choosing one reaches the same verb a keystroke reaches.
 *
 * Rendered around a real `Canvas`, for the reason `block-toolbar.test` gives:
 * the menu's trigger is an ancestor of the canvas and its whole job is to
 * receive an event the canvas decided to let through, so a stub canvas could
 * not exhibit the case that matters.
 *
 * @module block-context-menu.test
 */
import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { ShortcutProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlockContextMenu } from "./block-context-menu";
import { Canvas } from "./canvas";
import type { EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

afterEach(() => {
  cleanup();
  clearBlocks();
});

function register() {
  if (hasBlock("acme/leaf")) return;
  registerBlocks(
    [
      {
        name: "acme/leaf",
        version: 1,
        description: "A leaf.",
        example: { props: {} },
        editor: { label: "Leaf" },
        render: () => React.createElement("p", null, "leaf"),
      },
    ] as never,
    { source: "block-context-menu-test" }
  );
}

/** Two blocks, so `up` and `down` each have a case that is available. */
function pair(extra: Partial<BlockNode> = {}): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/leaf", version: 1, props: {}, ...extra },
      { id: "b", type: "acme/leaf", version: 1, props: {} },
    ],
  } as BlockDocument;
}

function editorSpy(doc: BlockDocument, selectedId: string | null): EditorState {
  return {
    document: doc,
    selectedId,
    selection: {
      ids: selectedId === null ? [] : [selectedId],
      primary: selectedId,
    },
    select: vi.fn(),
    apply: vi.fn(() => doc),
    applyAll: vi.fn(() => doc),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
  } as unknown as EditorState;
}

function mount(editor: EditorState) {
  return render(
    <ShortcutProvider>
      <BlockKeyboardActions editor={editor}>
        <BlockContextMenu editor={editor}>
          <Canvas
            document={editor.document}
            siteStyles={{ css: "", classes: {} } as never}
            selectedId={editor.selectedId}
            onSelect={editor.select}
          />
        </BlockContextMenu>
      </BlockKeyboardActions>
    </ShortcutProvider>
  );
}

/** The rendered block, which is what a secondary click is aimed at. */
function blockElement(container: HTMLElement): Element {
  const element = container.querySelector(`[${NODE_ID_ATTRIBUTE}="a"]`);
  if (element === null) throw new Error("expected a rendered block");
  return element;
}

describe("the canvas's right-click menu", () => {
  it("opens on a secondary click over a block", () => {
    register();
    const { container } = mount(editorSpy(pair(), "a"));
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(blockElement(container));

    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("offers the verbs the toolbar offers, in the toolbar's words", () => {
    /*
     * The palette deliberately says "Duplicate block", because a palette row is
     * read in a list with no context. This menu is drawn AT the block, like the
     * bar, so it takes the bar's shorter wording — and taking the LIST from the
     * same call is what keeps a verb from appearing here and not there.
     */
    register();
    const { container } = mount(editorSpy(pair(), "a"));
    fireEvent.contextMenu(blockElement(container));

    const labels = screen
      .getAllByRole("menuitem")
      .map(item => item.textContent);
    expect(labels).toEqual([
      "Select parent",
      "Move up",
      "Move down",
      "Duplicate",
      "Delete",
    ]);
  });

  it("runs the verb the keystrokes run", () => {
    /*
     * Committed on `pointerup`, which is Radix's own path and the only one that
     * works here. Its item synthesises the click on pointer-up ONLY when it saw
     * no pointer-down, because a real browser would deliver the click itself —
     * and jsdom delivers neither. So a full down-then-up sequence selects
     * nothing, and a bare `fireEvent.click` reaches none of it either. Both
     * leave the menu open and the verb unrun, which is a menu that works
     * perfectly well for a real author and fails its own test.
     */
    register();
    const editor = editorSpy(pair(), "a");
    const { container } = mount(editor);
    fireEvent.contextMenu(blockElement(container));

    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" });
    fireEvent.pointerUp(duplicate, { pointerType: "mouse", button: 0 });

    // Through the editor's own `applyAll`, which is the op path the duplicate
    // verb takes for the keystroke and the bar alike. Asserting a spy passed to
    // the menu would prove only that the menu called what the test handed it.
    expect(editor.applyAll).toHaveBeenCalled();
  });

  it("leaves editor chrome to the browser's own menu", () => {
    /*
     * The toolbar and the appenders are drawn inside the canvas root, so they
     * sit inside this menu's trigger — and an appender for an empty container
     * is drawn inside the container's own element. Merely declining to select
     * there is not enough: the gesture would still reach the trigger and offer
     * the block's verbs for a press aimed at a button that is not a block.
     */
    register();
    const { container } = mount(editorSpy(pair(), "a"));
    // INSIDE the block, which is the case that discriminates. Chrome drawn on
    // the canvas background resolves to no node anyway, so a fixture there
    // passes whether or not this rule exists — the appender drawn inside an
    // empty container is the shape that would otherwise reach the trigger with
    // a block id already resolved.
    const chrome = window.document.createElement("button");
    chrome.setAttribute("data-nx-chrome", "");
    blockElement(container).appendChild(chrome);

    fireEvent.contextMenu(chrome);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves text being edited to the browser's own menu", () => {
    /*
     * Spelling, selection and clipboard for a caret have no replacement here,
     * so replacing the native menu with "Move up" mid-sentence is a straight
     * loss. The inline editor stops pointer and click but not this one.
     */
    register();
    const { container } = mount(editorSpy(pair(), "a"));
    const block = blockElement(container);
    const editable = window.document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    block.appendChild(editable);

    fireEvent.contextMenu(editable);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("acts on the pressed block when a long press opens the menu", () => {
    /*
     * Radix opens a long press from its OWN 700ms pointerdown timer and never
     * dispatches a `contextmenu` event, so the canvas's filtering — which runs
     * on that event — never sees this route. Without carrying the pressed
     * block across, the menu opens on the PREVIOUS selection, and Delete among
     * its verbs acts on a block the author is not looking at.
     *
     * Driven as press-then-open rather than by waiting out the timer: the
     * timer is Radix's, and what this component has to get right is the
     * SUBJECT the menu opens on.
     */
    register();
    const editor = editorSpy(pair(), "b");
    const { container } = mount(editor);

    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(blockElement(container), {
        pointerType: "touch",
        clientX: 10,
        clientY: 10,
      });
      // Nothing yet: this is a contact, not yet a gesture.
      expect(editor.select).not.toHaveBeenCalled();

      // Radix's own timer, run out. The menu opening is what carries the
      // subject across, so the wait is the mechanism rather than a delay.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(editor.select).toHaveBeenCalledWith("a", "replace");
  });

  it("does not move the selection on a press that never opens anything", () => {
    /*
     * The case that makes deferring necessary. Every touch contact begins as a
     * pointerdown, and most become a scroll rather than a long press — Radix
     * cancels its own timer on pointermove, but a selection made on contact
     * would already have retargeted the inspector and the toolbar, and nothing
     * puts it back.
     */
    register();
    const editor = editorSpy(pair(), "b");
    const { container } = mount(editor);

    fireEvent.pointerDown(blockElement(container), { pointerType: "touch" });
    fireEvent.pointerMove(blockElement(container), { pointerType: "touch" });

    expect(editor.select).not.toHaveBeenCalled();
  });

  it("leaves the caret's own behaviour to the browser", () => {
    /*
     * The press must not be cancelled. It fires at the start of every contact,
     * long before anything knows whether it will become a long press, so
     * preventing the default there takes caret placement and text selection
     * away from an author who was only tapping into a sentence. Rejection is
     * done by withholding the event from above instead — asserted here as the
     * default surviving, which is the observable of that choice.
     */
    register();
    const editor = editorSpy(pair(), "a");
    const { container } = mount(editor);
    const editable = window.document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    blockElement(container).appendChild(editable);

    const notPrevented = fireEvent.pointerDown(editable, {
      pointerType: "touch",
    });

    expect(notPrevented).toBe(true);
    expect(editor.select).not.toHaveBeenCalled();
  });

  it("opens on the block the gesture named, not the one pressed before it", () => {
    /*
     * A rendered block can be focusable on its own — `core/button` draws a real
     * `button` — so a menu key reaches this as a context event with NO press
     * before it. A target remembered from an earlier press would still be
     * sitting there, and the menu would open on that block instead: Delete and
     * Duplicate then act on something the author is not looking at, which is
     * the same defect as the touch case arriving by the opposite route.
     */
    register();
    const editor = editorSpy(pair(), "b");
    const { container } = mount(editor);
    const first = blockElement(container);
    const second = container.querySelector(`[${NODE_ID_ATTRIBUTE}="b"]`);
    if (second === null) throw new Error("expected the second block");

    // A press on one block, which opens nothing.
    fireEvent.pointerDown(first, { pointerType: "touch" });
    // Then the gesture that DOES open, aimed somewhere else.
    fireEvent.contextMenu(second);

    // Never "a", which is what the stale press was pointing at. `b` is already
    // the selection, so the correct behaviour is to leave it alone entirely.
    expect(editor.select).not.toHaveBeenCalledWith("a", "replace");
  });

  it("keeps an unavailable verb, carrying the reason it is unavailable", () => {
    /*
     * A lock is the one reason `toolbarActions` reports, because it is the one
     * an author can act on and nothing on the canvas explains it. Removing the
     * item instead answers "why can I not delete this" with nothing at all.
     */
    register();
    const locked = pair({ locked: true } as Partial<BlockNode>);
    const { container } = mount(editorSpy(locked, "a"));
    fireEvent.contextMenu(blockElement(container));

    const remove = screen
      .getAllByRole("menuitem")
      .find(item => item.textContent?.startsWith("Delete"));
    if (remove === undefined) throw new Error("expected a Delete item");
    expect(remove.getAttribute("data-disabled")).not.toBeNull();
    // VISIBLE, not a `title`. A disabled item has `pointer-events-none` and is
    // skipped by keyboard navigation, so a tooltip on it is unreachable by
    // either input — the reason has to be in the item's own content.
    expect(remove.textContent).toContain("This block is locked.");
    expect(remove.getAttribute("title")).toBeNull();
  });
});
