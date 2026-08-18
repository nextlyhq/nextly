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
 * @module keyboard-actions.test
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";

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
      <BlockKeyboardActions editor={editor} />
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

describe("useBlockKeyboardActions", () => {
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

  it("refuses to move a locked block, and says why", () => {
    const editor = editorSpy(
      documentOf([
        { id: "a", type: "acme/text", version: 1, props: {}, locked: true },
        { id: "b", type: "acme/text", version: 1, props: {} },
      ] as BlockDocument["nodes"]),
      "a"
    );
    mount(editor);

    press("ArrowDown", { altKey: true });

    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent ?? "").toMatch(
      /is locked\. unlock it to move it/i
    );
  });

  it("ALLOWS moving a container that holds a locked block", () => {
    /*
     * The direction that is easy to get wrong by being cautious, and the reason
     * move and delete ask different questions.
     *
     * Moving the container leaves the locked child in the same slot at the same
     * index with the same neighbours, so nothing the lock protects has changed.
     * Refusing here would let one locked caption freeze the entire section
     * around it, which an author would experience as the editor breaking rather
     * than as a lock working.
     */
    const editor = editorSpy(
      documentOf([
        {
          id: "wrap",
          type: "acme/box",
          version: 1,
          props: {},
          slots: {
            children: [
              {
                id: "kid",
                type: "acme/text",
                version: 1,
                props: {},
                locked: true,
              },
            ],
          },
        },
        { id: "after", type: "acme/text", version: 1, props: {} },
      ] as BlockDocument["nodes"]),
      "wrap"
    );
    mount(editor);

    press("ArrowDown", { altKey: true });

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply.mock.calls[0][0].kind).toBe("move");
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

  it("deletes the selected block through the store", () => {
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("Delete");

    expect(editor.apply).toHaveBeenCalledTimes(1);
    const op = editor.apply.mock.calls[0][0];
    expect(op.kind).toBe("remove");
    expect(op.id).toBe("a");
  });

  it("deletes on Backspace as well", () => {
    // Most people reach for Backspace. Binding only Delete leaves half the
    // authors pressing a key that does nothing.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("Backspace");

    expect(editor.apply.mock.calls[0][0].kind).toBe("remove");
  });

  it("moves the selection forward, not backward", () => {
    // The repeated-delete case: selecting the PREVIOUS sibling would put the
    // author on a block they already approved, so a second press destroys work
    // behind them.
    const editor = editorSpy(
      documentOf([
        { id: "a", type: "acme/text", version: 1, props: {} },
        { id: "b", type: "acme/text", version: 1, props: {} },
        { id: "c", type: "acme/text", version: 1, props: {} },
      ]),
      "b"
    );
    mount(editor);

    press("Delete");

    expect(editor.select).toHaveBeenCalledWith("c");
  });

  it("does not move the selection when the store refuses", () => {
    // Moving it first would leave the author pointed at a neighbour while the
    // block they asked to delete is still on the page.
    const editor = editorSpy(pair(), "a");
    editor.apply.mockReturnValue(null);
    mount(editor);

    press("Delete");

    expect(editor.select).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("announces what was deleted and how to get it back", () => {
    // A screen-reader user cannot see an undo control, so the announcement is
    // the only place the recovery path exists for them.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("Delete");

    const said = screen.getByRole("status").textContent ?? "";
    // The HUMANISED name, because this fixture registers no block and so has no
    // declared label. An unlabelled block is named the same way here as in the
    // palette and the layers panel — announcing `acme/text` while both of those
    // read "Text" would give one block two names inside one editor, and the
    // announcement is the only one of the three a screen-reader user hears.
    // The declared-label case is asserted below.
    expect(said).toContain("Text deleted");
    expect(said).toContain("Undo");
  });

  it("refuses to delete a locked block, and says why", () => {
    /*
     * A lock is a POLICY refusal, so it is announced where a structural one is
     * not. Nothing on the page explains why the key did nothing, the remedy is
     * one the author can act on, and a keyboard user has no lock badge to look
     * at — which is the whole reason silence would be wrong here.
     */
    const editor = editorSpy(
      documentOf([
        { id: "a", type: "acme/text", version: 1, props: {}, locked: true },
        { id: "b", type: "acme/text", version: 1, props: {} },
      ] as BlockDocument["nodes"]),
      "a"
    );
    mount(editor);

    press("Delete");

    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent ?? "").toMatch(
      /is locked\. unlock it to delete it/i
    );
  });

  it("refuses to delete a container holding a locked block, and names it", () => {
    // THE case. Deleting the container destroys the locked child, which is the
    // one outcome the flag exists to prevent — and it happens through an action
    // aimed at something else, with the descendant count as the only clue.
    const editor = editorSpy(
      documentOf([
        {
          id: "wrap",
          type: "acme/box",
          version: 1,
          props: {},
          slots: {
            children: [
              {
                id: "kid",
                type: "acme/text",
                version: 1,
                props: {},
                locked: true,
              },
            ],
          },
        },
      ] as BlockDocument["nodes"]),
      "wrap"
    );
    mount(editor);

    press("Delete");

    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent ?? "").toMatch(
      /contains .*which is locked/i
    );
  });

  it("still deletes a container whose children are all unlocked", () => {
    // The control for both refusals above. Without it, a delete that refused
    // everything would satisfy them and nothing would notice.
    const editor = editorSpy(
      documentOf([
        {
          id: "wrap",
          type: "acme/box",
          version: 1,
          props: {},
          slots: {
            children: [{ id: "kid", type: "acme/text", version: 1, props: {} }],
          },
        },
      ] as BlockDocument["nodes"]),
      "wrap"
    );
    mount(editor);

    press("Delete");

    expect(editor.apply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "remove", id: "wrap" })
    );
  });

  it("says how many blocks a container takes with it", () => {
    // A collapsed section looks exactly like an empty one, so the count is the
    // only thing telling an author what they just lost.
    const editor = editorSpy(
      documentOf([
        {
          id: "wrap",
          type: "acme/box",
          version: 1,
          props: {},
          slots: {
            children: [
              { id: "x", type: "acme/text", version: 1, props: {} },
              { id: "y", type: "acme/text", version: 1, props: {} },
            ],
          },
        },
      ]),
      "wrap"
    );
    mount(editor);

    press("Delete");

    expect(screen.getByRole("status").textContent).toContain("2 blocks inside");
  });

  // `ctrlKey`, not `metaKey`: the manager resolves `mod` from the platform, and
  // this environment is not macOS — so a Command press here matches nothing and
  // would report the binding as missing when it is the fixture that is wrong.
  it("undoes, and says so", () => {
    const editor = editorSpy(pair(), "a");
    (editor as { canUndo: boolean }).canUndo = true;
    mount(editor);

    press("z", { ctrlKey: true });

    expect(editor.undo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("Undone");
  });

  it("does not undo when there is nothing to undo", () => {
    // `canUndo` is false on the spy by default. A binding that fired regardless
    // would call into an empty history on every press.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("z", { ctrlKey: true });

    expect(editor.undo).not.toHaveBeenCalled();
  });

  it("redoes on both the mac and windows spellings", () => {
    const editor = editorSpy(pair(), "a");
    (editor as { canRedo: boolean }).canRedo = true;
    mount(editor);

    press("z", { ctrlKey: true, shiftKey: true });
    press("y", { ctrlKey: true });

    expect(editor.redo).toHaveBeenCalledTimes(2);
  });

  it("undoes with no selection", () => {
    // Undo acts on the document's history rather than on whatever is selected,
    // and the commonest thing to undo is a deletion — which leaves a different
    // block selected than the one the edit touched.
    const editor = editorSpy(pair(), null);
    (editor as { canUndo: boolean }).canUndo = true;
    mount(editor);

    press("z", { ctrlKey: true });

    expect(editor.undo).toHaveBeenCalledTimes(1);
  });

  it("names the block by its label when it has one", () => {
    // An author who inserted "Divider" from the palette should hear "Divider
    // deleted" — the identifier is what the registry calls it, the label is
    // what they were shown.
    clearBlocks();
    registerBlocks(
      [
        {
          name: "acme/text",
          version: 1,
          description: "A block.",
          example: { props: {} },
          render: () => null,
          editor: { label: "Paragraph" },
        },
      ] as never,
      { source: "keyboard-actions-test" }
    );
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("Delete");

    expect(screen.getByRole("status").textContent).toContain(
      "Paragraph deleted"
    );
    clearBlocks();
  });
});
