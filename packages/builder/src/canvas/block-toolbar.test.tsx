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
import {
  COMPONENT_INSTANCE_TYPE,
  type NestingSource,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

import { coreBlocks } from "@nextlyhq/blocks-react/blocks";

import { BlockToolbar } from "./block-toolbar";
import { Canvas } from "./canvas";
import { useEditorState, type EditorState } from "../editor-state";
import { HoveredBlockProvider, useHoveredBlockSetter } from "./hovered-block";
import { BlockKeyboardActions } from "../keyboard-actions";
import { toolbarActions } from "./toolbar-actions";
import { EDITING_ATTRIBUTE } from "./use-inline-text";
import { VisitorUnreadableBadges } from "../visitor-unreadable-badges";

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
    // Nothing composed around the page: its own tree is all there is.
    composed: () => undefined,
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

/**
 * A button of an unmeasured bar by its name: its label, or else its text. The
 * bar is out of sight until measured, and no accessible name is computed for
 * what is out of sight.
 */
function unseenButton(name: string): HTMLButtonElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".nx-block-toolbar button"
      ),
    ].find(
      button =>
        (button.getAttribute("aria-label") ?? button.textContent?.trim()) ===
        name
    ) ?? null
  );
}

/**
 * The boxes of a page whose first block, `top`, is at the very top of a
 * 900px screen and 60px tall, so its bar is drawn inside it.
 */
function topBlockBoxes(top = "a") {
  return vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      const box = (y: number, width: number, height: number) =>
        new DOMRect(0, y, width, height);
      if (this.matches("[data-scroller]")) return box(0, 1000, 900);
      if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
      if (this.matches(`[data-nx-node="${top}"]`)) return box(0, 1000, 60);
      if (this.matches(".nx-block-toolbar")) return box(0, 200, 40);
      return box(0, 0, 0);
    });
}

