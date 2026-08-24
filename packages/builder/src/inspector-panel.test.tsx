// @vitest-environment jsdom

/**
 * The inspector, driven through a host that renders it against a real editor.
 *
 * `inspector.ts` decides which controls a block offers and what op each edit
 * produces, and asserts that without a DOM. What is only true HERE is the
 * wiring: that an edit reaches `editor.apply` at the moment it should, and that
 * a field showing a stored value follows that value when something else changes
 * it.
 *
 * **Scoped to the identity fields.** `inspector-panel.tsx` had no test file at
 * all before this one, so the prop controls below it remain uncovered — stated
 * rather than implied, because a file that exists reads as a file that covers
 * the module.
 *
 * @module inspector-panel.test
 */
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { InspectorPanel } from "./inspector-panel";
import { applyOp } from "./ops";
import type { EditorState } from "./editor-state";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither, and a missing one
  // throws during render rather than failing an assertion.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

function register() {
  if (hasBlock("acme/heading")) return;
  registerBlocks(
    [
      {
        name: "acme/heading",
        version: 1,
        description: "A heading.",
        example: { props: {} },
        editor: { label: "Heading" },
        props: { text: { type: "text" } },
        render: () => null,
      },
    ] as never,
    { source: "inspector-panel-test" }
  );
}

function documentOf(node: Partial<BlockNode>): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/heading", version: 1, props: {}, ...node },
    ] as BlockNode[],
  } as BlockDocument;
}

function editorFor(
  document: BlockDocument
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

function mount(node: Partial<BlockNode> = {}) {
  register();
  const editor = editorFor(documentOf(node));
  render(<InspectorPanel editor={editor} />);
  return editor;
}

describe("InspectorPanel identity fields", () => {
  it("shows the block's stored name and lock", () => {
    mount({ name: "Hero title", locked: true });

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Hero title"
    );
    // `data-state` rather than a `toBeChecked` matcher: this package does not
    // register jest-dom, and the property form of that matcher is a no-op that
    // reads as an assertion — it was in this test until it threw.
    expect(
      screen.getByLabelText("Lock this block").getAttribute("data-state")
    ).toBe("checked");
  });

  it("renames on blur, through the store", () => {
    // Through `editor.apply` rather than around it, so the rename is on the undo
    // stack with every other edit.
    const editor = mount();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Hero title" },
    });
    expect(editor.apply).not.toHaveBeenCalled(); // not on every keystroke
    fireEvent.blur(screen.getByLabelText("Name"));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { name: "Hero title" },
    });
  });

  it("does not write when the name is unchanged", () => {
    // Blur fires whenever focus leaves, including when an author clicks into
    // the field and straight out of it. Writing there would put an op with no
    // effect on the undo stack, so one press of undo would appear to do nothing.
    const editor = mount({ name: "Hero title" });

    fireEvent.blur(screen.getByLabelText("Name"));

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("clears the name by unsetting the field", () => {
    const editor = mount({ name: "Hero title" });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Name"));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["name"],
    });
  });

  it("locks immediately, with no blur to wait for", () => {
    // There is nothing to coalesce in a checkbox, and waiting would leave the
    // canvas disagreeing with a control the author has already changed.
    const editor = mount();

    fireEvent.click(screen.getByLabelText("Lock this block"));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { locked: true },
    });
  });

  it("unlocks by unsetting rather than storing false", () => {
    const editor = mount({ locked: true });

    fireEvent.click(screen.getByLabelText("Lock this block"));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["locked"],
    });
  });

  it("says nothing about identity when there is no selection", () => {
    // The control for every case above: they would all pass against a panel
    // that rendered the fields unconditionally, and this is the state the
    // inspector spends most of its time in.
    register();
    const editor = editorFor(documentOf({}));
    render(
      <InspectorPanel
        editor={{ ...editor, selectedId: null } as unknown as EditorState}
      />
    );

    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Lock this block")).toBeNull();
  });
});

