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
import type { NestingSource } from "@nextlyhq/blocks-engine";
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
import { HoveredBlockProvider, useHoveredBlockSetter } from "./hovered-block";
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
    lockRefusalFor: () => undefined,
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
function tree(
  editor: EditorState,
  props: { hidden?: boolean },
  nesting?: NestingSource
) {
  return (
    <ShortcutProvider>
      <BlockKeyboardActions
        onSaveAsPattern={() => undefined}
        editor={editor}
        {...(nesting === undefined ? {} : { nesting })}
      >
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

function mount(
  editor: EditorState,
  props: { hidden?: boolean } = {},
  nesting?: NestingSource
) {
  const result = render(tree(editor, props, nesting));
  return {
    ...result,
    /** Re-render with the selection moved, as a verb that changes it does. */
    reselect: (id: string) =>
      result.rerender(tree({ ...editor, selectedId: id }, props)),
  };
}

describe("BlockToolbar", () => {
  it("leaves the editor around its menu in the accessibility tree", () => {
    // A modal menu marks everything outside it aria-hidden while those
    // controls stay focusable (axe: aria-hidden-focus). Nothing is hidden.
    register();
    const editor = editorSpy(pair(), "a");
    // A host offering the component verbs, which are what "More" holds.
    render(
      <ShortcutProvider>
        <BlockKeyboardActions
          onSaveAsPattern={() => undefined}
          editor={editor}
          components={{
            mayCreate: true,
            onTurnIntoComponent: () => {},
          }}
        >
          <Canvas
            document={editor.document}
            siteStyles={{ css: "", classes: {} } as never}
            selectedId={editor.selectedId}
            onSelect={editor.select}
            overlay={<BlockToolbar editor={editor} />}
          />
        </BlockKeyboardActions>
      </ShortcutProvider>
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), {
      key: "Enter",
    });
    expect(screen.getByRole("menu")).toBeTruthy();

    expect(document.querySelector('[data-aria-hidden="true"]')).toBeNull();
  });

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

  it("says on the bar that the selected block is locked, or locked by the block around it", () => {
    register();
    mount(editorSpy(pair({ locked: true }), "a"));
    expect(document.querySelector("[data-lock-note]")?.textContent).toBe(
      "Locked"
    );
    cleanup();

    const inside = documentOf([
      {
        id: "hero",
        type: "acme/leaf",
        version: 1,
        props: {},
        locked: true,
        name: "Hero",
        slots: {
          children: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
        },
      } as BlockNode,
    ]);
    mount(editorSpy(inside, "a"));
    const note = document.querySelector("[data-lock-note]");
    expect(note?.textContent).toBe("Locked by Hero");
    // Text, not a control: the bar's one tab stop stays on its buttons.
    expect(note?.closest("button")).toBeNull();
    cleanup();

    // The control: nothing locks the block, so the bar says nothing.
    mount(editorSpy(pair(), "a"));
    expect(document.querySelector("[data-lock-note]")).toBeNull();
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
      "Leaf is locked."
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

  it("takes focus from anywhere in the editor on Alt+F10, at its tab stop", () => {
    // The editor convention for reaching a block's toolbar from the keyboard:
    // from the canvas, or from text being edited inside the block.
    mount(editorSpy(pair(), "a"));
    fireEvent.keyDown(document.body, { key: "F10", code: "F10", altKey: true });
    const stop = screen
      .getByRole("toolbar", { name: "Block actions" })
      .querySelector('[tabindex="0"]');
    expect(stop).not.toBeNull();
    expect(document.activeElement).toBe(stop);
  });

  it("leaves Alt+F10 to the browser in an editor drawing no toolbar", () => {
    // A host may render the keystrokes alone, and the bar is not drawn while
    // a block is dragged: with no bar to focus, the key is not taken.
    register();
    const editor = editorSpy(pair(), "a");
    render(
      <ShortcutProvider>
        <BlockKeyboardActions onSaveAsPattern={() => undefined} editor={editor}>
          <Canvas
            document={editor.document}
            siteStyles={{ css: "", classes: {} } as never}
            selectedId={editor.selectedId}
            onSelect={editor.select}
          />
        </BlockKeyboardActions>
      </ShortcutProvider>
    );
    const taken = !fireEvent.keyDown(document.body, {
      key: "F10",
      code: "F10",
      altKey: true,
    });
    expect(taken).toBe(false);
  });

  it("takes focus on Alt+F10 in ITS editor, with another editor on the page", () => {
    // Two editors in one document, as two blocks fields on one form give,
    // each listening for keys inside itself. The bar Alt+F10 reaches is the
    // one of the editor the key was pressed in, not the first in the page.
    function Scoped({ editor }: { editor: EditorState }) {
      const [scope, setScope] = React.useState<HTMLElement | null>(null);
      return (
        <div ref={setScope} data-testid="editor">
          {scope !== null && (
            <ShortcutProvider target={scope}>
              <BlockKeyboardActions
                onSaveAsPattern={() => undefined}
                editor={editor}
              >
                <Canvas
                  document={editor.document}
                  siteStyles={{ css: "", classes: {} } as never}
                  selectedId={editor.selectedId}
                  onSelect={editor.select}
                  overlay={<BlockToolbar editor={editor} />}
                />
              </BlockKeyboardActions>
            </ShortcutProvider>
          )}
        </div>
      );
    }
    register();
    render(
      <>
        <Scoped editor={editorSpy(pair(), "a")} />
        <Scoped editor={editorSpy(pair(), "b")} />
      </>
    );
    const second = screen.getAllByTestId("editor")[1];
    if (second === undefined) throw new Error("no second editor");
    fireEvent.keyDown(second, { key: "F10", code: "F10", altKey: true });
    const bar = second.querySelector('[role="toolbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.contains(document.activeElement)).toBe(true);
  });

  it("moves to the screen's top as a tall block is scrolled past its own", () => {
    // jsdom lays nothing out, so the boxes are given: a page in a scroller
    // showing 900px of it, and a 2000px block 100px down the page. Scrolling
    // moves the page under the scroller and changes nothing a render reports.
    let scrolled = 0;
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(0, 1000, 900);
        if (this.matches(".nx-canvas")) return box(-scrolled, 1000, 3000);
        if (this.matches('[data-nx-node="a"]'))
          return box(100 - scrolled, 1000, 2000);
        if (this.matches(".nx-block-toolbar")) return box(0, 200, 40);
        return box(0, 0, 0);
      });
    try {
      render(
        <div data-scroller="" style={{ overflowY: "auto" }}>
          {tree(editorSpy(pair(), "a"), {})}
        </div>
      );
      const bar = screen.getByRole("toolbar", { name: "Block actions" });
      expect(bar.getAttribute("data-side")).toBe("above");
      scrolled = 700;
      const scroller = document.querySelector("[data-scroller]");
      if (scroller === null) throw new Error("no scroller");
      fireEvent.scroll(scroller);
      expect(bar.getAttribute("data-side")).toBe("pinned");
    } finally {
      boxes.mockRestore();
    }
  });

  it("goes below the LAST part a placement draws, never over its content", () => {
    // A placement whose definition draws two elements, a headline and an
    // intro, each carrying the placement's address. Anchored to the first
    // alone, a bar flipped below sits over the intro's line.
    registerBlocks(
      [
        {
          name: "acme/two-parts",
          version: 1,
          description: "A block drawn as two parts.",
          example: { props: {} },
          editor: { label: "Two parts" },
          render: () =>
            React.createElement(
              React.Fragment,
              null,
              React.createElement("h2", {
                "data-nx-node": "card-title",
                "data-nx-instance": "card",
              }),
              React.createElement("p", {
                "data-nx-node": "card-intro",
                "data-nx-instance": "card",
              })
            ),
        },
      ] as never,
      { source: "block-toolbar-test" }
    );
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(0, 1000, 900);
        if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
        if (this.matches('[data-nx-node="card-title"]'))
          return box(10, 1000, 24);
        if (this.matches('[data-nx-node="card-intro"]'))
          return box(34, 1000, 24);
        if (this.matches(".nx-block-toolbar")) return box(0, 200, 40);
        return box(0, 0, 0);
      });
    try {
      const doc = documentOf([
        {
          id: "card",
          type: "acme/two-parts",
          version: 1,
          props: {},
        } as BlockNode,
      ]);
      render(
        <div data-scroller="" style={{ overflowY: "auto" }}>
          {tree(editorSpy(doc, "card"), {})}
        </div>
      );
      const bar = screen.getByRole("toolbar", { name: "Block actions" });
      // No room above a block 10px down, so below: under the intro's bottom
      // (34 + 24) and the 6px gap, not under the headline's.
      expect(bar.getAttribute("data-side")).toBe("below");
      expect(bar.style.top).toBe("64px");
    } finally {
      boxes.mockRestore();
    }
  });

  it("leaves out a placement's part hidden on this device, which draws nothing", () => {
    // The intro is `display: none` here: no box, and a zero rectangle at the
    // canvas origin. Counted, it would stretch the placement to the top of
    // the canvas and push the bar off its headline.
    registerBlocks(
      [
        {
          name: "acme/two-parts",
          version: 1,
          description: "A block drawn as two parts.",
          example: { props: {} },
          editor: { label: "Two parts" },
          render: () =>
            React.createElement(
              React.Fragment,
              null,
              React.createElement("h2", {
                "data-nx-node": "card-title",
                "data-nx-instance": "card",
              }),
              React.createElement("p", {
                "data-nx-node": "card-intro",
                "data-nx-instance": "card",
              })
            ),
        },
      ] as never,
      { source: "block-toolbar-test" }
    );
    const hidden = (element: Element) =>
      element.getAttribute("data-nx-node") === "card-intro";
    const rects = vi
      .spyOn(Element.prototype, "getClientRects")
      .mockImplementation(function (this: Element) {
        const list = hidden(this) ? [] : [new DOMRect()];
        return Object.assign(list, {
          item: (index: number) => list[index] ?? null,
        }) as unknown as DOMRectList;
      });
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(0, 1000, 900);
        if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
        if (this.matches('[data-nx-node="card-title"]'))
          return box(200, 1000, 24);
        if (this.matches(".nx-block-toolbar")) return box(0, 200, 40);
        return box(0, 0, 0);
      });
    try {
      const doc = documentOf([
        {
          id: "card",
          type: "acme/two-parts",
          version: 1,
          props: {},
        } as BlockNode,
      ]);
      render(
        <div data-scroller="" style={{ overflowY: "auto" }}>
          {tree(editorSpy(doc, "card"), {})}
        </div>
      );
      const bar = screen.getByRole("toolbar", { name: "Block actions" });
      // Above the headline it does draw: 200 - 40 - 6.
      expect(bar.getAttribute("data-side")).toBe("above");
      expect(bar.style.top).toBe("154px");
    } finally {
      boxes.mockRestore();
      rects.mockRestore();
    }
  });

  it("watches every part a placement draws for a change of size", () => {
    // An image or a webfont can resize a placement's later part alone; the
    // bar is placed against all of them, so each one is watched.
    registerBlocks(
      [
        {
          name: "acme/two-parts",
          version: 1,
          description: "A block drawn as two parts.",
          example: { props: {} },
          editor: { label: "Two parts" },
          render: () =>
            React.createElement(
              React.Fragment,
              null,
              React.createElement("h2", {
                "data-nx-node": "card-title",
                "data-nx-instance": "card",
              }),
              React.createElement("p", {
                "data-nx-node": "card-intro",
                "data-nx-instance": "card",
              })
            ),
        },
      ] as never,
      { source: "block-toolbar-test" }
    );
    const watched: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(element: Element) {
          watched.push(element);
        }
        disconnect() {}
        unobserve() {}
      }
    );
    try {
      const doc = documentOf([
        {
          id: "card",
          type: "acme/two-parts",
          version: 1,
          props: {},
        } as BlockNode,
      ]);
      render(tree(editorSpy(doc, "card"), {}));
      const names = watched.map(element =>
        element.getAttribute("data-nx-node")
      );
      expect(names).toContain("card-title");
      expect(names).toContain("card-intro");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("moves when the window resizes the part of the page on screen", () => {
    // A block 10px down a scroller: the bar goes below it while that fits on
    // screen, and to the screen's top once the window is too short for it.
    // Nothing the bar observes resizes: only the scroller's visible part.
    let shown = 900;
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(0, 1000, shown);
        if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
        if (this.matches('[data-nx-node="a"]')) return box(10, 1000, 100);
        if (this.matches(".nx-block-toolbar")) return box(0, 200, 40);
        return box(0, 0, 0);
      });
    try {
      render(
        <div data-scroller="" style={{ overflowY: "auto" }}>
          {tree(editorSpy(pair(), "a"), {})}
        </div>
      );
      const bar = screen.getByRole("toolbar", { name: "Block actions" });
      expect(bar.getAttribute("data-side")).toBe("below");
      shown = 150;
      fireEvent(window, new Event("resize"));
      expect(bar.getAttribute("data-side")).toBe("pinned");
    } finally {
      boxes.mockRestore();
    }
  });

  it("fades while the pointer is over another block, and not over its own", () => {
    // The bar sits over the block above the selection, so a hovered block
    // there would otherwise be covered by it. Faded rather than removed, so a
    // pointer heading for the bar still reaches its buttons.
    function PointAt({ id }: { id: string | null }) {
      const point = useHoveredBlockSetter();
      React.useEffect(() => point(id), [id, point]);
      return null;
    }
    const editor = editorSpy(pair(), "a");
    const { rerender } = render(
      <HoveredBlockProvider>
        <PointAt id="b" />
        {tree(editor, {})}
      </HoveredBlockProvider>
    );
    const bar = screen.getByRole("toolbar", { name: "Block actions" });
    expect(bar.hasAttribute("data-faded")).toBe(true);
    rerender(
      <HoveredBlockProvider>
        <PointAt id="a" />
        {tree(editor, {})}
      </HoveredBlockProvider>
    );
    expect(bar.hasAttribute("data-faded")).toBe(false);
  });

  it("keeps its height clear at the top of the scroller while it is drawn", () => {
    // `scroll-padding-top`, so a block scrolled or focused into view is not
    // left under the bar (WCAG 2.4.11): the bar's 40px and its 6px gap.
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(0, 1000, 900);
        if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
        if (this.matches('[data-nx-node="a"]')) return box(200, 1000, 100);
        if (this.matches(".nx-block-toolbar")) return box(0, 200, 40);
        return box(0, 0, 0);
      });
    try {
      const { unmount } = render(
        <div data-scroller="" style={{ overflowY: "auto" }}>
          {tree(editorSpy(pair(), "a"), {})}
        </div>
      );
      const scroller = document.querySelector<HTMLElement>("[data-scroller]");
      if (scroller === null) throw new Error("no scroller");
      expect(scroller.style.scrollPaddingTop).toBe("46px");
      unmount();
      expect(scroller.style.scrollPaddingTop).toBe("");
    } finally {
      boxes.mockRestore();
    }
  });

  it("keeps a larger clearance the scroller already had", () => {
    // A site keeping focused blocks below its sticky header sets its own
    // scroll-padding-top; the bar's 46px must not shrink it to the bar alone.
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(0, 1000, 900);
        if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
        if (this.matches('[data-nx-node="a"]')) return box(200, 1000, 100);
        if (this.matches(".nx-block-toolbar")) return box(0, 200, 40);
        return box(0, 0, 0);
      });
    try {
      render(
        <div
          data-scroller=""
          style={{ overflowY: "auto", scrollPaddingTop: "80px" }}
        >
          {tree(editorSpy(pair(), "a"), {})}
        </div>
      );
      const scroller = document.querySelector<HTMLElement>("[data-scroller]");
      if (scroller === null) throw new Error("no scroller");
      expect(scroller.style.scrollPaddingTop).toBe("80px");
    } finally {
      boxes.mockRestore();
    }
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

