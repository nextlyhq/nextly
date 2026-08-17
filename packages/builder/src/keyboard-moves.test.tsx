// @vitest-environment jsdom

/**
 * What the wiring adds on top of the rule: that the keys ask for the move the
 * rule decided, and that the answer reaches the store.
 *
 * `keyboard-move.test.ts` already covers where a block lands and what a
 * direction means. Re-asserting that through a keystroke would test the same
 * derivation twice while making the failures harder to read, so what is checked
 * here is the seam — the binding, its guards, and the op passed to `apply`.
 *
 * @module keyboard-moves.test
 */
import { cleanup, render } from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { useBlockKeyboardMoves } from "./keyboard-moves";

// `cleanup`, not an innerHTML wipe. This package does not enable vitest
// globals, so testing-library registers no cleanup of its own — and clearing
// the DOM does not UNMOUNT the tree, so every previous case's shortcut layer
// stays registered against the editor it was given. A later press then fires an
// earlier test's binding, which is how "nothing is selected" came back with the
// keystroke consumed.
afterEach(cleanup);

function documentOf(nodes: BlockDocument["nodes"]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** Two top-level blocks, so `up` and `down` both have somewhere to go. */
function pair(): BlockDocument {
  return documentOf([
    { id: "a", type: "acme/text", version: 1, props: {} },
    { id: "b", type: "acme/text", version: 1, props: {} },
  ]);
}

function editorSpy(
  doc: BlockDocument,
  selectedId: string | null
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
    document: doc,
    selectedId,
    select: vi.fn(),
    apply: vi.fn(() => doc),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

function Harness({ editor }: { editor: EditorState }) {
  useBlockKeyboardMoves({ editor });
  return null;
}

function mount(editor: EditorState) {
  render(
    <ShortcutProvider>
      <Harness editor={editor} />
    </ShortcutProvider>
  );
}

/**
 * Press a key on the document, as the shortcut manager listens for it.
 *
 * Returns the event so a caller can read `defaultPrevented`, which is how a
 * binding that DECLINED a keystroke is told apart from one that handled it and
 * did nothing. Both leave the store untouched.
 */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}

describe("useBlockKeyboardMoves", () => {
  it("moves the selected block down, through the store", () => {
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("ArrowDown", { altKey: true });

    expect(editor.apply).toHaveBeenCalledTimes(1);
    const op = editor.apply.mock.calls[0][0];
    expect(op.kind).toBe("move");
    expect(op.id).toBe("a");
    // Index 1: past its sibling. A wiring that passed the selection's own index
    // would move it to where it already is.
    expect(op.to).toEqual({ index: 1 });
  });

  it("moves the selected block up", () => {
    const editor = editorSpy(pair(), "b");
    mount(editor);

    press("ArrowUp", { altKey: true });

    expect(editor.apply.mock.calls[0][0].to).toEqual({ index: 0 });
  });

  it("does nothing when the move has nowhere to go", () => {
    // The first block cannot move up. A refusal is an ordinary answer, so
    // nothing reaches the store — and nothing is reported at the author either.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("ArrowUp", { altKey: true });

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("passes the keystroke on when nothing is selected", () => {
    // Not merely "does nothing". A binding that fired and returned early leaves
    // the store untouched too, and ALSO calls preventDefault — swallowing the
    // caret movement alt+Arrow performs natively. Only `defaultPrevented`
    // separates declining a keystroke from consuming it, which is why asserting
    // the store alone passed with the guard deleted.
    const editor = editorSpy(pair(), null);
    mount(editor);

    const event = press("ArrowDown", { altKey: true });

    expect(editor.apply).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("consumes the keystroke when it does move a block", () => {
    // The control for the case above: it pins `defaultPrevented` as observable
    // and true on the happy path, so the false there is a real difference
    // rather than a value this environment never sets.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    const event = press("ArrowDown", { altKey: true });

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores an arrow pressed without alt", () => {
    // The control for every case above. A binding that fired on a bare arrow
    // would satisfy all of them while making the arrow keys unusable for
    // anything else.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("ArrowDown");

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("leaves the selection on the block that moved", () => {
    // What makes a run of presses walk one block across the page instead of
    // moving a different block each time.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("ArrowDown", { altKey: true });

    expect(editor.select).not.toHaveBeenCalled();
  });

  it("carries the vacated slot when a block leaves a container", () => {
    // Outdenting empties the container it leaves. Without `dropSlotIfEmpty` the
    // slot survives as an empty array, which the page-builder validator
    // rejects — and a keyboard author meets that far sooner than a pointer one,
    // moving a single block at a time.
    const editor = editorSpy(
      documentOf([
        {
          id: "wrap",
          type: "acme/columns",
          version: 1,
          props: {},
          slots: {
            children: [
              { id: "inner", type: "acme/text", version: 1, props: {} },
            ],
          },
        },
      ]),
      "inner"
    );
    mount(editor);

    press("ArrowLeft", { altKey: true });

    const op = editor.apply.mock.calls[0]?.[0];
    expect(op?.kind).toBe("move");
    expect(op?.dropSlotIfEmpty).toEqual({ parentId: "wrap", slot: "children" });
  });
});