describe("InspectorPanel with several blocks selected", () => {
  function manyEditor(locks: readonly boolean[]) {
    register();
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: locks.map((locked, i) => ({
        id: String(i),
        type: "acme/heading",
        version: 1,
        props: {},
        ...(locked ? { locked: true } : {}),
      })),
    } as unknown as BlockDocument;
    const editor = {
      ...editorFor(document),
      selectedId: "0",
      selection: { ids: locks.map((_, i) => String(i)), primary: "0" },
    } as unknown as EditorState & {
      applyAll: ReturnType<typeof vi.fn>;
    };
    render(<InspectorPanel editor={editor} />);
    return editor;
  }

  it("says how many, rather than describing one of them", () => {
    /*
     * Showing the primary's name and props while three blocks are selected
     * would describe one block on a screen where the canvas outlines three and
     * the toolbar's delete removes all of them.
     */
    manyEditor([false, false, false]);

    expect(screen.getByText("3 blocks selected")).toBeDefined();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("shows the lock as MIXED when only some are locked", () => {
    // A real third state. `checked` or unchecked here would tell the author
    // something false about half of what they selected.
    manyEditor([true, false]);

    const box = screen.getByRole("checkbox", { name: /lock these blocks/i });
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    expect((box as HTMLInputElement).indeterminate).toBe(true);
  });

  it("shows it as checked when they are ALL locked, which is the control", () => {
    // Without this, "always mixed" would satisfy the case above.
    manyEditor([true, true]);

    const box = screen.getByRole("checkbox", { name: /lock these blocks/i });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect((box as HTMLInputElement).indeterminate).toBe(false);
  });

  it("LOCKS everything on the first press from mixed", () => {
    /*
     * Rather than unlocking. Unlocking from mixed is a first press that appears
     * to do nothing to the blocks that were already unlocked, and every file
     * manager and design tool resolves it this way.
     */
    const editor = manyEditor([true, false]);

    fireEvent.click(
      screen.getByRole("checkbox", { name: /lock these blocks/i })
    );

    /*
     * ONLY the block that changes. The already-locked one is omitted, because
     * `applyOp` refuses an update writing what a node already holds and the
     * group is atomic — planning it would abort the whole edit and lock
     * nothing. That is what the editor actually did until a browser run caught
     * it; this suite passed throughout, because the spy never ran the ops.
     */
    expect(editor.applyAll).toHaveBeenCalledWith([
      { kind: "update", id: "1", patch: { locked: true } },
    ]);
  });

  it("unlocks everything when they are all locked", () => {
    const editor = manyEditor([true, true]);

    fireEvent.click(
      screen.getByRole("checkbox", { name: /lock these blocks/i })
    );

    expect(editor.applyAll).toHaveBeenCalledWith([
      { kind: "update", id: "0", patch: {}, unset: ["locked"] },
      { kind: "update", id: "1", patch: {}, unset: ["locked"] },
    ]);
  });
});

/**
 * The Advanced tab: the block's `id` and the attributes an author may add.
 *
 * `custom-attributes.ts` decides which rows may land and asserts that without a
 * DOM. What is only true HERE is the wiring — that a refusal is shown against
 * the field it belongs to, that an edit reaches `editor.apply`, and that what
 * the page would drop is never stored.
 */
describe("InspectorPanel advanced fields", () => {
  const openAdvanced = () => {
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));
  };

  it("shows the block's stored id and attributes", () => {
    mount({ cssId: "hero", attributes: { "data-x": "1" } });
    openAdvanced();

    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "hero"
    );
    expect(
      (screen.getByLabelText("Name of attribute 1") as HTMLInputElement).value
    ).toBe("data-x");
  });

  it("commits an id through the editor, so undo covers it", () => {
    const editor = mount({});
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    // Nothing yet: an op per keystroke would make one undo remove one letter.
    expect(editor.apply).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "hero" },
    });
  });

  it("REMOVES an id rather than storing an empty one", () => {
    // A node that never had an id and one whose id was cleared are the same
    // node; an empty string would render as `id=""`.
    const editor = mount({ cssId: "hero" });
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);
    /*
     * `unset`, never `undefined`. `applyOp` refuses an undefined patch value —
     * the key disappears when the op is stored, so a replayed edit would do
     * nothing — and the op below is checked against the REAL store in the
     * control beneath this describe, not only against a spy.
     */
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["cssId"],
    });
  });

  it("says why a refused attribute will not reach the page, and stores nothing", () => {
    /*
     * The whole point of the surface. Without it an author types `onclick`,
     * watches it save, and finds the page without it — the renderer drops the
     * name and nothing anywhere says so.
     */
    const editor = mount({ attributes: { "data-x": "1" } });
    openAdvanced();

    const name = screen.getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "onclick" } });
    fireEvent.blur(name);

    const said = screen.getByRole("alert");
    expect(said.textContent).toContain("does not put that attribute");
    // Named to the field, so a screen reader reaches the reason with it.
    expect(name.getAttribute("aria-describedby")).toBe(said.id);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    /*
     * And NOTHING is written. Renaming `data-x` to `onclick` means the author
     * typed something wrong, not that they want `data-x` removed — writing the
     * reduced set would delete it, and the row showing the mistake would be
     * replaced by the now-empty stored value, so the attribute and the reason
     * for the refusal would disappear together.
     */
    expect(editor.apply).not.toHaveBeenCalled();
    // The row and its explanation are still on screen for the author to fix.
    expect((name as HTMLInputElement).value).toBe("onclick");
  });

  it("says an id attribute loses to the CSS id field", () => {
    /*
     * The renderer resolves this in favour of `cssId` and says so. That is the
     * right precedence and it is invisible from here: without this the author
     * sets an id, sees it saved, and the page carries the other one.
     */
    mount({ cssId: "from-the-field", attributes: { id: "from-the-bag" } });
    openAdvanced();

    expect(screen.getByRole("alert").textContent).toContain("CSS id");
  });

  it("says nothing about an attribute that WILL reach the page", () => {
    // The control: a refusal shown on a valid row would make the surface noise,
    // and every assertion above would still pass.
    mount({ cssId: "hero", attributes: { "data-x": "1" } });
    openAdvanced();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives every row a distinct name, and does not collide with the block's", () => {
    /*
     * The visible labels are short because they sit inline, and short labels
     * repeat: "Name" is also the block's own name field above the tabs. Two
     * rows plus that one would announce the same word three times for three
     * different things, and a voice-control user saying "name" would have no
     * way to pick.
     */
    mount({ attributes: { "data-a": "1", "data-b": "2" } });
    openAdvanced();

    expect(
      (screen.getByLabelText("Name of attribute 1") as HTMLInputElement).value
    ).toBe("data-a");
    expect(
      (screen.getByLabelText("Name of attribute 2") as HTMLInputElement).value
    ).toBe("data-b");
    // The block's own field is still reachable by its own label, which is what
    // an ambiguous name would break — `getByLabelText` throws on two matches.
    expect(screen.getByLabelText("Name")).toHaveProperty("id", "nx-block-name");
    // Each Remove is named too, for the same reason.
    expect(screen.getByRole("button", { name: "Remove data-a" })).toBeDefined();
  });

  it("keeps the identity fields above the tabs", () => {
    // The Advanced tab must not have moved the block's own name into it: the
    // name answers "which of six headings is this" under every tab.
    mount({ name: "Hero title" });
    openAdvanced();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Hero title"
    );
  });
});