/** A block's element, marked as the text being typed into. */
function typedText(id: string): HTMLElement {
  const text = document.querySelector(`[data-nx-node="${id}"]`);
  if (!(text instanceof HTMLElement)) throw new Error(`no block ${id}`);
  text.setAttribute(EDITING_ATTRIBUTE, "text");
  return text;
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

    const offered = toolbarActions(
      editor.document,
      editor.selectedId,
      editor.selection.ids
    );
    // The verbs kept in the menu sit behind one "More actions" button, which
    // comes last; the rest are buttons of their own, in the model's order.
    const expected = [
      ...offered
        .filter(action => action.inMenu !== true)
        .map(action => action.label),
      ...(offered.some(action => action.inMenu === true)
        ? ["More actions"]
        : []),
    ];

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

  it("offers Unlock on a block locked in Layers, which unlocks it as one edit", () => {
    register();
    const editor = editorSpy(pair({ locked: true }), "a");
    mount(editor);

    const bar = screen.getByRole("toolbar", { name: "Block actions" });
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(bar.contains(unlock)).toBe(true);
    expect(unlock.textContent).toBe("Unlock");
    // Unlock replaces the note: no plain "Locked" beside it.
    expect(bar.textContent).not.toContain("Locked");
    // One stop of the bar's roving set, the first: the lock is what an author
    // meets first on a locked block.
    expect(unlock.getAttribute("tabindex")).toBe("0");

    fireEvent.click(unlock);
    // The very op Layers' padlock applies, through the store's one apply, so
    // undo puts the lock back.
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["locked"],
    });
    cleanup();

    // The control: nothing locks the block, so the bar offers no Unlock.
    mount(editorSpy(pair(), "a"));
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
    expect(
      screen.getByRole("toolbar", { name: "Block actions" }).textContent
    ).not.toContain("Locked");
  });

  it("keeps a keyboard author in the bar after Unlock, on its new first stop", async () => {
    register();
    const editor = editorSpy(pair({ locked: true }), "a");
    const { rerender } = render(tree(editor, {}));
    const unlock = screen.getByRole("button", { name: "Unlock" });
    unlock.focus();
    // Arrows move across the lock as across any stop.
    fireEvent.keyDown(unlock, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Select parent" })
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Home",
    });
    expect(document.activeElement).toBe(unlock);

    fireEvent.click(unlock);
    // The store's answer: the block, unlocked, drawn again.
    rerender(tree({ ...editor, document: pair() }, {}));
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
    const bar = screen.getByRole("toolbar", { name: "Block actions" });
    await waitFor(() =>
      expect(document.activeElement).toBe(bar.querySelector('[tabindex="0"]'))
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Select parent" })
    );
  });

  it("keeps the bar's tab stop when it loses a stop under the last one", () => {
    // The stop on the last button, then the lock lifted elsewhere (Layers):
    // one stop fewer, and the bar still holds exactly one tab stop.
    register();
    const editor = editorSpy(pair({ locked: true }), "a");
    const { rerender } = render(tree(editor, {}));
    const bar = screen.getByRole("toolbar", { name: "Block actions" });
    const first = bar.querySelector<HTMLElement>('[tabindex="0"]');
    first?.focus();
    fireEvent.keyDown(first ?? bar, { key: "End" });
    (document.activeElement as HTMLElement | null)?.blur();

    rerender(tree({ ...editor, document: pair() }, {}));
    expect(bar.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("says Locked, with the reason, where the author may not lift the lock", () => {
    const HELD =
      "This area of Frame is locked to its content. Leaf's design and settings can't change here.";
    // A block locked in Layers inside a contentOnly area: the area pins the
    // block's own lock with its design, so the save would refuse an unlock.
    register();
    registerBlocks(
      [
        {
          name: "acme/frame",
          version: 1,
          description: "A frame whose children keep their design.",
          example: { props: {} },
          editor: { label: "Frame" },
          props: {},
          slots: {
            children: {
              lock: "contentOnly",
              defaultBlock: [{ type: "acme/leaf" }],
            },
          },
          render: () => null,
        },
      ] as never,
      { source: "block-toolbar-test" }
    );
    const held = documentOf([
      {
        id: "frame",
        type: "acme/frame",
        version: 1,
        props: {},
        slots: {
          children: [
            {
              id: "a",
              type: "acme/leaf",
              version: 1,
              props: {},
              locked: true,
            },
          ],
        },
      } as BlockNode,
    ]);
    const editor = editorSpy(held, "a");
    mount(editor);
    // The frame draws no children here, so the bar is mounted unmeasured, out
    // of sight, where a name is not computed: its buttons found by name here.

    expect(unseenButton("Unlock")).toBeNull();
    const locked = unseenButton("Locked");
    if (locked === null) throw new Error("no Locked button");
    // Dimmed but reachable, as the bar's other unavailable verbs, so the
    // reason reaches a keyboard author as well as a pointer.
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    expect(locked.getAttribute("title")).toBe(HELD);
    const describedBy = locked.getAttribute("aria-describedby");
    expect(
      describedBy === null ? null : document.getElementById(describedBy)
    ).toHaveProperty("textContent", HELD);
    fireEvent.click(locked);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  /**
   * A block in the slot a placed component exposes, which the component's
   * definition locks to its content. The page alone doesn't show the lock;
   * the page composed with its placement does, so the bar reads the editor's
   * composed view.
   */
  it("says Locked, with the reason, where a placed component's locked slot holds the block, and offers no Unlock", () => {
    register();
    if (!hasBlock("acme/promo")) {
      registerBlocks(
        [
          {
            name: "acme/promo",
            version: 1,
            description: "A promo, its exposed slot locked to its content.",
            example: { props: {} },
            editor: { label: "Promo" },
            props: {},
            slots: { content: { lock: "contentOnly" } },
            render: () => null,
          },
        ] as never,
        { source: "block-toolbar-test" }
      );
    }
    const page = pair({ locked: true });
    const composed = documentOf([
      {
        id: "promo",
        type: "acme/promo",
        version: 1,
        props: {},
        slots: { content: page.nodes },
      } as BlockNode,
    ]);
    const editor = Object.assign(editorSpy(page, "a"), {
      composed: () => composed,
    });
    mount(editor);

    expect(unseenButton("Unlock")).toBeNull();
    const locked = unseenButton("Locked");
    if (locked === null) throw new Error("no Locked button");
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    // The reason names the block that holds the area.
    expect(locked.getAttribute("title")).toContain("Promo");
    fireEvent.click(locked);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  /**
   * A block the page puts in the slot a placed component exposes, inside a
   * node the component locks in Layers. The real editor composes the page
   * with the component, so the lock is the one a save would hold the block
   * to; the page may lift only its own lock, which leaves the block held.
   */
  function ComponentLockedPage({ lockedOnPage }: { lockedOnPage: boolean }) {
    if (!hasBlock("acme/box")) {
      registerBlocks(
        [
          {
            name: "acme/box",
            version: 1,
            description: "A box holding blocks.",
            example: { props: {} },
            editor: { label: "Box" },
            props: {},
            slots: { children: {} },
            render: () => null,
          },
        ] as never,
        { source: "block-toolbar-test" }
      );
    }
    const promo = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "hero",
          type: "acme/box",
          version: 1,
          props: {},
          locked: true,
          name: "Hero",
          slots: { children: [] },
        },
      ],
      slots: { body: { label: "Body", nodeId: "hero", slot: "children" } },
    } as unknown as BlockDocument;
    const given = {
      id: "given",
      type: "acme/leaf",
      version: 1,
      props: {},
      ...(lockedOnPage ? { locked: true } : {}),
    } as BlockNode;
    const editor = useEditorState({
      initialDocument: documentOf([
        {
          id: "i1",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "promo" },
          slots: { body: [given] },
        } as BlockNode,
      ]),
      definitions: new Map([["promo", promo]]),
      componentName: id => (id === "promo" ? "Promo" : undefined),
    });
    return tree(
      {
        ...editor,
        selectedId: "given",
        selection: { ids: ["given"], primary: "given" },
      } as EditorState,
      {}
    );
  }

  it.each([
    ["locked on the page too", true],
    ["not locked on the page", false],
  ])(
    "says Locked, by the component, where a placed component locks the block in Layers (%s), and offers no Unlock",
    (_how, lockedOnPage) => {
      register();
      render(<ComponentLockedPage lockedOnPage={lockedOnPage} />);

      expect(unseenButton("Unlock")).toBeNull();
      const locked = unseenButton("Locked");
      if (locked === null) throw new Error("no Locked button");
      expect(locked.getAttribute("aria-disabled")).toBe("true");
      expect(locked.getAttribute("title")).toBe(
        "Set by its component. Change it where the component is edited."
      );
    }
  );

  it("composes nothing to select a block outside any placed component", () => {
    // Selection stays free of the composition: only a block inside a
    // placement can be held by its component's lock.
    register();
    const composed = vi.fn(() => undefined);
    mount(Object.assign(editorSpy(pair(), "a"), { composed }));

    expect(composed).not.toHaveBeenCalled();
  });

  it("says Locked by the block around it, with Select it and no Unlock", () => {
    register();
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
    const editor = editorSpy(inside, "a");
    mount(editor);
    // Hero draws no children here, so the bar is mounted unmeasured, out of
    // sight, where a name is not computed: its buttons found by name here.
    const note = document.querySelector(
      '[role="toolbar"][aria-label="Block actions"] [data-lock-note]'
    );
    expect(note?.textContent).toBe("Locked by Hero · Select it");
    // The toolbar's Unlock is for the block's own lock only; Hero's is lifted
    // on Hero.
    expect(unseenButton("Unlock")).toBeNull();
    const choose = unseenButton("Select it");
    if (choose === null) throw new Error("no Select it button");
    expect(note?.contains(choose)).toBe(true);

    fireEvent.click(choose);
    expect(editor.select).toHaveBeenCalledWith("hero");
    expect(editor.apply).not.toHaveBeenCalled();
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

  it("keeps the selected block's visitor badge out from under the bar: the badge goes on its outline's bottom edge", () => {
    // A 300px by 40px block 200px down a 500px screen, read by a field
    // visitors can't read. Selected, the 200px by 30px bar sits 6px above it
    // (164px to 194px, from the block's left edge), over where its badge
    // would sit above its outline (177px to 199px, leftwards from its right
    // edge). The bar keeps its place, and the badge takes its outline's
    // bottom edge: 198px + 44px, less the 1px foot. CONTROL: unselected, no
    // bar is drawn and the badge keeps the top edge.
    register();
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        if (this.matches("[data-scroller]"))
          return new DOMRect(0, 0, 1000, 500);
        if (this.matches(".nx-canvas")) return new DOMRect(0, 0, 1000, 2000);
        if (this.matches('[data-nx-node="a"]')) {
          return new DOMRect(0, 200, 300, 40);
        }
        if (this.matches(".nx-block-toolbar")) {
          return new DOMRect(0, 0, 200, 30);
        }
        if (this.matches(".nx-visitor-unreadable__badge")) {
          return new DOMRect(0, 0, 150, 22);
        }
        // The canvas's size for everything else: a block's ancestors are
        // asked whether they clip it, and an empty box would.
        return new DOMRect(0, 0, 1000, 2000);
      });
    const marked = new Map([
      ["a", [{ prop: "text", path: "internalNote" }] as const],
    ]);
    const drawn = (selectedId: string | null) => {
      const editor = editorSpy(pair(), selectedId);
      return (
        <div data-scroller="" style={{ overflowY: "auto" }}>
          <ShortcutProvider>
            <BlockKeyboardActions
              onSaveAsPattern={() => undefined}
              editor={editor}
            >
              <Canvas
                document={editor.document}
                siteStyles={{ css: "", classes: {} } as never}
                selectedId={editor.selectedId}
                onSelect={editor.select}
                overlay={
                  // As the host draws them: the badges, then the bar.
                  <>
                    <VisitorUnreadableBadges marked={marked} />
                    <BlockToolbar editor={editor} />
                  </>
                }
              />
            </BlockKeyboardActions>
          </ShortcutProvider>
        </div>
      );
    };
    const badge = () =>
      document.querySelector<HTMLElement>(".nx-visitor-unreadable__badge");
    try {
      render(drawn("a"));
      expect(
        screen
          .getByRole("toolbar", { name: "Block actions" })
          .getAttribute("data-side")
      ).toBe("above");
      expect(badge()?.style.top).toBe("241px");
      expect(badge()?.hasAttribute("data-below")).toBe(true);
      cleanup();
      render(drawn(null));
      expect(screen.queryByRole("toolbar", { name: "Block actions" })).toBe(
        null
      );
      expect(badge()?.style.top).toBe("177px");
      expect(badge()?.hasAttribute("data-below")).toBe(false);
    } finally {
      boxes.mockRestore();
    }
  });

  it("goes inside a placement's top-left corner, never under its last part", () => {
    // A placement whose definition draws two elements, a headline and an
    // intro, each carrying the placement's address. With no room above, the
    // bar is drawn inside the placement's corner, not under its intro, where
    // the next block would be.
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
      // No room above a block 10px down, so inside its corner, 4px in.
      expect(bar.getAttribute("data-side")).toBe("inside");
      expect(bar.style.top).toBe("14px");
      expect(bar.style.left).toBe("4px");
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
    // A block 100px down a scroller: the bar goes above it while the screen
    // starts at the page's top, and inside it once the part of the page on
    // screen starts below the room above it. Nothing the bar observes
    // resizes: only the scroller's visible part.
    let top = 0;
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(top, 1000, 900);
        if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
        if (this.matches('[data-nx-node="a"]')) return box(100, 1000, 100);
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
      top = 80;
      fireEvent(window, new Event("resize"));
      expect(bar.getAttribute("data-side")).toBe("inside");
    } finally {
      boxes.mockRestore();
    }
  });

  it("steps aside while the author types in a block whose bar is inside it, until the pointer moves", async () => {
    // A block at the very top: its bar is drawn inside it, over its first
    // line, so typing there hides it; a pointer move brings it back.
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(0, 1000, 900);
        if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
        if (this.matches('[data-nx-node="a"]')) return box(0, 1000, 60);
        if (this.matches('[data-nx-node="b"]')) return box(60, 1000, 60);
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
      expect(bar.getAttribute("data-side")).toBe("inside");
      // Stepped aside is `data-typing`, which the stylesheet draws
      // transparent and lets presses through.
      const aside = () => bar.hasAttribute("data-typing");
      expect(aside()).toBe(false);

      // Typing in the block's own text, as inline editing marks it.
      const text = document.querySelector('[data-nx-node="a"]');
      if (!(text instanceof HTMLElement)) throw new Error("no block a");
      text.setAttribute(EDITING_ATTRIBUTE, "text");
      fireEvent.keyDown(text, { key: "h" });
      expect(aside()).toBe(true);

      fireEvent.pointerMove(document);
      expect(aside()).toBe(false);

      // Typing again, then the editing ends: back without a pointer move.
      fireEvent.keyDown(text, { key: "i" });
      expect(aside()).toBe(true);
      text.removeAttribute(EDITING_ATTRIBUTE);
      await waitFor(() => expect(aside()).toBe(false));

      // The controls: a key pressed outside the text being edited, and a
      // shortcut or a key that writes nothing pressed in it, are not typing.
      fireEvent.keyDown(document.body, { key: "j" });
      text.setAttribute(EDITING_ATTRIBUTE, "text");
      fireEvent.keyDown(text, { key: "z", metaKey: true });
      fireEvent.keyDown(text, { key: "ArrowLeft" });
      fireEvent.keyDown(text, { key: "Shift" });
      expect(aside()).toBe(false);
      // And a key that does write still counts, held with Shift.
      fireEvent.keyDown(text, { key: "H", shiftKey: true });
      expect(aside()).toBe(true);
    } finally {
      boxes.mockRestore();
    }
  });

  it("comes back when Alt+F10 takes focus to it from the text being typed", () => {
    // The keyboard route to the bar while editing: a stepped-aside bar is
    // transparent, not hidden, so it can take focus, and focus brings it back.
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(0, 1000, 900);
        if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
        if (this.matches('[data-nx-node="a"]')) return box(0, 1000, 60);
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
      const text = document.querySelector('[data-nx-node="a"]');
      if (!(text instanceof HTMLElement)) throw new Error("no block a");
      text.setAttribute(EDITING_ATTRIBUTE, "text");
      fireEvent.keyDown(text, { key: "h" });
      expect(bar.hasAttribute("data-typing")).toBe(true);

      fireEvent.keyDown(text, { key: "F10", code: "F10", altKey: true });
      expect(bar.contains(document.activeElement)).toBe(true);
      expect(bar.hasAttribute("data-typing")).toBe(false);
    } finally {
      boxes.mockRestore();
    }
  });

  it("steps aside for text an input method or a software keyboard puts in", () => {
    // Composition sends keydown as "Process" (or none at all), then the text
    // as input: the input is what counts.
    const boxes = topBlockBoxes();
    try {
      render(
        <div data-scroller="" style={{ overflowY: "auto" }}>
          {tree(editorSpy(pair(), "a"), {})}
        </div>
      );
      const bar = screen.getByRole("toolbar", { name: "Block actions" });
      const text = typedText("a");
      fireEvent.keyDown(text, { key: "Process" });
      expect(bar.hasAttribute("data-typing")).toBe(false);
      fireEvent(
        text,
        new InputEvent("beforeinput", {
          bubbles: true,
          inputType: "insertCompositionText",
          data: "日",
        })
      );
      expect(bar.hasAttribute("data-typing")).toBe(true);
    } finally {
      boxes.mockRestore();
    }
  });

  it("steps aside again after a drag has hidden and redrawn the bar", () => {
    // A drag unmounts the bar's element and draws a new one after; the
    // selection, the side and the document stay as they were.
    const boxes = topBlockBoxes();
    try {
      const editor = editorSpy(pair(), "a");
      const shown = (hidden: boolean) => (
        <div data-scroller="" style={{ overflowY: "auto" }}>
          {tree(editor, { hidden })}
        </div>
      );
      const { rerender } = render(shown(false));
      rerender(shown(true));
      rerender(shown(false));
      const bar = screen.getByRole("toolbar", { name: "Block actions" });
      expect(bar.getAttribute("data-side")).toBe("inside");
      const text = typedText("a");
      fireEvent.keyDown(text, { key: "h" });
      expect(bar.hasAttribute("data-typing")).toBe(true);
    } finally {
      boxes.mockRestore();
    }
  });

  it("steps aside for typing in a component's text, addressed by its placement", () => {
    // A placement's text carries the component's own minted id, and the
    // placement's address in data-nx-instance: the placement is selected.
    const boxes = topBlockBoxes();
    try {
      render(
        <div data-scroller="" style={{ overflowY: "auto" }}>
          {tree(editorSpy(pair(), "a"), {})}
        </div>
      );
      const bar = screen.getByRole("toolbar", { name: "Block actions" });
      const placement = document.querySelector('[data-nx-node="a"]');
      const minted = document.createElement("span");
      minted.setAttribute("data-nx-node", "a::heading");
      minted.setAttribute("data-nx-instance", "a");
      minted.setAttribute(EDITING_ATTRIBUTE, "text");
      placement?.append(minted);
      fireEvent.keyDown(minted, { key: "h" });
      expect(bar.hasAttribute("data-typing")).toBe(true);
    } finally {
      boxes.mockRestore();
    }
  });

  it("stays, and pressable, while the pointer is over a block inside the selection whose bar is inside it", () => {
    // A Section at the top holding a Heading: the bar is drawn over the
    // Section's own content, so pointing at the Heading under it does not
    // fade it; pointing at the next block does.
    function PointAt({ id }: { id: string | null }) {
      const point = useHoveredBlockSetter();
      React.useEffect(() => point(id), [id, point]);
      return null;
    }
    const boxes = topBlockBoxes("hero");
    const doc = documentOf([
      {
        id: "hero",
        type: "acme/leaf",
        version: 1,
        props: {},
        slots: {
          children: [{ id: "inner", type: "acme/leaf", version: 1, props: {} }],
        },
      } as BlockNode,
      { id: "b", type: "acme/leaf", version: 1, props: {} } as BlockNode,
    ]);
    const drawn = (hovered: string) => (
      <HoveredBlockProvider>
        <PointAt id={hovered} />
        <div data-scroller="" style={{ overflowY: "auto" }}>
          {tree(editorSpy(doc, "hero"), {})}
        </div>
      </HoveredBlockProvider>
    );
    try {
      const { rerender } = render(drawn("inner"));
      const bar = screen.getByRole("toolbar", { name: "Block actions" });
      expect(bar.getAttribute("data-side")).toBe("inside");
      expect(bar.hasAttribute("data-faded")).toBe(false);
      rerender(drawn("b"));
      expect(bar.hasAttribute("data-faded")).toBe(true);
    } finally {
      boxes.mockRestore();
    }
  });

  it("stays while the author types in a block whose bar is above it", () => {
    // The control: a bar above the block covers none of its text.
    const boxes = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (y: number, width: number, height: number) =>
          new DOMRect(0, y, width, height);
        if (this.matches("[data-scroller]")) return box(0, 1000, 900);
        if (this.matches(".nx-canvas")) return box(0, 1000, 3000);
        if (this.matches('[data-nx-node="a"]')) return box(200, 1000, 60);
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
      const text = document.querySelector('[data-nx-node="a"]');
      if (!(text instanceof HTMLElement)) throw new Error("no block a");
      text.setAttribute(EDITING_ATTRIBUTE, "text");
      fireEvent.keyDown(text, { key: "h" });
      expect(bar.hasAttribute("data-typing")).toBe(false);
      expect(bar.style.visibility).toBe("");
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

/**
 * What the bar's Save says when pressed. The bar plans a save only when it
 * runs, since planning it builds the pattern a save would store, so a refused
 * save is said in the live region rather than drawn dimmed on selection.
 */
function savePressed(): string {
  fireEvent.click(screen.getByLabelText("Save as section…"));
  return screen.getByRole("status").textContent ?? "";
}

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

    expect(savePressed()).toContain("belongs inside");
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

    expect(savePressed()).toContain("no gaps");
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
      screen.getByLabelText("Save as section…").getAttribute("aria-disabled")
    ).toBeNull();
    // Pressed, it goes on to the host's form: nothing is refused.
    expect(savePressed()).toBe("");
  });

  it("offers the save under the registry's own rules", () => {
    // The control, and the reason the case above is about the SOURCE rather
    // than about saving being broken: the same selection, with nothing
    // supplied, is savable.
    register();

    mount(editorSpy(pair(), "a"));

    const save = screen.getByLabelText("Save as section…");
    expect(save.getAttribute("aria-disabled")).toBeNull();
    expect(save.getAttribute("title")).toBe("Save as section…");
  });
});