describe("the rules the bar judges a save by", () => {
  it("asks the HOST's nesting source, not the registry", () => {
    /*
     * A host may supply its own rules to `BlockKeyboardActions` instead of
     * registering them globally, and until this the keyboard enforced them
     * while the bar consulted the registry. One selection could then be offered
     * here and refused by the save it opens.
     *
     * The rules below forbid this block at a document root, which is what a
     * saved pattern's blocks become — so a bar reading them refuses the save,
     * and one reading the registry does not.
     */
    register();
    const rootIsForbidden: NestingSource = {
      parentsOf: type => (type === "acme/leaf" ? ["acme/box"] : undefined),
    };

    mount(editorSpy(pair(), "a"), {}, rootIsForbidden);

    // `aria-disabled`, not the attribute: this bar keeps an unavailable verb in
    // the tab sequence deliberately, so the reason is reachable. Asserting
    // `disabled` checks something this component never sets, and passes either
    // way — which is how the first version of this case read as green.
    const save = screen.getByLabelText("Save as pattern");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.getAttribute("title")).toContain("belongs inside");
  });

  it("judges a SET by the whole selection, not by the primary block", () => {
    /*
     * `a` and `c` share a parent with `b` between them. Asked about `a` alone
     * the selection looks perfectly savable — so a bar that passed only the
     * primary would offer a save the planner refuses, and the author would meet
     * the refusal after filling a form.
     *
     * This is the case a hook shared with the context menu exists to keep true
     * of both: it went uncaught while each surface asked the question itself.
     */
    register();
    const document = documentOf([
      { id: "a", type: "acme/leaf", version: 1, props: {} } as BlockNode,
      { id: "b", type: "acme/leaf", version: 1, props: {} } as BlockNode,
      { id: "c", type: "acme/leaf", version: 1, props: {} } as BlockNode,
    ]);
    const editor = {
      ...editorSpy(document, "a"),
      selection: { ids: ["a", "c"], primary: "a" },
    };

    mount(editor);

    const save = screen.getByLabelText("Save as pattern");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.getAttribute("title")).toContain("no gaps");
  });

  it("offers the save for a set that IS one run", () => {
    // The control for the case above: the same three blocks, selected without a
    // gap, are savable — so the refusal is the RULE talking rather than the bar
    // refusing every set.
    register();
    const document = documentOf([
      { id: "a", type: "acme/leaf", version: 1, props: {} } as BlockNode,
      { id: "b", type: "acme/leaf", version: 1, props: {} } as BlockNode,
      { id: "c", type: "acme/leaf", version: 1, props: {} } as BlockNode,
    ]);
    const editor = {
      ...editorSpy(document, "a"),
      selection: { ids: ["a", "b"], primary: "a" },
    };

    mount(editor);

    expect(
      screen.getByLabelText("Save as pattern").getAttribute("aria-disabled")
    ).toBeNull();
  });

  it("offers the save under the registry's own rules", () => {
    // The control, and the reason the case above is about the SOURCE rather
    // than about saving being broken: the same selection, with nothing
    // supplied, is savable.
    register();

    mount(editorSpy(pair(), "a"));

    const save = screen.getByLabelText("Save as pattern");
    expect(save.getAttribute("aria-disabled")).toBeNull();
    expect(save.getAttribute("title")).toBe("Save as pattern");
  });
});