/**
 * The ops the Advanced tab emits, applied for REAL.
 *
 * The tests above drive a spy, which records an op and never judges it — so an
 * op the store would refuse looks identical there to one it accepts. That is
 * how `{ cssId: undefined }` passed review here: the panel appeared to clear an
 * id, `applyOp` threw on the undefined value, and the document kept the old one
 * while the field showed it gone.
 *
 * So these hand the recorded op to the real `applyOp` and assert what the
 * DOCUMENT holds afterwards. A shape the store rejects fails here.
 */
describe("the Advanced tab's ops, through the real store", () => {
  const nodeWith = (node: Partial<BlockNode>): BlockNode =>
    ({
      id: "a",
      type: "acme/heading",
      version: 1,
      props: {},
      ...node,
    }) as BlockNode;

  const applyRecorded = (
    editor: { apply: ReturnType<typeof vi.fn> },
    before: BlockNode
  ): BlockNode => {
    const op = editor.apply.mock.calls.at(-1)?.[0] as never;
    const applied = applyOp(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [before],
      } as unknown as BlockDocument,
      op
    );
    return applied.document.nodes[0] as BlockNode;
  };

  it("actually REMOVES a cleared css id", () => {
    const before = nodeWith({ cssId: "hero" });
    const editor = mount({ cssId: "hero" });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);

    // The control: the op was recorded at all, so an empty call list cannot
    // satisfy the assertion below.
    expect(editor.apply).toHaveBeenCalled();
    expect(applyRecorded(editor, before).cssId).toBeUndefined();
  });

  it("actually REMOVES the last attribute", () => {
    const before = nodeWith({ attributes: { "data-x": "1" } });
    const editor = mount({ attributes: { "data-x": "1" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove data-x" }));

    expect(editor.apply).toHaveBeenCalled();
    expect(applyRecorded(editor, before).attributes).toBeUndefined();
  });

  it("actually WRITES an id the author typed", () => {
    // The positive control on the pair above: the same route that removes must
    // be shown to store, or "undefined afterwards" would pass on a store that
    // never writes anything.
    const before = nodeWith({});
    const editor = mount({});
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(applyRecorded(editor, before).cssId).toBe("hero");
  });
});

/**
 * The two ways a draft used to be lost, and the shadowed id it left behind.
 */
describe("the Advanced tab keeps what the author typed", () => {
  const openAdvanced = () => {
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));
  };

  it("commits a draft when the tab is switched away", () => {
    /*
     * The tabs activate on `mousedown` and unmount the inactive tab's content,
     * so the panel is removed before the browser delivers `blur` — and the
     * draft went with it, silently. Typing an id and clicking Style must not
     * throw the id away.
     */
    const editor = mount({});
    openAdvanced();
    fireEvent.change(screen.getByLabelText("CSS id"), {
      target: { value: "hero" },
    });
    // No blur: the tab is clicked with the field still focused, which is what
    // an author does.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "hero" },
    });
  });

  it("does not commit when nothing was typed", () => {
    // The control: an unmount that always wrote would put an empty edit in the
    // undo history every time an author looked at this tab.
    const editor = mount({ cssId: "hero" });
    openAdvanced();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("drops an id attribute the CSS id now shadows", () => {
    /*
     * Setting a CSS id used to patch only `cssId`, leaving the shadowed
     * attribute stored — so clearing the CSS id later brought a stale id back
     * to life on a block the author thought had none.
     */
    const editor = mount({ attributes: { id: "old" } });
    openAdvanced();
    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "new" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "new" },
      unset: ["attributes"],
    });
  });
});

