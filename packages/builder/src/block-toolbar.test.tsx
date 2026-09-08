// @vitest-environment jsdom

/**
 * The toolbar's wiring, which is the half `toolbar-actions.test.ts` cannot see.
 *
 * That file already decides which buttons appear and whether each is available.
 * What is only true HERE is that a press reaches the same verb a keystroke
 * reaches, that the bar is reachable from a keyboard, and — the case this
 * component is most likely to break — that pressing a button does not clear the
 * selection it acts on.
 *
 * **That last one is a REGRESSION class, not a hypothetical.** The canvas
 * treats a click that resolves to no block as a click on the background and
 * clears the selection, and the bar is rendered inside the canvas root. The
 * first version of the drag layer broke click-to-select in exactly this shape
 * and shipped, so the case is asserted against a real `Canvas` rather than
 * against a stub that could not exhibit it.
 *
 * @module block-toolbar.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { BlockToolbar } from "./block-toolbar";
import { Canvas } from "./canvas";
import type { EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";
import { toolbarActions } from "./toolbar-actions";

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
    { source: "block-toolbar-test" }
  );
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** Two blocks, so `up` and `down` each have a case that is available. */
function pair(extra: Partial<BlockNode> = {}): BlockDocument {
  return documentOf([
    {
      id: "a",
      type: "acme/leaf",
      version: 1,
      props: {},
      ...extra,
    } as BlockNode,
    { id: "b", type: "acme/leaf", version: 1, props: {} } as BlockNode,
  ]);
}