describe("Turn into, in the bar's More menu", () => {
  it("lists Rich text and Heading apart from the component verbs, saying what Heading removes", () => {
    registerBlocks(coreBlocks as never, { source: "core" });
    const editor = editorSpy(
      documentOf([
        {
          id: "a",
          type: "core/text",
          version: 2,
          props: {
            text: {
              root: {
                type: "root",
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "Hi", format: 1 }],
                  },
                ],
              },
            },
          },
        } as BlockNode,
      ]),
      "a"
    );
    render(
      <ShortcutProvider>
        <BlockKeyboardActions
          onSaveAsPattern={() => undefined}
          editor={editor}
          components={{ mayCreate: true, onTurnIntoComponent: () => {} }}
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
    const menu = screen.getByRole("menu");
    const rows = [...menu.children].map(child =>
      child.getAttribute("role") === "separator"
        ? "—"
        : (child.querySelector("span span")?.textContent ?? "")
    );
    // A group of their own, with a separator on each side: apart from the
    // copy verbs before them and "Turn into component…" after.
    const at = rows.indexOf("Turn into Rich text");
    expect(rows.slice(at - 1, at + 3)).toEqual([
      "—",
      "Turn into Rich text",
      "Turn into Heading",
      "—",
    ]);
    expect(rows.indexOf("Turn into component…")).toBeGreaterThan(at + 2);
    expect(
      screen.getByRole("menuitem", { name: /^Turn into Heading/ }).textContent
    ).toContain("Bold and links are removed");
  });
});