describe("a refused row survives its own commit", () => {
  it("keeps the draft and the stored attribute when a rename is refused", () => {
    /*
     * The failure this closes needs the panel to RE-RENDER after a write, which
     * a spy-only editor never does. Here the parent is re-rendered with the
     * stored attributes unchanged, which is what a real store does when nothing
     * was written — and the refused row, its explanation, and the attribute it
     * replaced must all still be there.
     */
    const editor = mount({ attributes: { "data-x": "1" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    const name = screen.getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "onclick" } });
    fireEvent.blur(name);

    // Nothing written, so `data-x` is still the stored value.
    expect(editor.apply).not.toHaveBeenCalled();
    // The draft the author is fixing is still on screen, with its reason.
    expect((name as HTMLInputElement).value).toBe("onclick");
    expect(screen.getByRole("alert").textContent).toContain(
      "does not put that attribute"
    );
  });

  it("still commits a CSS id while a row is refused", () => {
    // The id is a separate field, and holding it hostage to an unrelated typo
    // in the rows below would be its own surprise.
    const editor = mount({ attributes: { "data-x": "1" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    const name = screen.getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "onclick" } });
    fireEvent.blur(name);

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "hero" },
    });
  });

  it("refuses an id another block already holds, and writes nothing", () => {
    // The engine reports this only as a warning and the field's validation
    // discards warnings, so without refusing here it saves and publishes.
    register();
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/heading", version: 1, props: {} },
        { id: "b", type: "acme/heading", version: 1, props: {}, cssId: "hero" },
      ],
    } as unknown as BlockDocument);
    render(<InspectorPanel editor={editor} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "already uses that id"
    );
  });
});

describe("a shadowed id and a mistyped row at the same time", () => {
  it("still drops the shadowed id while holding the mistyped row", () => {
    /*
     * The two rules interacting. Holding the write because a row is a mistake
     * must not also hold back dropping an id the new CSS id shadows: those are
     * different reasons and only one is the author's to fix. Without this,
     * clearing the CSS id later brought the old bag id back to life.
     */
    const editor = mount({ attributes: { id: "old", "data-x": "1" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    /*
     * Rows are shown in NAME order, so `data-x` is the first and `id` the
     * second — an earlier version of this test edited the row it did not mean
     * and passed for the wrong reason.
     */
    const first = screen.getByLabelText("Name of attribute 1");
    expect((first as HTMLInputElement).value).toBe("data-x");
    fireEvent.change(first, { target: { value: "onclick" } });
    fireEvent.blur(first);
    expect(editor.apply).not.toHaveBeenCalled();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "new" } });
    fireEvent.blur(field);

    // The id commits, and the shadowed bag id goes with it — `data-x` is kept
    // because the author is still fixing that row.
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "new", attributes: { "data-x": "1" } },
    });
  });
});

