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
    select: vi.fn(),
    apply: vi.fn(() => doc),
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
function mount(editor: EditorState, props: { hidden?: boolean } = {}) {
  return render(
    <ShortcutProvider>
      <BlockKeyboardActions editor={editor}>
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

  it("offers the five verbs, named", () => {
    register();
    mount(editorSpy(pair(), "a"));

    expect(
      screen.getAllByRole("button").map(b => b.getAttribute("aria-label"))
    ).toEqual(["Select parent", "Move up", "Move down", "Duplicate", "Delete"]);
  });

  it("presses the SAME verb the keystroke presses", () => {
    // Through `editor.apply` with the op duplicate produces, rather than
    // through an op this component composed. A toolbar that built its own would
    // pass a test asserting only that something was applied.
    register();
    const editor = editorSpy(pair(), "a");
    mount(editor);

    fireEvent.click(screen.getByLabelText("Duplicate"));

    expect(editor.apply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "insert", at: { index: 1 } })
    );
    // Selection follows the copy, which is the keyboard duplicate's behaviour
    // and therefore has to be this one's.
    expect(editor.select).toHaveBeenCalled();
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

    expect(editor.apply).not.toHaveBeenCalled();
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
    expect(buttons.map(b => b.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
      "-1",
      "-1",
    ]);

    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);

    // Wrapping, so Delete is one press from Select parent rather than four.
    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("toolbar"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(buttons[4]);
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

    expect(editor.select).toHaveBeenCalledWith(null);
  });
});