function editorSpy(
  doc: BlockDocument,
  selectedId: string | null
): EditorState & {
  apply: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
} {
  return {
    document: doc,
    selectedId,
    // The set the structural verbs read. Derived from the primary so every case
    // here keeps describing one selected block, which is what they assert.
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
  } as unknown as EditorState & {
    apply: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
}

/**
 * The bar in the composition a host actually renders.
 *
 * A real `Canvas`, not a bare div. The bar measures against the SELECTED
 * BLOCK'S element and hides itself when it cannot find one, so a harness
 * without rendered blocks tests a permanently hidden toolbar — which is how the
 * first draft of these cases came back unable to find a single button.
 */
function tree(editor: EditorState, props: { hidden?: boolean }) {
  return (
    <ShortcutProvider>
      <BlockKeyboardActions onSaveAsPattern={() => undefined} editor={editor}>
        <Canvas
          document={editor.document}
          siteStyles={{ css: "", classes: {} } as never}
          selectedId={editor.selectedId}
          onSelect={editor.select}
          overlay={<BlockToolbar editor={editor} {...props} />}
        />
      </BlockKeyboardActions>
    </ShortcutProvider>
  );
}

function mount(editor: EditorState, props: { hidden?: boolean } = {}) {
  const result = render(tree(editor, props));
  return {
    ...result,
    /** Re-render with the selection moved, as a verb that changes it does. */
    reselect: (id: string) =>
      result.rerender(tree({ ...editor, selectedId: id }, props)),
  };
}

describe("BlockToolbar", () => {
  it("draws nothing with no selection", () => {
    register();
    mount(editorSpy(pair(), null));

    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("draws nothing while the host says a gesture is in flight", () => {
    // A bar drawn during a drag sits over the canvas the author is aiming at,
    // and names a block that is in the middle of moving.
    register();
    mount(editorSpy(pair(), "a"), { hidden: true });

    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("names every verb the model offers, in its order", () => {
    // Derived from `toolbarActions` rather than listed, so a verb added to the
    // model is asserted here the day it arrives. A literal list passes forever
    // while the bar grows a button nobody checks — and this component's whole
    // job is to draw what that function decided.
    register();
    const editor = editorSpy(pair(), "a");
    mount(editor);

    const expected = toolbarActions(
      editor.document,
      editor.selectedId,
      editor.selection.ids
    ).map(action => action.label);

    // The control: an empty model would make the comparison vacuous.
    expect(expected.length).toBeGreaterThan(1);
    expect(
      screen.getAllByRole("button").map(b => b.getAttribute("aria-label"))
    ).toEqual(expected);
  });

  it("presses the SAME verb the keystroke presses", () => {
    // Through `editor.apply` with the op duplicate produces, rather than
    // through an op this component composed. A toolbar that built its own would
    // pass a test asserting only that something was applied.
    register();
    const editor = editorSpy(pair(), "a");
    mount(editor);

    fireEvent.click(screen.getByLabelText("Duplicate"));

    // A group, because the verbs plan across the selection and one block is a
    // selection of one.
    expect(editor.applyAll).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "insert", at: { index: 1 } }),
    ]);
    // Selection follows the copy, which is the keyboard duplicate's behaviour
    // and therefore has to be this one's.
    expect(editor.select).toHaveBeenCalled();
  });

  it("presses DELETE only for Delete", () => {
    // The dispatch used to be a chain whose last arm was `delete`, so a verb
    // added to the union and not wired reached that arm: the compiler pointed
    // at the missing ICON, a developer supplied one, and the new button then
    // deleted the block. Asserted per verb rather than on the union, because
    // what went wrong was one verb answering for another.
    register();
    // DERIVED from what the bar actually renders, not a list written here. A
    // fixed list covers the verbs that existed when it was written, so the next
    // verb — the very thing this guards — would never be clicked by it, and the
    // other expectations could be updated around a button that silently
    // deletes.
    mount(editorSpy(pair(), "a"));
    const offered = screen
      .getAllByRole("button")
      .map(button => button.getAttribute("aria-label") ?? "")
      .filter(label => label !== "Delete");
    cleanup();
    // The bar really did offer something, so an empty loop cannot pass this.
    expect(offered.length).toBeGreaterThan(0);

    for (const label of offered) {
      const editor = editorSpy(pair(), "a");
      mount(editor);
      fireEvent.click(screen.getByLabelText(label));
      const written = [
        ...vi.mocked(editor.apply).mock.calls.map(([op]) => op),
        ...vi.mocked(editor.applyAll).mock.calls.flatMap(([ops]) => [...ops]),
      ];
      expect(
        JSON.stringify(written),
        `${label} must not remove anything`
      ).not.toContain("remove");
      cleanup();
    }

    // The control: Delete really does remove, so the assertion above is about
    // which verb ran and not about a bar that does nothing at all.
    const editor = editorSpy(pair(), "a");
    mount(editor);
    fireEvent.click(screen.getByLabelText("Delete"));
    const ops = [
      ...vi.mocked(editor.apply).mock.calls.map(([op]) => op),
      ...vi.mocked(editor.applyAll).mock.calls.flatMap(([list]) => [...list]),
    ];
    expect(JSON.stringify(ops)).toContain("remove");
  });

  it("moves the selection down through the store", () => {
    register();
    const editor = editorSpy(pair(), "a");
    mount(editor);

    fireEvent.click(screen.getByLabelText("Move down"));

    expect(editor.apply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "move", id: "a" })
    );
  });

  it("passes a dimmed press to the verb, which refuses it and says why", () => {
    /*
     * The bar deliberately does not guard the press itself. Every verb already
     * refuses what it cannot do, and a lock refusal ANNOUNCES — so a dimmed
     * Delete pressed by a keyboard author explains itself instead of doing
     * nothing. A guard in the bar would swallow exactly that sentence.
     *
     * Both halves are asserted. "Nothing was applied" alone would pass against
     * a bar that ignored the press entirely, which is the design this one
     * rejected.
     */
    register();
    const editor = editorSpy(pair({ locked: true }), "a");
    mount(editor);

    fireEvent.click(screen.getByLabelText("Delete"));

    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "Leaf is locked. Unlock it to delete it."
    );
  });

  it("keeps an unavailable button FOCUSABLE, and says why", () => {
    // The reason is the information. `disabled` would take the button out of
    // the tab sequence and take the reason with it, so the author most in need
    // of the sentence is the one who would never receive it.
    register();
    const editor = editorSpy(pair({ locked: true }), "a");
    mount(editor);

    const remove = screen.getByLabelText("Delete");
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(remove.hasAttribute("disabled")).toBe(false);

    const describedBy = remove.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "This block is locked."
    );
  });

  it("is ONE tab stop, with arrows moving inside it", () => {
    // The WAI-ARIA toolbar pattern. Five separate tab stops would put four
    // extra presses between the canvas and whatever follows it.
    register();
    mount(editorSpy(pair(), "a"));

    const buttons = screen.getAllByRole("button");
    // One stop, and every other button out of the tab order — stated as a shape
    // rather than a fixed-length list, so it still describes the rule when the
    // bar gains a verb.
    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons.map(b => b.getAttribute("tabindex"))).toEqual([
      "0",
      ...buttons.slice(1).map(() => "-1"),
    ]);

    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);

    // Wrapping, so the last verb is one press from the first rather than a walk
    // back along the bar.
    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(buttons.at(-1));
  });

  it("keeps the roving stop where FOCUS is when the selection moves", () => {
    /*
     * Duplicate and Select parent both change the selection while the author's
     * focus is still on the button they pressed. Resetting the stop to 0 there
     * would put the roving index and the caret on different buttons, and the
     * next arrow press would jump backwards from where the author is looking.
     */
    register();
    const editor = editorSpy(pair(), "a");
    const { reselect } = mount(editor);
    const buttons = screen.getAllByRole("button");

    buttons[3]?.focus(); // Duplicate
    reselect("b"); // as duplicating does: selection follows the copy

    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "ArrowRight" });

    // The button AFTER the focused one — not the second button, which is where
    // a stop reset to 0 would have sent it. Named by position rather than by
    // verb, because which verb sits there is the bar's business.
    expect(document.activeElement).toBe(buttons[4]);
  });

  it("DOES reset the stop when focus is outside the bar", () => {
    // The control. Without it the case above passes against a bar that never
    // reset the stop at all, which would strand it on a button belonging to a
    // block the author has moved on from.
    register();
    const editor = editorSpy(pair(), "a");
    const { reselect } = mount(editor);
    const buttons = screen.getAllByRole("button");

    buttons[3]?.focus();
    (window.document.activeElement as HTMLElement | null)?.blur();
    reselect("b");

    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "ArrowRight" });

    expect(document.activeElement).toBe(buttons[1]);
  });

  it("refuses to render without the verbs above it", () => {
    // Loudly. A toolbar that rendered its buttons and did nothing on every
    // press looks like a broken editor rather than a missing wrapper, and it
    // would reach a person before it reached a developer.
    register();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        render(<BlockToolbar editor={editorSpy(pair(), "a")} />)
      ).toThrow(/BlockKeyboardActions/);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("a press on the toolbar and the canvas's own click handling", () => {
  it("does NOT clear the selection the bar acts on", () => {
    /*
     * Against a real `Canvas`, because the fault lives in the interaction
     * between the two: the canvas reads a click that resolves to no block as a
     * click on the background and clears the selection, and the bar is rendered
     * INSIDE the canvas root. A stubbed canvas cannot exhibit it, and the
     * equivalent defect shipped once already in the drag layer.
     */
    register();
    const editor = editorSpy(pair(), "a");
    mount(editor);

    fireEvent.click(screen.getByLabelText("Duplicate"));

    // `select` IS called — duplicate moves the selection to the copy — so the
    // assertion is that it was never called with null, which is the value a
    // background click sends.
    expect(editor.select).not.toHaveBeenCalledWith(null);
  });

  it("still clears the selection for a click on the page background", () => {
    // The control. Without it the case above passes against a canvas that had
    // stopped clearing the selection at all, which would be a different bug
    // with the same green.
    register();
    const editor = editorSpy(pair(), "a");
    const { container } = mount(editor);

    const root = container.querySelector(".nx-canvas");
    if (root === null) throw new Error("expected a canvas root");
    fireEvent.click(root);

    // With the gesture, which the canvas now reports alongside the id: a plain
    // click on background is a "replace" with nothing to replace it with.
    expect(editor.select).toHaveBeenCalledWith(null, "replace");
  });
});
