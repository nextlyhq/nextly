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
import { act, cleanup, render, screen } from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { BlockKeyboardMoves } from "./keyboard-moves";

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

/**
 * Mounts the COMPONENT rather than calling the hook.
 *
 * That is what a host renders, and it is the half carrying the live region: a
 * harness that called the hook and returned null would exercise the bindings
 * while leaving the announcement untested — which is how the effect the rule
 * returns went unconsumed in the first place.
 */
function mount(editor: EditorState) {
  render(
    <ShortcutProvider>
      <BlockKeyboardMoves editor={editor} />
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
  // Wrapped in `act` because the listener is on `document` rather than on a
  // rendered node: testing-library wraps its own `fireEvent`, but a direct
  // dispatch is outside that, so a state update the handler makes is not
  // flushed before the assertion reads the DOM.
  act(() => {
    document.dispatchEvent(event);
  });
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

  it("announces the move, naming what the effect was", () => {
    // A keyboard author cannot see the result, and `keyboardMovePosition`
    // returns `effect` for exactly this. Dropping it made a reorder and a
    // change of parent identical to someone not looking at the screen.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("ArrowDown", { altKey: true });

    const region = screen.getByRole("status");
    expect(region.textContent).toContain("Block moved");
  });

  it("distinguishes leaving a container from reordering", () => {
    // The separating case. Both are "the block moved"; only one changes which
    // block CONTAINS it, and that is the difference a screen reader must carry.
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

    expect(screen.getByRole("status").textContent).toContain(
      "out of its container"
    );
  });

  it("says nothing when the move was refused", () => {
    // The first block cannot move up. Announcing a move that did not happen is
    // worse than silence, because it cannot be told from one that did.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("ArrowUp", { altKey: true });

    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("says nothing when the store refuses the op", () => {
    // `apply` answering null means the document moved underneath the press.
    // The rule permitted it; the store did not.
    const editor = editorSpy(pair(), "a");
    editor.apply.mockReturnValue(null);
    mount(editor);

    press("ArrowDown", { altKey: true });

    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("re-announces a repeated move rather than falling silent", () => {
    // Two presses of the same direction produce the same sentence, and a live
    // region does not re-read text that did not change — so the second press
    // would be silent without something making the value differ.
    const editor = editorSpy(
      documentOf([
        { id: "a", type: "acme/text", version: 1, props: {} },
        { id: "b", type: "acme/text", version: 1, props: {} },
        { id: "c", type: "acme/text", version: 1, props: {} },
      ]),
      "a"
    );
    mount(editor);

    press("ArrowDown", { altKey: true });
    const first = screen.getByRole("status").textContent;
    press("ArrowDown", { altKey: true });
    const second = screen.getByRole("status").textContent;

    expect(first).not.toBe(second);
    // And both still read as the same sentence to a listener: the difference is
    // a zero-width space, not different wording.
    expect(second?.replace(/\u200b/g, "")).toBe(first?.replace(/\u200b/g, ""));
  });

  it("renders the live region before any move happens", () => {
    // A region added to the page at the moment it gains text is frequently not
    // announced at all — the assistive technology has nothing it was already
    // watching. Present and empty from the first render.
    mount(editorSpy(pair(), "a"));

    const region = screen.getByRole("status");
    expect(region).toBeTruthy();
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });
});