describe("the panel's own write does not fight the document", () => {
  it("removes one row while another is mistyped", () => {
    /*
     * Holding the whole write for a mistyped row used to mean this Remove did
     * nothing: the row vanished locally, no op removed it, and leaving the tab
     * brought it back. Origin tracking lets the mistyped row keep what it
     * replaced without freezing everything beside it.
     */
    const editor = mount({ attributes: { "data-a": "1", "data-b": "2" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    const first = screen.getByLabelText("Name of attribute 1");
    expect((first as HTMLInputElement).value).toBe("data-a");
    fireEvent.change(first, { target: { value: "onclick" } });
    fireEvent.blur(first);
    expect(editor.apply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove data-b" }));

    // `data-b` is gone and `data-a` survives its own bad rename.
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { attributes: { "data-a": "1" } },
    });
  });

  it("points an id row at the field above rather than storing it", () => {
    // One route to an identifier. The renderer accepts an `id` here, so a
    // document from elsewhere can carry one — it is shown, explained, and not
    // rewritten under a new value.
    mount({ attributes: { id: "from-a-file" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    expect(screen.getByRole("alert").textContent).toContain("CSS id field");
  });
});

describe("undo then redo, with the panel open", () => {
  it("follows the document back to the redone value", () => {
    /*
     * The panel skips re-reading the document when the incoming props are its
     * own write echoing back, or a local draft would be wiped by every save.
     * The marker for that has to be CONSUMED once matched: left in place it
     * goes on describing a state the document can return to, and a redo lands
     * exactly there — so the panel keeps showing the undone value while a later
     * blur writes from that stale draft and erases the redone edit.
     */
    register();
    const withId = (cssId?: string): BlockDocument =>
      ({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "a",
            type: "acme/heading",
            version: 1,
            props: {},
            ...(cssId === undefined ? {} : { cssId }),
          },
        ],
      }) as unknown as BlockDocument;

    const editor = editorFor(withId("one"));
    const { rerender } = render(<InspectorPanel editor={editor} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "two" } });
    fireEvent.blur(field);
    expect(editor.apply).toHaveBeenCalled();

    // The write echoes back through the document.
    rerender(<InspectorPanel editor={editorFor(withId("two"))} />);
    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "two"
    );

    // Undo.
    rerender(<InspectorPanel editor={editorFor(withId("one"))} />);
    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "one"
    );

    // Redo — the field must follow, not sit on the undone value.
    rerender(<InspectorPanel editor={editorFor(withId("two"))} />);
    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "two"
    );
  });
});

describe("the Advanced tab inside the entry's form", () => {
  it("does not let Enter submit the form", () => {
    /*
     * The builder mounts inside the entry's `<form>`, and a single-line input
     * with nothing stopping the key implicitly submits it — so typing an
     * attribute and pressing Enter would save the whole entry. The CSS id field
     * already prevented it; the two row inputs did not.
     */
    const editor = mount({ attributes: { "data-x": "1" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    for (const label of [
      "CSS id",
      "Name of attribute 1",
      "Value of attribute 1",
    ]) {
      const event = createEvent.keyDown(screen.getByLabelText(label), {
        key: "Enter",
      });
      fireEvent(screen.getByLabelText(label), event);
      expect(event.defaultPrevented, label).toBe(true);
    }
    // And Enter still COMMITS, rather than merely being swallowed.
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("reports a refused save instead of showing a value nothing stored", () => {
    /*
     * `apply` answers `null` when the op is refused — a value past the
     * document's byte limit is the reachable case — and the document is left
     * alone. Ignoring that told the panel its own write had landed, so it
     * stopped re-reading the document and went on showing the unsaved value.
     */
    register();
    const editor = editorFor(documentOf({}));
    editor.apply.mockReturnValue(null);
    render(<InspectorPanel editor={editor} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(screen.getByRole("alert").textContent).toContain("size limit");
  });

  it("says nothing when the save DID land", () => {
    // The control: a refusal shown on every successful edit would be worse
    // than the silence it replaced.
    const editor = mount({});
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));
    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
