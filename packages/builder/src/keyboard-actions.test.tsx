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
import { ShortcutProvider, useShortcuts } from "@nextlyhq/ui";
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

type EditorSpy = EditorState & {
  apply: ReturnType<typeof vi.fn>;
  applyAll: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

function editorSpy(doc: BlockDocument, selectedId: string | null): EditorSpy {
  return {
    document: doc,
    selectedId,
    // The set the structural verbs now read. Derived from the primary here so
    // every existing case keeps describing one selected block, which is what
    // they were written to describe.
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
  } as unknown as EditorSpy;
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
function press(
  key: string,
  init: KeyboardEventInit = {},
  /**
   * Where the keystroke starts, defaulting to the document.
   *
   * It matters for any binding whose behaviour depends on whether the user is
   * TYPING: the manager reads that from the event's target, not from
   * `document.activeElement`. A test that focuses a field and then dispatches
   * on the document has moved the focus and told the manager nothing, so a
   * `whenTyping` rule is exercised by neither value — which is exactly how the
   * first version of the field case below passed against both settings.
   */
  target: EventTarget = window.document
): KeyboardEvent {
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
    target.dispatchEvent(event);
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

  it("says the move did not happen, naming no cause, when the rule permitted it", () => {
    /*
     * The store refusing something the nesting rule permits: a byte cap, a
     * depth limit, an op the forest rejects.
     *
     * It is reported rather than passed over, because a keyboard author cannot
     * see that nothing moved. And it names NO cause, because none was
     * established — the rule allowed this placement, so any reason given here
     * would be invented, and would send an author to change a container that
     * was never the problem.
     */
    const editor = editorSpy(pair(), "a");
    editor.apply.mockReturnValue(null);
    mount(editor);

    press("ArrowDown", { altKey: true });

    const said = screen.getByRole("status").textContent ?? "";
    expect(said).toContain("could not be moved");
    // No cause, because none was established.
    expect(said).not.toMatch(/take|inside|slot/i);
  });

  it("REFUSES a move the nesting rule forbids, and says why", () => {
    /*
     * A pointer author who drags a block somewhere it cannot go is shown the
     * reason and the remedy. The same move by keyboard must be refused and
     * explained too: a rule that reaches one route and not the other costs
     * exactly the people the keyboard route exists for, and a status that
     * never arrives is the failure WCAG 4.1.3 describes.
     *
     * The nesting source is supplied rather than registered so the refusal is a
     * property of THIS test rather than of whatever the registry happens to
     * hold: `acme/text` may only sit inside `acme/box`, so moving it to the
     * root is refused by the rule, not by the store's other limits.
     */
    const editor = editorSpy(pair(), "a");
    render(
      <ShortcutProvider>
        <BlockKeyboardActions
          editor={editor}
          nesting={{ parentsOf: () => ["acme/box"] }}
        />
      </ShortcutProvider>
    );

    press("ArrowDown", { altKey: true });

    /*
     * REFUSED, not merely explained. The store never asks the nesting rule, so
     * a move that reaches `apply` is applied — and the document would then hold
     * a placement a drag refuses. `apply` not being reached is the assertion
     * that separates stopping the move from narrating it.
     */
    expect(editor.apply).not.toHaveBeenCalled();
    const said = screen.getByRole("status").textContent ?? "";
    // A REASON, not merely that something failed — the assertion the previous
    // wording could not make, since "could not be moved" is true of both.
    expect(said).toMatch(/has to sit inside a container/i);
    // And the remedy, which is what turns a refusal into an instruction.
    expect(said).toMatch(/goes inside/i);
  });

  it("stays silent at a BOUNDARY, which is not a refusal", () => {
    /*
     * The other half, and the reason this fix is not simply "announce more".
     * The first block cannot move up: there is nowhere to go, the store is
     * never asked, and saying "already first" on every press is noise an
     * author cannot act on. Only a move the RULES refused has something to
     * explain.
     *
     * Without this, the natural next change — announcing on every path that
     * ends without a move — would pass every other case here.
     */
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("ArrowUp", { altKey: true });

    expect(editor.apply).not.toHaveBeenCalled();
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

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    const op = editor.applyAll.mock.calls[0][0][0];
    expect(op.kind).toBe("remove");
    expect(op.id).toBe("a");
  });

  it("deletes on Backspace as well", () => {
    // Most people reach for Backspace. Binding only Delete leaves half the
    // authors pressing a key that does nothing.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("Backspace");

    expect(editor.applyAll.mock.calls[0][0][0].kind).toBe("remove");
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
    editor.applyAll.mockReturnValue(null);
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

  it("duplicates the selected block through the store", () => {
    // `ctrlKey`, not `metaKey`. The binding is declared as `mod`, which the
    // shortcut manager resolves per platform — and jsdom is not macOS, so it
    // resolves to Control here while a real browser on this machine wants
    // Command. A test pressing Meta simply never fires the binding, and reads
    // as the command being unwired.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("d", { ctrlKey: true });

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    const op = editor.applyAll.mock.calls[0][0][0];
    expect(op.kind).toBe("insert");
    // Immediately after the original, not at the end of the page.
    expect(op.at).toEqual({ index: 1 });
  });

  it("gives the copy a different id from the original", () => {
    // Ids are the only thing the editor addresses by, so a copy that kept one
    // would send every later edit to whichever node the walk found first.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("d", { ctrlKey: true });

    expect(editor.applyAll.mock.calls[0][0][0].node.id).not.toBe("a");
  });

  it("selects the copy, not the original", () => {
    // The copy is the block the author is now working on — they duplicated it
    // in order to change it — and leaving the original selected would send the
    // next edit to the wrong one of two identical blocks.
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("d", { ctrlKey: true });

    const copyId = editor.applyAll.mock.calls[0][0][0].node.id;
    // Through the same grammar a click uses, so there is no second way to build
    // a selection: one replace, then a toggle per further copy.
    expect(editor.select).toHaveBeenCalledWith(copyId, "replace");
  });

  it("announces the duplication and the way back", () => {
    const editor = editorSpy(pair(), "a");
    mount(editor);

    press("d", { ctrlKey: true });

    const said = screen.getByRole("status").textContent ?? "";
    expect(said).toMatch(/duplicated/i);
    expect(said).toContain("Undo");
  });

  it("DUPLICATES a locked block rather than refusing", () => {
    /*
     * The engine's rule is that the command layer must not let an author move
     * or DELETE a locked node. Duplicating does neither — the original stays
     * exactly where it is — so refusing would read as cautious and would mean
     * an author could not take a copy of the block they had most deliberately
     * protected.
     */
    const editor = editorSpy(
      documentOf([
        { id: "a", type: "acme/text", version: 1, props: {}, locked: true },
      ] as BlockDocument["nodes"]),
      "a"
    );
    mount(editor);

    press("d", { ctrlKey: true });

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(editor.applyAll.mock.calls[0][0][0].kind).toBe("insert");
  });

  it("does nothing with no selection", () => {
    // The control for every case above: they would all pass against a binding
    // that fired unconditionally.
    const editor = editorSpy(pair(), null);
    mount(editor);

    press("d", { ctrlKey: true });

    expect(editor.applyAll).not.toHaveBeenCalled();
  });

  it("names a block by the name its author gave it", () => {
    // The layers panel and the breadcrumb both show the instance name, so the
    // one surface a screen-reader user HEARS must not be the only one still
    // calling the block by its type.
    const editor = editorSpy(
      documentOf([
        {
          id: "a",
          type: "acme/text",
          version: 1,
          props: {},
          name: "Hero title",
        },
        { id: "b", type: "acme/text", version: 1, props: {} },
      ] as BlockDocument["nodes"]),
      "a"
    );
    mount(editor);

    press("Delete");

    expect(screen.getByRole("status").textContent ?? "").toContain(
      "Hero title deleted"
    );
  });

  it("names a LOCKED block by its author's name too", () => {
    const editor = editorSpy(
      documentOf([
        {
          id: "a",
          type: "acme/text",
          version: 1,
          props: {},
          name: "Hero title",
          locked: true,
        },
      ] as BlockDocument["nodes"]),
      "a"
    );
    mount(editor);

    press("Delete");

    expect(screen.getByRole("status").textContent ?? "").toContain(
      "Hero title is locked"
    );
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

    expect(editor.applyAll).not.toHaveBeenCalled();
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

    expect(editor.applyAll).not.toHaveBeenCalled();
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

    // A GROUP now, even for one block: the verbs plan across the selection and
    // a single block is a selection of one.
    expect(editor.applyAll).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "remove", id: "wrap" }),
    ]);
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

describe("the verbs act on the WHOLE selection", () => {
  /** An editor with three top-level blocks and two of them selected. */
  function twoSelected() {
    return {
      ...editorSpy(
        documentOf([
          { id: "a", type: "acme/text", version: 1, props: {} },
          { id: "b", type: "acme/text", version: 1, props: {} },
          { id: "c", type: "acme/text", version: 1, props: {} },
        ]),
        "a"
      ),
      selection: { ids: ["a", "c"], primary: "a" },
    } as ReturnType<typeof editorSpy>;
  }

  it("deletes every selected block in ONE group", () => {
    // One group, so one undo. Two separate applies would cost two presses to
    // take back something the author did once.
    const editor = twoSelected();
    mount(editor);

    press("Delete");

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(
      editor.applyAll.mock.calls[0][0].map((op: { id: string }) => op.id)
    ).toEqual(["a", "c"]);
  });

  it("counts the blocks in what it says, rather than naming one", () => {
    // "Hero title deleted" would be wrong and confusing when three went.
    const editor = twoSelected();
    mount(editor);

    press("Delete");

    expect(screen.getByRole("status").textContent).toContain(
      "2 blocks deleted"
    );
  });

  it("duplicates every selected block and selects the copies", () => {
    const editor = twoSelected();
    mount(editor);

    press("d", { ctrlKey: true });

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(editor.applyAll.mock.calls[0][0]).toHaveLength(2);
    // One replace then one toggle: the copies become the selection through the
    // same grammar a click uses.
    expect(editor.select).toHaveBeenCalledWith(expect.any(String), "replace");
    expect(editor.select).toHaveBeenCalledWith(expect.any(String), "toggle");
  });

  it("refuses the whole delete when ONE selected block is locked", () => {
    /*
     * Atomic: there is no half-done delete to fall back to. Silently skipping
     * the locked one would leave an author who selected two blocks looking at
     * one they did not notice surviving.
     */
    const editor = {
      ...editorSpy(
        documentOf([
          { id: "a", type: "acme/text", version: 1, props: {} },
          {
            id: "c",
            type: "acme/text",
            version: 1,
            props: {},
            locked: true,
            name: "Pinned",
          },
        ] as never),
        "a"
      ),
      selection: { ids: ["a", "c"], primary: "a" },
    } as ReturnType<typeof editorSpy>;
    mount(editor);

    press("Delete");

    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "Pinned is locked. Unlock it to delete it."
    );
  });
});

describe("Escape belongs to the editor, not to the page behind it", () => {
  /*
   * The regression this exists for: the admin binds Escape on the entry form to
   * "cancel and go back", both sets of bindings live in ONE shortcut stack, and
   * with nothing claiming the key here an author pressing Escape over the canvas
   * was navigated away from the entry — discarding every block edit the builder
   * had not yet committed, with no prompt, because the form was never told the
   * document had changed.
   *
   * The harness registers a competing layer at the host's precedence and asserts
   * it never runs. Asserting only that the selection cleared would pass against
   * an editor that cleared it AND let the key through.
   */
  function mountWithHostEscape(editor: EditorState) {
    const hostCancel = vi.fn();
    function HostBindings(): null {
      useShortcuts(
        [{ keys: "Escape", description: "Cancel", run: hostCancel }],
        {
          name: "test-entry-form",
        }
      );
      return null;
    }
    render(
      <ShortcutProvider>
        <HostBindings />
        <BlockKeyboardActions editor={editor} />
      </ShortcutProvider>
    );
    return hostCancel;
  }

  it("clears the selection and does NOT reach the page's cancel", () => {
    const editor = editorSpy(pair(), "a");
    const hostCancel = mountWithHostEscape(editor);

    press("Escape");

    expect(editor.select).toHaveBeenCalledWith(null);
    expect(hostCancel).not.toHaveBeenCalled();
  });

  it("holds the key even with NOTHING selected", () => {
    /*
     * THE case, and the one a rule written around what Escape ACHIEVES would
     * get wrong. With no selection there is nothing to clear, so an editor that
     * only claimed the key when it had work to do would release it here — and
     * this is exactly the state an author is in after clicking canvas
     * background, one click away from any block.
     */
    const editor = editorSpy(pair(), null);
    const hostCancel = mountWithHostEscape(editor);

    press("Escape");

    expect(hostCancel).not.toHaveBeenCalled();
  });

  it("wins even when the host's layer registers LAST", () => {
    /*
     * What makes the claim PRECEDENCE rather than luck.
     *
     * At equal priority the manager orders layers by depth and then by which
     * registered later, and "later" wins. Every other case here mounts the host
     * first, so the editor would come out on top from mount order alone — and
     * removing the priority entirely left them all green, which is how this gap
     * was found. Reversing the mount order takes that accident away: only the
     * declared priority can decide it now.
     *
     * This is not a contrived arrangement. The shell renders its own provider,
     * which resolves to the host's manager and INHERITS its depth rather than
     * adding to it, so the two sets of bindings genuinely sit at one level and
     * their order is whatever mounting happened to produce.
     */
    const editor = editorSpy(pair(), "a");
    const hostCancel = vi.fn();
    function HostBindings(): null {
      useShortcuts(
        [{ keys: "Escape", description: "Cancel", run: hostCancel }],
        { name: "test-entry-form" }
      );
      return null;
    }
    render(
      <ShortcutProvider>
        <BlockKeyboardActions editor={editor} />
        <HostBindings />
      </ShortcutProvider>
    );

    press("Escape");

    expect(hostCancel).not.toHaveBeenCalled();
    expect(editor.select).toHaveBeenCalledWith(null);
  });

  it("stands down while a modal is open, which dismisses on the same key", () => {
    // Escape means "dismiss the innermost thing". A rule that simply took the
    // key for the canvas would strand an open palette, and the author would
    // press Escape at a dialog and watch the page behind it change instead.
    const editor = editorSpy(pair(), "a");
    const dialog = window.document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    window.document.body.append(dialog);
    try {
      render(
        <ShortcutProvider>
          <BlockKeyboardActions editor={editor} />
        </ShortcutProvider>
      );

      const event = press("Escape");

      /*
       * `defaultPrevented`, not "the selection did not change".
       *
       * The selection is unchanged either way — a rule that consumed the key
       * and then declined to act on it leaves exactly the same store — so that
       * assertion cannot tell deference from a handler that took the key and
       * did nothing. Only one of those lets the dialog close, and stubbing the
       * deference away moved no result until this asserted the consumption.
       */
      expect(event.defaultPrevented).toBe(false);
      expect(editor.select).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });

  it("control: it DOES consume the key with no modal open", () => {
    // Without this, the case above passes against an editor that had stopped
    // claiming Escape at all — which is the defect, not the fix.
    const editor = editorSpy(pair(), "a");
    render(
      <ShortcutProvider>
        <BlockKeyboardActions editor={editor} />
      </ShortcutProvider>
    );

    expect(press("Escape").defaultPrevented).toBe(true);
  });

  it("holds the key from INSIDE a text field, where the inspector lives", () => {
    /*
     * The same data loss through a different door, and the one a reasonable
     * instinct opens. Escape normally "stays out of fields" — it is how a
     * combobox or an IME composition is dismissed — so declining it there looks
     * like good manners. It is not: declining releases the key to the entry
     * form's cancel, and the inspector an author types a block's name into is
     * full of fields. So the editor consumes it wherever focus is; what focus
     * changes is what the key DOES.
     */
    const editor = editorSpy(pair(), "a");
    const hostCancel = vi.fn();
    function HostBindings(): null {
      useShortcuts(
        [{ keys: "Escape", description: "Cancel", run: hostCancel }],
        { name: "test-entry-form" }
      );
      return null;
    }
    render(
      <ShortcutProvider>
        <HostBindings />
        <BlockKeyboardActions editor={editor} />
      </ShortcutProvider>
    );

    const field = window.document.createElement("input");
    field.type = "text";
    window.document.body.append(field);
    field.focus();
    try {
      // FROM the field, as a real keystroke arrives — see `press`.
      const event = press("Escape", {}, field);

      expect(hostCancel).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      // And it does NOT clear the selection out from under the field, which is
      // the half that makes consuming it acceptable rather than rude.
      expect(editor.select).not.toHaveBeenCalled();
    } finally {
      field.remove();
    }
  });

  it("control: the host's Escape DOES fire without the editor mounted", () => {
    /*
     * Without this, both cases above would pass against a harness whose host
     * layer never worked — which would prove nothing about the editor at all.
     */
    const hostCancel = vi.fn();
    function HostOnly(): null {
      useShortcuts(
        [{ keys: "Escape", description: "Cancel", run: hostCancel }],
        {
          name: "test-entry-form",
        }
      );
      return null;
    }
    render(
      <ShortcutProvider>
        <HostOnly />
      </ShortcutProvider>
    );

    press("Escape");

    expect(hostCancel).toHaveBeenCalled();
  });
});

describe("the document's history while the author is typing", () => {
  /**
   * A block's text is edited in an uncontrolled `contentEditable`, and the
   * shortcut manager reads "is the user typing" from the event's TARGET. So the
   * keystroke has to be dispatched there — dispatching on the document exercises
   * neither setting, which the `press` docblock above records as a mistake
   * already made once here.
   */
  // `ctrlKey`, matching every other case in this file: `mod` resolves to ctrl
  // in this environment, and a `metaKey` press matches NO binding here — so it
  // asserts nothing while looking like it asserts everything. The controls
  // below are what exposed that; the first version of these tests passed
  // against both settings of `whenTyping` for exactly that reason.
  function typingIn(): HTMLElement {
    const el = window.document.createElement("div");
    // jsdom implements NEITHER half of `contentEditable`: assigning the
    // property sets no attribute, and `isContentEditable` reads `undefined`.
    // Measured — a probe asserting both returned `{ attr: null, isCE: undefined }`.
    // So the element has to be told what it is, or it is not a typing target
    // and every assertion below passes against a canvas that never declines.
    el.setAttribute("contenteditable", "true");
    Object.defineProperty(el, "isContentEditable", {
      value: true,
      configurable: true,
    });
    window.document.body.appendChild(el);
    return el;
  }

  /**
   * The same rule, on an element jsdom DOES implement.
   *
   * A faked property proves the binding reads what it claims to; a real
   * `<textarea>` proves the manager agrees about what typing is. Neither alone
   * is convincing — the fake could be testing the fake.
   */
  function realTypingIn(): HTMLTextAreaElement {
    const el = window.document.createElement("textarea");
    window.document.body.appendChild(el);
    return el;
  }

  it("leaves mod+z to the element the caret is in", () => {
    const editor = editorSpy(pair(), "a");
    editor.canUndo = true;
    mount(editor);

    const event = press("z", { ctrlKey: true }, typingIn());

    // The DOCUMENT's history must not move: the author meant the words they
    // just typed, and rewinding a block move they had finished with takes away
    // something they were not asking about.
    expect(editor.undo).not.toHaveBeenCalled();
    // And the keystroke must reach the element, or the browser's own history
    // cannot serve the caret either — leaving the author with no undo at all,
    // which is worse than the wrong one.
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves mod+z to a real textarea too", () => {
    const editor = editorSpy(pair(), "a");
    editor.canUndo = true;
    mount(editor);

    press("z", { ctrlKey: true }, realTypingIn());

    expect(editor.undo).not.toHaveBeenCalled();
  });

  it("still owns mod+z when the caret is not in text", () => {
    // The CONTROL. Without it, a canvas whose undo never fires at all passes
    // the case above — and that is a different bug wearing the same green.
    const editor = editorSpy(pair(), "a");
    editor.canUndo = true;
    mount(editor);

    press("z", { ctrlKey: true });

    expect(editor.undo).toHaveBeenCalledTimes(1);
  });

  it("leaves both redo spellings to the element too", () => {
    const editor = editorSpy(pair(), "a");
    editor.canRedo = true;
    mount(editor);
    const field = typingIn();

    press("z", { ctrlKey: true, shiftKey: true }, field);
    press("y", { ctrlKey: true }, field);

    expect(editor.redo).not.toHaveBeenCalled();
  });

  it("still owns both redo spellings outside text", () => {
    const editor = editorSpy(pair(), "a");
    editor.canRedo = true;
    mount(editor);

    press("z", { ctrlKey: true, shiftKey: true });
    press("y", { ctrlKey: true });

    expect(editor.redo).toHaveBeenCalledTimes(2);
  });
});
