// @vitest-environment jsdom

/**
 * What the panel adds on top of the derivations: that choosing a row inserts
 * the block the row names, through the one path a document changes by.
 *
 * `jsdom` per file, matching the canvas suite: the rest of this package's tests
 * are static analysis or arithmetic and gain nothing from a DOM but its startup
 * cost. These cases need real focus and real selection events.
 *
 * What is deliberately NOT re-asserted here is everything `inserter.test.ts`
 * already covers — which entries a target admits, what a query matches, where a
 * block lands. Re-checking them through a rendered list would test the same
 * derivation twice while making the failures harder to read, and the second
 * copy is the one that rots.
 *
 * @module insert-panel.test
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  type DocumentLimits,
  registerBlocks,
  type BlockDocument,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";

import { NoticeSinkProvider } from "./builder-notices";
import { InsertPanel } from "./insert-panel";
import type { EditorState } from "./editor-state";
import { EMPTY_SELECTION } from "./selection";

// The command primitives observe their list box to size it, and jsdom
// implements no ResizeObserver. Without this every case dies at render with a
// ReferenceError, which reads as the panel being broken rather than as the
// environment lacking an API the panel never calls itself.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // Same class of gap: the list scrolls its active row into view as focus
  // moves, and jsdom implements no layout, so the method simply is not there.
  Element.prototype.scrollIntoView ??= () => {};
});

// Explicit because this package does not enable vitest globals, so without it
// testing-library never registers its own cleanup and a later query matches
// this test's markup as well as the previous one's.
afterEach(() => {
  cleanup();
  clearBlocks();
});

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

function documentOf(nodes: BlockDocument["nodes"] = []): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/**
 * An editor whose `apply` is observed rather than reconstructed.
 *
 * The assertion is on the op the panel actually passes, so a change to the call
 * site shows up here. A test that rebuilt the expected op from the same inputs
 * would keep passing after someone edited the line it exists to watch.
 */
function editorSpy(
  document: BlockDocument,
  limits: DocumentLimits = DEFAULT_LIMITS
): EditorState & {
  apply: ReturnType<typeof vi.fn>;
  applyAll: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
} {
  return {
    document,
    limits,
    selectedId: null,
    selection: EMPTY_SELECTION,
    select: vi.fn(),
    apply: vi.fn(() => document),
    applyAll: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
  } as unknown as EditorState & {
    apply: ReturnType<typeof vi.fn>;
    applyAll: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
}

/**
 * The tile offering a block, addressed as the option it is.
 *
 * By ROLE and by an EXACT name, rather than by text. A text query matches the
 * tile and the popover alike — the popover repeats the name of whichever tile
 * is current — and refuses on the ambiguity. The exact name is available
 * because the tile states its own: the block's sentence is its description,
 * not part of what it is called.
 */
function tile(name: string): HTMLElement {
  return screen.getByRole("option", { name });
}

/**
 * Everything a tile's `aria-describedby` resolves to, read in order.
 *
 * Resolved rather than read off the attribute, because a reference to an id
 * that does not exist is silently skipped by assistive technology: only the
 * text the references actually reach is what a screen reader says.
 */
function describedBy(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(id => id !== "")
    .map(id => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

/** The popover beside the panel, or null while none is open. */
function popover(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".nx-insert-popover");
}

/** The name the open popover shows, or null while none is open. */
function popoverName(): string | null {
  return (
    popover()?.querySelector(".nx-insert-popover__name")?.textContent ?? null
  );
}

/** The sentence under the search that says where the next block goes. */
function placementLine(): string | null {
  return (
    document.querySelector(".nx-insert-panel__placement")?.textContent ?? null
  );
}

/**
 * Switch the panel to one of its tabs, as a pointer does.
 *
 * `mouseDown` because that is what the tab primitive activates on; a `click`
 * alone never reaches its handler.
 */
function openTab(name: "Blocks" | "Sections"): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

/**
 * An editor with one block selected, stated the way the real editor states
 * it: `selectedId` is `selection.primary`, so a fixture that set one and not
 * the other would be a state the editor never produces.
 */
function selecting<TEditor extends EditorState>(
  editor: TEditor,
  id: string
): TEditor {
  return {
    ...editor,
    selectedId: id,
    selection: { ids: [id], primary: id },
  };
}

describe("InsertPanel", () => {
  it("inserts the block a chosen row names, at the derived position", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    const onInsert = vi.fn();
    render(<InsertPanel editor={editor} onInsert={onInsert} />);

    fireEvent.click(tile("Text"));

    expect(editor.apply).toHaveBeenCalledTimes(1);
    const op = editor.apply.mock.calls[0][0];
    expect(op.kind).toBe("insert");
    expect(op.node.type).toBe("acme/text");
    // Position derived from an empty document and no selection: the end, which
    // is index 0. A panel that inserted at a hardcoded 0 would pass this and
    // fail the populated case below.
    expect(op.at).toEqual({ index: 0 });
    expect(onInsert).toHaveBeenCalledWith(op.node);
  });

  it("judges each block by its own insert where a lock answers by block", () => {
    // A locked slot already missing its heading: inserting the heading repairs
    // it, inserting anything else breaks it further. One block's answer is
    // not every block's, whichever comes first in the list. The refused one
    // stays in view, saying why, and its click inserts nothing.
    registerBlocks(
      [
        { ...base, name: "acme/heading", editor: { label: "Heading" } },
        { ...base, name: "acme/text", editor: { label: "Text" } },
      ] as never,
      { source: "acme" }
    );
    const editor = {
      ...editorSpy(documentOf()),
      lockRefusalFor: (ops: readonly { node?: { type: string } }[]) =>
        ops[0]?.node?.type === "acme/heading"
          ? undefined
          : {
              code: "locked-slot-altered" as const,
              holderType: "acme/row",
              lock: "all" as const,
            },
    } as unknown as ReturnType<typeof editorSpy>;
    const apply = vi.fn(() => editor.document);
    render(<InsertPanel editor={{ ...editor, apply }} />);

    const text = tile("Text");
    expect(text.getAttribute("data-refused")).toBe("true");
    expect(describedBy(text)).toContain("This area of Row is locked");
    fireEvent.click(text);
    expect(apply).not.toHaveBeenCalled();

    // The control: the block the lock lets in is offered as usual.
    expect(tile("Heading").getAttribute("data-refused")).toBeNull();
    fireEvent.click(tile("Heading"));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("offers a row as a drag, carrying the block it names", () => {
    // The panel is where a palette drag STARTS, and the node is built here
    // rather than inside the drag: these definitions are one snapshot taken per
    // mount, so resolving the type again later would read the registry a second
    // time and could answer with a different subtree than the row shows.
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    const beginInsertDrag = vi.fn();
    render(<InsertPanel editor={editor} beginInsertDrag={beginInsertDrag} />);

    // The OPTION rather than its label text: the popover repeats the
    // name of whichever tile is current, so a text query matches two elements
    // and refuses on the ambiguity. This is also the element carrying the
    // handler, rather than a child it happens to bubble from.
    fireEvent.pointerDown(tile("Text"), {
      button: 0,
      pointerId: 1,
    });

    expect(beginInsertDrag).toHaveBeenCalledTimes(1);
    const entry = beginInsertDrag.mock.calls[0][1];
    expect(entry.blockName).toBe("acme/text");
    // The THUNK is what matters, not that a callback fired: it must build the
    // block this row names. Asserting only that the drag was started would
    // pass for a row that handed over some other entry entirely.
    expect(entry.makeNode().type).toBe("acme/text");
    // And starting a drag must not itself edit the document — the insert
    // happens at the release, in the drag.
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("lets a block refused at every click place still be dragged, as its tile says", () => {
    // "Drag this into one" has to be reachable: the click places refuse the
    // Column, but a Columns on the canvas would take it, and judging a drop
    // is the canvas's question, asked where the block lands.
    registerBlocks(
      [
        { ...base, name: "acme/columns", editor: { label: "Columns" } },
        {
          ...base,
          name: "acme/column",
          parent: ["acme/columns"],
          editor: { label: "Column" },
        },
      ] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    const beginInsertDrag = vi.fn();
    render(<InsertPanel editor={editor} beginInsertDrag={beginInsertDrag} />);

    const column = tile("Column");
    expect(column.getAttribute("data-refused")).toBe("true");
    expect(describedBy(column)).toContain("drag this into one");
    fireEvent.pointerDown(column, { button: 0, pointerId: 1 });

    expect(beginInsertDrag).toHaveBeenCalledTimes(1);
    expect(beginInsertDrag.mock.calls[0][1].blockName).toBe("acme/column");
    // A click still adds nothing: no place it may use takes the block.
    fireEvent.click(column);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("still inserts on click when no drag was supplied", () => {
    // The control, and the accessible path: a host with no canvas passes no
    // drag, and the row must behave exactly as it did before it could be
    // dragged. Click-to-insert is the WCAG 2.2 SC 2.5.7 alternative.
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    render(<InsertPanel editor={editor} />);

    fireEvent.pointerDown(tile("Text"), { button: 0, pointerId: 1 });
    fireEvent.click(tile("Text"));

    expect(editor.apply).toHaveBeenCalledTimes(1);
  });

  it("reserves the sideways gesture on a row, so touch can drag it", () => {
    /*
     * Asserted against the stylesheet because there is nothing else that could
     * see it. `touch-action` is honoured by a real compositor deciding whether
     * a movement belongs to the page or to the element; jsdom has no such
     * decision to make, and every pointer test in this package would pass with
     * the declaration deleted.
     *
     * The failure it guards is invisible in every other way: on a touch
     * browser the default lets the browser claim the gesture as a pan, and it
     * announces that with `pointercancel` — which this engine correctly treats
     * as the drag being withdrawn. So the drag abandons itself part-way, only
     * on touch, and nothing in CI is capable of noticing.
     */
    const css = readFileSync(
      join(process.cwd(), "src/styles/builder-chrome.css"),
      "utf8"
    );
    const rule = css.slice(css.indexOf(".nx-insert-panel [cmdk-item] {"));
    const firstBlock = rule.slice(0, rule.indexOf("}"));

    // Population: a renamed selector would leave every assertion below reading
    // an empty string, and "no forbidden value found" would pass on nothing.
    expect(firstBlock.length).toBeGreaterThan(0);
    expect(firstBlock).toContain("touch-action: pan-y;");
    // `pan-y` and not `none`, which is the tempting stronger answer: the
    // palette is a scrolling list, and taking vertical panning too would trade
    // a broken drag for a list a finger cannot scroll.
    expect(firstBlock).not.toContain("touch-action: none");
  });

  it("judges a supplied block's declared children by the supplied rules", () => {
    /*
     * The palette is handed definitions the REGISTRY does not hold, and no
     * nesting source. The container declares a starting child that its own
     * slot's `allow` excludes, so the child must not be seeded.
     *
     * What makes this discriminate: the registry cannot see either type, and
     * an unknown type reports as unrestricted rather than as forbidden — so a
     * panel that defaults its nesting source to the registry before handing it
     * on gets "allowed" for a placement the supplied declarations forbid, and
     * seeds it. Only the definitions themselves carry the rule.
     */
    const supplied = [
      {
        ...base,
        name: "acme/row",
        editor: { label: "Row" },
        slots: {
          children: {
            allow: ["acme/cell"],
            defaultBlock: [{ type: "acme/stray" }],
          },
        },
      },
      { ...base, name: "acme/stray", editor: { label: "Stray" } },
    ] as never;

    const editor = editorSpy(documentOf());
    render(<InsertPanel editor={editor} definitions={supplied} />);

    fireEvent.click(tile("Row"));

    const op = editor.apply.mock.calls[0][0];
    expect(op.node.type).toBe("acme/row");
    // The row itself still inserts; only the illegal child is refused, and a
    // slot left with no children carries no `slots` key at all.
    expect(op.node.slots).toBeUndefined();
  });

  it("seeds a supplied block's declared child when the supplied rules permit it", () => {
    // The control on the assertion above. Without it, an implementation that
    // seeded NOTHING from a supplied definition would satisfy the refusal and
    // look correct.
    const supplied = [
      {
        ...base,
        name: "acme/row",
        editor: { label: "Row" },
        slots: {
          children: {
            allow: ["acme/cell"],
            defaultBlock: [{ type: "acme/cell" }],
          },
        },
      },
      { ...base, name: "acme/cell", editor: { label: "Cell" } },
    ] as never;

    const editor = editorSpy(documentOf());
    render(<InsertPanel editor={editor} definitions={supplied} />);

    fireEvent.click(tile("Row"));

    const op = editor.apply.mock.calls[0][0];
    expect(
      op.node.slots?.children?.map((c: { type: string }) => c.type)
    ).toEqual(["acme/cell"]);
  });

  it("draws a mark on every row, so the rows are distinguishable at a glance", () => {
    /*
     * The palette is scanned rather than read: an author looking for a layout
     * block sees a column of near-identical two-line entries, and the mark is
     * what separates them before the labels are read at all.
     *
     * Population before the property. `.nx-block-icon` is asserted against the
     * NUMBER OF ROWS rather than "at least one", because one mark drawn for a
     * single row satisfies any nonzero count while every other row goes
     * unmarked — and a panel that rendered no rows at all would satisfy a
     * comparison of two zeroes, which is why the row count is checked to be
     * what was registered.
     */
    registerBlocks(
      [
        { ...base, name: "acme/text", editor: { label: "Text", icon: "text" } },
        { ...base, name: "acme/pic", editor: { label: "Pic", icon: "image" } },
      ] as never,
      { source: "acme" }
    );
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    const rows = document.querySelectorAll("[cmdk-item]");
    expect(rows.length).toBe(2);
    expect(document.querySelectorAll(".nx-block-icon").length).toBe(2);
    // Drawn, not merely present: an empty span would satisfy the count above.
    expect(document.querySelectorAll(".nx-block-icon svg").length).toBe(2);
  });

  it("draws a mark for a block that names no icon", () => {
    // The control on the assertion above. `icon` is optional on the engine's
    // metadata, so a row for a block that answers nothing must still carry a
    // mark — otherwise its row is a different shape from every row beside it,
    // which is the scanning the mark exists to support.
    registerBlocks(
      [{ ...base, name: "acme/bare", editor: { label: "Bare" } }] as never,
      { source: "acme" }
    );
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    expect(document.querySelectorAll("[cmdk-item]").length).toBe(1);
    expect(document.querySelectorAll(".nx-block-icon svg").length).toBe(1);
  });

  it("appends after the existing blocks rather than at a fixed index", () => {
    // The separating case for the assertion above.
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    const editor = editorSpy(
      documentOf([
        { id: "a", type: "acme/text", version: 1, props: {} },
        { id: "b", type: "acme/text", version: 1, props: {} },
      ])
    );
    render(<InsertPanel editor={editor} />);

    fireEvent.click(tile("Text"));

    expect(editor.apply.mock.calls[0][0].at).toEqual({ index: 2 });
  });

  it("selects what it inserted, so a second insert lands after the first", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    render(<InsertPanel editor={editor} />);

    fireEvent.click(tile("Text"));

    const inserted = editor.apply.mock.calls[0][0].node;
    expect(editor.select).toHaveBeenCalledWith(inserted.id);
  });

  it("does not report an insert the op layer refused", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    editor.apply.mockReturnValue(null);
    const onInsert = vi.fn();
    render(<InsertPanel editor={editor} onInsert={onInsert} />);

    fireEvent.click(tile("Text"));

    // A refusal means the document moved underneath the panel. Announcing it as
    // an insert would have the host record an edit that never happened.
    expect(onInsert).not.toHaveBeenCalled();
    expect(editor.select).not.toHaveBeenCalled();
  });

  it("narrows the list by the tested filter rather than the widget's own", () => {
    // The panel passes `shouldFilter={false}` and supplies pre-filtered rows.
    // Leaving cmdk's filter on would put a second matcher beside
    // `filterEntries`, and the two disagree here on purpose: cmdk matches the
    // VALUE, which is the entry id, so a search for the label "Picture" would
    // find nothing while the tested filter finds it.
    registerBlocks(
      [
        { ...base, name: "acme/aaa", editor: { label: "Picture" } },
        { ...base, name: "acme/zzz", editor: { label: "Heading" } },
      ] as never,
      { source: "acme" }
    );
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.change(
      screen.getByPlaceholderText("Search blocks and components"),
      {
        target: { value: "Picture" },
      }
    );

    expect(tile("Picture")).toBeTruthy();
    expect(
      screen.queryAllByRole("option", { name: /^Heading\b/ })
    ).toHaveLength(0);
  });

  it("says nothing matched, distinctly from nothing being placeable", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.change(
      screen.getByPlaceholderText("Search blocks and components"),
      {
        target: { value: "nonexistent" },
      }
    );

    expect(screen.getByText(/No blocks match/)).toBeTruthy();
  });

  it("keeps what the place refuses in view, says why, and inserts none of it", () => {
    /*
     * The rule reaches the rendered list, rather than being applied somewhere
     * the panel then ignores. `acme/column` may only sit in `acme/columns`, and
     * the position here is the document root.
     *
     * Kept in view rather than removed: an author who cannot see a block has
     * no way to learn where it would go. Not cmdk's `disabled`, which takes an
     * item out of keyboard navigation, so a keyboard author could never reach
     * the reason — the ArrowUp below is what holds that.
     */
    registerBlocks(
      [
        { ...base, name: "acme/columns", editor: { label: "Columns" } },
        {
          ...base,
          name: "acme/column",
          parent: ["acme/columns"],
          editor: { label: "Column" },
        },
      ] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    render(<InsertPanel editor={editor} />);

    const column = tile("Column");
    expect(column.getAttribute("data-refused")).toBe("true");
    // One plain instruction, generated from the rule's permitted parents.
    expect(describedBy(column)).toContain(
      "Goes inside a Columns. Select a Columns first, or drag this into one."
    );
    fireEvent.click(column);
    expect(editor.apply).not.toHaveBeenCalled();

    // Reached by the keyboard, and read: down to Columns and back up again.
    const search = screen.getByRole("combobox", { name: "Insert a block" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(search.getAttribute("aria-activedescendant")).toBe(column.id);
    expect(popoverName()).toBe("Column");
    expect(popover()?.textContent).toContain(
      "Goes inside a Columns. Select a Columns first, or drag this into one."
    );
    expect(popover()?.textContent).not.toContain("Click to add");

    // The control: the block the root takes still inserts.
    expect(tile("Columns").getAttribute("data-refused")).toBeNull();
    fireEvent.click(tile("Columns"));
    expect(editor.apply).toHaveBeenCalledTimes(1);
  });

  it("adds a block that only belongs inside the selected container inside it, as its refusal says", () => {
    // "Select a Columns first" has to be true: with the Columns selected, a
    // Column goes inside it, while a block that fits beside it still goes
    // after it.
    registerBlocks(
      [
        {
          ...base,
          name: "acme/columns",
          editor: { label: "Columns" },
          slots: { children: { allow: ["acme/column"] } },
        },
        {
          ...base,
          name: "acme/column",
          parent: ["acme/columns"],
          editor: { label: "Column" },
        },
        { ...base, name: "acme/text", editor: { label: "Text" } },
      ] as never,
      { source: "acme" }
    );
    const editor = selecting(
      editorSpy(
        documentOf([
          {
            id: "cols",
            type: "acme/columns",
            version: 1,
            props: {},
            slots: {
              children: [
                { id: "c1", type: "acme/column", version: 1, props: {} },
              ],
            },
          },
        ] as never)
      ),
      "cols"
    );
    render(<InsertPanel editor={editor} />);

    expect(placementLine()).toBe("Adding after Columns");
    expect(tile("Column").getAttribute("data-refused")).toBeNull();
    expect(describedBy(tile("Column"))).toContain("Goes inside Columns.");

    // The line names where the highlighted tile goes, before the click.
    const search = screen.getByRole("combobox", { name: "Insert a block" });
    const live = () =>
      document
        .querySelector(".nx-insert-panel__placement")
        ?.getAttribute("aria-live");
    expect(live()).toBe("polite");
    fireEvent.keyDown(search, { key: "Home" });
    expect(popoverName()).toBe("Column");
    expect(placementLine()).toBe("Adding inside Columns");
    // The tile's own description says it; the line is not announced twice.
    expect(live()).toBe("off");
    for (let step = 0; step < 6 && popoverName() !== "Text"; step++) {
      fireEvent.keyDown(search, { key: "ArrowDown" });
    }
    expect(popoverName()).toBe("Text");
    expect(placementLine()).toBe("Adding after Columns");

    fireEvent.click(tile("Column"));
    fireEvent.click(tile("Text"));

    expect(editor.apply.mock.calls[0][0].at).toEqual({
      parentId: "cols",
      slot: "children",
      index: 1,
    });
    // The control: a block the page takes goes after the selection.
    expect(editor.apply.mock.calls[1][0].at).toEqual({ index: 1 });
  });

  it("inserts a block the selection's region refuses after the nearest block that takes it", () => {
    /*
     * The selection is a Text inside a Column inside Columns. The Column's
     * region takes only Text, and Columns takes only Columns, so an Image
     * climbs out to the page and lands after the Columns — while a Text, the
     * control, still lands right after the selection.
     */
    registerBlocks(
      [
        {
          ...base,
          name: "acme/columns",
          editor: { label: "Columns" },
          slots: { children: { allow: ["acme/column"] } },
        },
        {
          ...base,
          name: "acme/column",
          editor: { label: "Column" },
          slots: { children: { allow: ["acme/text"] } },
        },
        { ...base, name: "acme/text", editor: { label: "Text" } },
        { ...base, name: "acme/image", editor: { label: "Image" } },
      ] as never,
      { source: "acme" }
    );
    const editor = selecting(
      editorSpy(
        documentOf([
          {
            id: "cols",
            type: "acme/columns",
            version: 1,
            props: {},
            slots: {
              children: [
                {
                  id: "col",
                  type: "acme/column",
                  version: 1,
                  props: {},
                  slots: {
                    children: [
                      { id: "t", type: "acme/text", version: 1, props: {} },
                    ],
                  },
                },
              ],
            },
          },
        ] as never)
      ),
      "t"
    );
    render(<InsertPanel editor={editor} />);

    expect(placementLine()).toBe("Adding after Text");
    // The line names the first place only, so a tile that goes further says
    // where, to a screen reader and in its popover. The Text, the control,
    // goes where the line says and adds nothing to it.
    expect(describedBy(tile("Image"))).toContain("Goes after Columns.");
    expect(describedBy(tile("Text"))).not.toContain("Goes");
    const search = screen.getByRole("combobox", { name: "Insert a block" });
    for (let step = 0; step < 8 && popoverName() !== "Image"; step++) {
      fireEvent.keyDown(search, { key: "ArrowDown" });
    }
    expect(popoverName()).toBe("Image");
    expect(
      popover()?.querySelector(".nx-insert-popover__place")?.textContent
    ).toBe("Goes after Columns");
    for (let step = 0; step < 8 && popoverName() !== "Text"; step++) {
      fireEvent.keyDown(search, { key: "ArrowDown" });
    }
    expect(popoverName()).toBe("Text");
    expect(popover()?.querySelector(".nx-insert-popover__place")).toBeNull();

    fireEvent.click(tile("Image"));
    fireEvent.click(tile("Text"));

    expect(editor.apply.mock.calls[0][0].at).toEqual({ index: 1 });
    expect(editor.apply.mock.calls[1][0].at).toEqual({
      parentId: "col",
      slot: "children",
      index: 1,
    });
  });
});

describe("the panel's frame", () => {
  it("heads the panel Add and opens on the Blocks tab", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    expect(screen.getByRole("heading", { name: "Add" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Blocks" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(
      screen
        .getByRole("tab", { name: "Sections" })
        .getAttribute("aria-selected")
    ).toBe("false");
  });

  it("keeps the search's name and says what it searches", () => {
    // Browser tests find the field by its name, and the placeholder now says
    // that components are found here too.
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    expect(
      screen
        .getByRole("combobox", { name: "Insert a block" })
        .getAttribute("placeholder")
    ).toBe("Search blocks and components");

    // The Sections tab searches sections, and says so.
    openTab("Sections");
    expect(
      screen
        .getByRole("combobox", { name: "Insert a block" })
        .getAttribute("placeholder")
    ).toBe("Search sections");
  });

  it("draws the library's categories by name, a plugin's as written, and a block with none under More blocks", () => {
    registerBlocks(
      [
        { ...base, name: "acme/aaa", editor: { label: "Aaa" } },
        {
          ...base,
          name: "acme/chart",
          editor: { label: "Chart", category: "Acme data" },
        },
        {
          ...base,
          name: "acme/text",
          editor: { label: "Text", category: "content" },
        },
        {
          ...base,
          name: "acme/box",
          editor: { label: "Box", category: "layout" },
        },
      ] as never,
      { source: "acme" }
    );
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        categoryOrder={["layout", "content"]}
      />
    );

    expect(
      [...document.querySelectorAll("[cmdk-group-heading]")].map(
        heading => heading.textContent
      )
    ).toEqual(["Layout", "Text", "Acme data", "More blocks"]);
  });
});

describe("the line that says where the next block goes", () => {
  /*
   * A polite live region under the search: for a screen-reader author it is
   * the whole answer to "where will this go", and for everyone it is what
   * makes a click predictable. The block is named as Layers names it, so the
   * line agrees with the tree the author has just been reading.
   */
  const blocks = [
    { ...base, name: "acme/heading", editor: { label: "Heading" } },
    {
      ...base,
      name: "acme/section",
      editor: { label: "Section" },
      slots: { children: {} },
    },
  ];

  it("says the end of the page when nothing is selected", () => {
    registerBlocks(blocks as never, { source: "acme" });
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    expect(placementLine()).toBe("Adding at the end of the page");
    expect(
      document
        .querySelector(".nx-insert-panel__placement")
        ?.getAttribute("aria-live")
    ).toBe("polite");
  });

  it("names the selected block as Layers does, an author's own name first", () => {
    // The authored name is what separates `layerLabel` from the type's label:
    // a line that read the type would say "Heading" here.
    registerBlocks(blocks as never, { source: "acme" });
    const editor = selecting(
      editorSpy(
        documentOf([
          {
            id: "h",
            type: "acme/heading",
            version: 1,
            props: {},
            name: "Hero title",
          },
        ] as never)
      ),
      "h"
    );
    render(<InsertPanel editor={editor} />);

    expect(placementLine()).toBe("Adding after Hero title");
    // Bold, as the name of a place rather than part of the sentence.
    expect(
      document.querySelector(".nx-insert-panel__placement b")?.textContent
    ).toBe("Hero title");
  });

  it("adds after a selected EMPTY container rather than inside it", () => {
    // Inside is the explicit "+" gesture's alone. Selecting an empty Section
    // and adding still builds the page downward, beside it.
    registerBlocks(blocks as never, { source: "acme" });
    const editor = selecting(
      editorSpy(
        documentOf([
          { id: "s", type: "acme/section", version: 1, props: {} },
        ] as never)
      ),
      "s"
    );
    render(<InsertPanel editor={editor} />);

    expect(placementLine()).toBe("Adding after Section");
    fireEvent.click(tile("Heading"));
    expect(editor.apply.mock.calls[0][0].at).toEqual({ index: 1 });
  });

  it("names the container a + chose to add inside, and inserts there", () => {
    registerBlocks(blocks as never, { source: "acme" });
    const editor = selecting(
      editorSpy(
        documentOf([
          { id: "s", type: "acme/section", version: 1, props: {} },
        ] as never)
      ),
      "s"
    );
    render(<InsertPanel editor={editor} inside="s" />);

    expect(placementLine()).toBe("Adding inside Section");
    fireEvent.click(tile("Heading"));
    expect(editor.apply.mock.calls[0][0].at).toEqual({
      parentId: "s",
      slot: "children",
      index: 0,
    });
  });
});

describe("the grid, and the popover that describes a tile", () => {
  /**
   * Seven blocks in one category, named so their position is readable.
   *
   * Seven rather than three because the grid is three wide: with a single row
   * "down by a row" and "down by one" land on the same tile, and every case
   * about the difference would pass either way.
   */
  function sevenBlocks(): void {
    registerBlocks(
      Array.from({ length: 7 }, (_, index) => ({
        ...base,
        name: `acme/b${index}`,
        description: `Block number ${index}.`,
        editor: { label: `B${index}`, category: "Layout" },
      })) as never,
      { source: "acme" }
    );
  }

  function search(): HTMLElement {
    return screen.getByRole("combobox", { name: "Insert a block" });
  }

  it("names a tile by its BLOCK and describes it with its sentence", () => {
    /*
     * Two separate things rather than one run-on name. The name computation
     * joins adjacent nodes with no separator, so a tile that let its contents
     * speak for it is announced as "B0Block number 0." — and whether a
     * separator appears at all depends on the stylesheet, which is not loaded
     * here and is not loaded by a screen reader's own reasoning either.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    const first = tile("B0");
    const describedBy = first.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // Resolved rather than merely present: an id pointing at nothing is the
    // failure this is built to exclude, and it reads identically on the
    // element itself.
    const description =
      describedBy === null ? null : document.getElementById(describedBy);
    expect(description?.textContent).toBe("Block number 0.");
  });

  it("gives a description an id with no WHITESPACE in it", () => {
    /*
     * A variation's name is an unrestricted string and a variation entry is
     * identified as `block#variation`, so a variation named "wide card" would
     * put a space in the attribute. `aria-describedby` is a space-separated
     * list of id REFERENCES, so assistive technology would look for two ids
     * that do not exist and announce the tile with no description at all —
     * silently, because a reference that resolves to nothing is not an error.
     *
     * Asserted on the resolved element as well as on the attribute: an id
     * that merely lacks spaces still fails if it names nothing.
     */
    registerBlocks(
      [
        {
          ...base,
          name: "acme/card",
          description: "A card that clips.",
          editor: {
            label: "Card",
            // The space is the whole point: nothing validates a variation's
            // name, and the entry identifying it is `block#variation`.
            variations: [{ name: "wide card", label: "Wide card" }],
          },
        },
      ] as never,
      { source: "acme" }
    );
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    const wide = tile("Wide card");
    const id = wide.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(id).not.toMatch(/\s/);
    // A variation carries no sentence of its own, so this is the block's —
    // which is what a description reference has to resolve to.
    expect(document.getElementById(id ?? "")?.textContent).toBe(
      "A card that clips."
    );
  });

  it("highlights nothing and opens no popover until the author moves through the tiles", () => {
    /*
     * The palette's primitives mark their first item as current the moment
     * the list draws, so a panel that painted that mark would open with a
     * tile looking chosen that the author never touched — and a popover
     * describing it. The panel paints the mark only once an arrow key or a
     * pointer has moved through the tiles.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);
    const panel = document.querySelector(".nx-insert-panel");

    expect(panel?.getAttribute("data-highlight")).toBeNull();
    expect(popover()).toBeNull();

    fireEvent.keyDown(search(), { key: "ArrowDown" });

    expect(panel?.getAttribute("data-highlight")).toBe("shown");
    expect(popoverName()).toBe("B1");
  });

  it("paints the current tile only while the panel says a highlight is shown", () => {
    /*
     * Asserted against the stylesheet because the paint is all there is to
     * see: the primitives set `data-selected` on their first item whatever
     * the panel does, so a rule keyed on that alone would mark a tile at rest.
     * Comments stripped, because a comment naming the selector would satisfy
     * a search of the raw text.
     */
    const css = readFileSync(
      join(process.cwd(), "src/styles/builder-chrome.css"),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const painted = css.match(
      /([^{}]*)\[cmdk-item\]\[data-selected="true"\]\s*\{[^}]*border-color:\s*var\(--nx-primary\)/
    );

    // Population: the rule that paints the current tile exists at all.
    expect(painted).not.toBeNull();
    expect(painted?.[1]).toContain('[data-highlight="shown"]');
  });

  it("shows the pointed tile's preview, name, description and how to add it", () => {
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);
    const input = search();
    input.focus();

    fireEvent.pointerMove(tile("B2"));

    const shown = popover();
    expect(popoverName()).toBe("B2");
    expect(
      shown?.querySelector(".nx-insert-popover__description")?.textContent
    ).toBe("Block number 2.");
    expect(shown?.querySelector(".nx-insert-popover__hint")?.textContent).toBe(
      "Click to add · drag to place"
    );
    // The block's mark stands in for a preview the host did not supply.
    expect(
      shown?.querySelector(".nx-insert-popover__preview .nx-block-icon svg")
    ).not.toBeNull();
    // Hidden from assistive technology, which reads the same sentence from
    // the tile's own description, and never taking focus from the search.
    expect(shown?.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(input);
  });

  it("draws the host's preview of a tile when it supplies one", () => {
    sevenBlocks();
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        renderPreview={entry => (
          <span className="host-preview">{`${entry.label} drawn`}</span>
        )}
      />
    );

    fireEvent.pointerMove(tile("B3"));

    expect(popover()?.querySelector(".host-preview")?.textContent).toBe(
      "B3 drawn"
    );
    expect(
      popover()?.querySelector(".nx-insert-popover__preview .nx-block-icon")
    ).toBeNull();
  });

  it("never announces an option that has been FILTERED AWAY", () => {
    /*
     * The palette announces the current option through `aria-activedescendant`
     * on the search field, and it maintains that alongside the mark it draws —
     * but only along its own navigation path. A panel that STEERS the palette
     * by handing it a value moves the mark and leaves the announcement behind,
     * and after a filter the announcement names an element that has been
     * removed from the document entirely.
     *
     * A dangling reference is worse than an absent one: assistive technology
     * is told there is a current option and then cannot find it, where absence
     * at least reads as "nothing current".
     *
     * The first assertion is the CONTROL. It requires the reference to resolve
     * while the tile is present, so the second assertion cannot pass merely
     * because this panel never sets the attribute at all.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);
    const input = search() as HTMLInputElement;

    fireEvent.pointerMove(tile("B4"));
    const announced = input.getAttribute("aria-activedescendant");
    expect(announced).toBeTruthy();
    expect(document.getElementById(announced ?? "")).not.toBeNull();
    expect(popoverName()).toBe("B4");

    fireEvent.change(input, { target: { value: "B0" } });

    // B4 is gone from the document. Whatever the field now announces, it must
    // not be B4 — resolving to nothing is the failure being excluded.
    const after = input.getAttribute("aria-activedescendant");
    if (after !== null) {
      expect(document.getElementById(after)).not.toBeNull();
    }
    expect(popoverName()).toBe("B0");
  });

  it("keeps a tile's token when the DEFINITIONS around it change", () => {
    /*
     * A host may replace `definitions` while the panel is mounted. Tokens
     * taken from an entry's POSITION would then be reassigned — inserting one
     * definition shifts every entry after it — so the same string would name a
     * different block while the palette is still holding it, and the popover
     * would describe, and Enter would insert, whichever block had inherited
     * the token.
     *
     * Asserted on the token for a block whose POSITION MOVES, which is the
     * only case that can separate a stable allocation from a positional one: a
     * block that stays at index 0 has the same token either way.
     */
    const defs = (names: string[]) =>
      names.map(n => ({
        ...base,
        name: `acme/${n}`,
        description: `The ${n}.`,
        editor: { label: n, category: "Layout" },
      })) as never;

    const view = render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        definitions={defs(["beta", "gamma"])}
      />
    );
    const before = tile("gamma").getAttribute("data-value");
    expect(before).toBeTruthy();

    // "alpha" is inserted AHEAD of gamma, so gamma's index moves from 1 to 2.
    view.rerender(
      <InsertPanel
        editor={editorSpy(documentOf())}
        definitions={defs(["alpha", "beta", "gamma"])}
      />
    );

    expect(tile("gamma").getAttribute("data-value")).toBe(before);
    // And the newcomer must not have been handed a token already in use.
    expect(tile("alpha").getAttribute("data-value")).not.toBe(before);
  });

  /** One definition with a description, so the popover and tiles both draw. */
  const described = [
    {
      ...base,
      name: "acme/solo",
      description: "A block with a description, so the popover has one.",
      editor: { label: "Solo", category: "Layout" },
    },
  ] as never;

  /** Press the first tile with the given pointer, as a device would. */
  function pressTile(pointerType: string): void {
    const tile = document.querySelector("[cmdk-item]") as HTMLElement;
    fireEvent.pointerDown(tile, { pointerType });
  }

  it("says nothing until a pointer has actually been used", () => {
    /*
     * The hint answers a question a hovering pointer never asks, and drawing
     * it before any press would spend panel height on an instruction nobody
     * has needed yet.
     */
    render(
      <InsertPanel editor={editorSpy(documentOf())} definitions={described} />
    );

    expect(document.querySelector(".nx-insert-panel__gesture-hint")).toBeNull();
  });

  it("appears once a TOUCH has pressed a tile", () => {
    render(
      <InsertPanel editor={editorSpy(documentOf())} definitions={described} />
    );
    pressTile("touch");

    const hint = document.querySelector(".nx-insert-panel__gesture-hint");
    expect(hint?.textContent).toContain("Press to read");
    expect(hint?.textContent).toContain("lift to insert");
  });

  it("stays away for a MOUSE, which reads a tile by hovering it", () => {
    /*
     * The discriminating case. A gate that merely waited for any press would
     * show a mouse author an instruction about a gesture their pointer does
     * not perform — and it is what a media query on the PRIMARY pointer gets
     * wrong in the other direction, on a touchscreen laptop driven by its
     * trackpad.
     */
    render(
      <InsertPanel editor={editorSpy(documentOf())} definitions={described} />
    );
    pressTile("mouse");

    expect(document.querySelector(".nx-insert-panel__gesture-hint")).toBeNull();
  });

  it("promises no cancellation, because sliding off can INSERT", () => {
    /*
     * The canvas sits beside this panel and is a drop target, so a finger
     * sliding horizontally out of a tile can start a palette drag and insert
     * on release — measured: a drag from a tile onto the canvas inserts.
     * Wording that offered "slide off to cancel" therefore told an author
     * declining a block to perform a gesture that can take it.
     *
     * Asserted as an absence with the population named, so it cannot pass by
     * the element being missing altogether.
     */
    render(
      <InsertPanel editor={editorSpy(documentOf())} definitions={described} />
    );
    pressTile("touch");

    const hint = document.querySelector(".nx-insert-panel__gesture-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent?.toLowerCase()).not.toContain("cancel");
    expect(hint?.textContent?.toLowerCase()).not.toContain("slide off");
  });

  it("keeps the hint out of the ACCESSIBLE tree", () => {
    /*
     * It describes a POINTER gesture. A screen reader on a touch device does
     * not activate a control by lifting a finger from it, so the sentence is
     * wrong for exactly the people an accessible name serves — and the block's
     * description reaches them through each tile's own `aria-describedby`.
     */
    render(
      <InsertPanel editor={editorSpy(documentOf())} definitions={described} />
    );
    pressTile("touch");

    expect(
      document
        .querySelector(".nx-insert-panel__gesture-hint")
        ?.getAttribute("aria-hidden")
    ).toBe("true");
  });

  it("says nothing when the search matches no block", () => {
    /*
     * With nothing offered the panel already says "No blocks match"; an
     * instruction about pressing tiles beside it describes tiles that are not
     * there, and spends panel height doing it.
     */
    render(
      <InsertPanel editor={editorSpy(documentOf())} definitions={described} />
    );
    pressTile("touch");
    expect(
      document.querySelector(".nx-insert-panel__gesture-hint")
    ).not.toBeNull();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "nothing matches this at all" },
    });

    expect(document.querySelector(".nx-insert-panel__gesture-hint")).toBeNull();
  });

  it("keeps two variations apart when only TRAILING SPACE separates them", () => {
    /*
     * Nothing validates a variation name, and the command primitives TRIM the
     * value they report — so `compact` and `compact ` are two valid, distinct
     * entries whose reported values are identical. Pointing at the second then
     * describes and inserts the FIRST, silently.
     *
     * Both halves are asserted. Describing the right one is the visible
     * symptom; inserting the right one is what the author actually loses, and
     * a case checking only the popover would pass against a panel that describes
     * correctly and inserts the wrong block.
     */
    registerBlocks(
      [
        {
          ...base,
          name: "acme/card",
          description: "A card.",
          editor: {
            label: "Card",
            // Distinct PROPS, so the inserted node says which variation was
            // chosen. Without them both inserts look identical and the half
            // of this case about inserting is satisfied by absence.
            variations: [
              { name: "compact", label: "Compact", props: { tone: "tight" } },
              { name: "compact ", label: "Spacious", props: { tone: "loose" } },
            ],
          },
        },
      ] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    render(<InsertPanel editor={editor} />);

    // Driven through the primitives' OWN highlight — a pointer move, which is
    // what they report a value from — because that report is where the
    // trimming happens. A press sets the value directly and would never reach
    // the collapse this case exists for.
    fireEvent.pointerMove(tile("Spacious"));
    expect(popoverName()).toBe("Spacious");
    expect(
      popover()?.querySelector(".nx-insert-popover__description")?.textContent
    ).toBe("A card.");

    fireEvent.click(tile("Spacious"));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply.mock.calls[0][0].node.props.tone).toBe("loose");
    // The two tiles must also carry DIFFERENT description references, or one
    // of them points at the other's sentence.
    expect(tile("Compact").getAttribute("aria-describedby")).not.toBe(
      tile("Spacious").getAttribute("aria-describedby")
    );
  });

  it("describes a tile on the PRESS, so touch reads it before lifting", () => {
    /*
     * A touch screen produces no `pointermove` before contact, and hover is
     * what the primitives report a highlight from — so on touch the popover
     * would never open, and the tap that finally moved the highlight is the
     * same tap that inserts.
     *
     * Driven with `pointerDown` and NOT `pointerMove`, because pointer-move is
     * the path that already worked: a case using it would pass against the
     * defect it is written for.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);
    expect(popover()).toBeNull();

    fireEvent.pointerDown(tile("B4"), { button: 0, pointerId: 1 });

    expect(popoverName()).toBe("B4");
  });

  it("leaves ArrowDown to the primitives, moving by ONE tile", () => {
    /*
     * The grid is a LAYOUT, and the keyboard stays the primitives'. Down means
     * the next option, which is the tile to the RIGHT — deliberately, because
     * the list publishes `listbox` semantics and a screen reader announces
     * "option 2 of 7". A panel that moved by a row instead would make that
     * announcement wrong by two every time.
     *
     * B1 rather than B3 is the whole assertion. Reinstating row movement here
     * without also publishing a grid accessibility tree is what this excludes.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.keyDown(search(), { key: "ArrowDown" });

    expect(popoverName()).toBe("B1");
  });

  it("leaves a horizontal arrow to the SEARCH FIELD entirely", () => {
    /*
     * Focus stays in the search box while the highlight moves, so a horizontal
     * arrow belongs to the caret and nothing else — claiming it at either end
     * of the text would make the box awkward to edit for a gain the layout
     * does not need, since Down already reaches the next tile.
     *
     * The caret is deliberately at the END, which is where a panel claiming
     * "the field has no use for this key" would take it. That the highlight
     * stays put is the property; the control below is what stops the case
     * passing on a panel where NO key moves anything.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    const input = search();
    fireEvent.change(input, { target: { value: "b" } });
    (input as HTMLInputElement).setSelectionRange(1, 1);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(popover()).toBeNull();

    // The control: the same panel, a key the primitives DO bind, and the
    // highlight moves. Without it an inert panel satisfies the assertion above.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(popoverName()).toBe("B1");
  });

  it("leaves a MODIFIED arrow to the command primitives", () => {
    // They bind first, last and by-group to the modified arrows. Meta+Down is
    // theirs and means "last".
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.keyDown(search(), { key: "ArrowDown", metaKey: true });

    expect(popoverName()).toBe("B6");
  });

  it("follows the POINTER as well as the keyboard, through one piece of state", () => {
    // The primitives highlight on pointer move and report it the same way they
    // report an arrow key, which is what lets one value drive the popover. A
    // panel tracking hover separately would hold a second answer.
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.pointerMove(tile("B4"));

    expect(popoverName()).toBe("B4");
  });

  it("shows NO popover when nothing can be offered", () => {
    // There is no tile to describe, and a popover left standing would describe
    // whichever block was current before the search emptied the list.
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);
    fireEvent.pointerMove(tile("B4"));
    expect(popoverName()).toBe("B4");

    fireEvent.change(search(), { target: { value: "nothing matches this" } });

    expect(popover()).toBeNull();
    expect(screen.getByText(/No blocks match/)).toBeTruthy();
  });
});

describe("InsertPanel and the pattern tier", () => {
  /** A saved pattern of two roots, which is what makes the group observable. */
  function heroPattern() {
    return {
      id: "hero",
      title: "Hero",
      category: "Sections",
      document: {
        formatVersion: 1,
        kind: "pattern",
        nodes: [
          { id: "a", type: "acme/text", version: 1, props: {} },
          { id: "b", type: "acme/text", version: 1, props: {} },
        ],
      } as unknown as BlockDocument,
    };
  }

  it("offers a supplied pattern under Sections, apart from the blocks", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        patterns={[heroPattern()]}
      />
    );

    // Blocks open first, with no pattern among them.
    expect(tile("Text")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Hero" })).toBeNull();

    // Sections holds the patterns, and only them.
    openTab("Sections");
    expect(tile("Hero")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Text" })).toBeNull();
  });

  it("places a chosen pattern as ONE edit, through the planner", () => {
    registerBlocks([{ ...base, name: "acme/text" }] as never, {
      source: "acme",
    });
    const editor = editorSpy(documentOf());
    const onInsert = vi.fn();
    render(
      <InsertPanel
        editor={editor}
        patterns={[heroPattern()]}
        onInsert={onInsert}
      />
    );

    openTab("Sections");
    fireEvent.click(tile("Hero"));

    // `applyAll` and not `apply`: a pattern is a forest, and placing it as
    // several edits would undo one root at a time.
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    const ops = editor.applyAll.mock.calls[0][0] as { kind: string }[];
    expect(ops.map(op => op.kind)).toEqual(["insert", "insert"]);

    // Fresh ids, minted by the planner rather than the pattern's own, so the
    // same pattern can be placed twice on one page.
    const placed = ops as { kind: string; node: { id: string } }[];
    expect(placed[0]?.node.id).not.toBe("a");
    expect(editor.select).toHaveBeenCalledWith(placed[0]?.node.id);
    expect(onInsert).toHaveBeenCalledWith(placed[0]?.node);
  });

  it("offers nothing for a pattern the planner would refuse", () => {
    // The catalogue drops a row the planner cannot place, so the panel never
    // draws a tile that accepts a click and then fails. The control is the
    // usable pattern in the same render.
    registerBlocks([{ ...base, name: "acme/text" }] as never, {
      source: "acme",
    });
    const unusable = {
      ...heroPattern(),
      id: "broken",
      title: "Broken",
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: heroPattern().document.nodes,
      } as unknown as BlockDocument,
    };
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        patterns={[unusable, heroPattern()]}
      />
    );

    openTab("Sections");
    expect(tile("Hero")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Broken" })).toBeNull();
  });
});

describe("the component tier", () => {
  afterEach(() => {
    clearBlocks();
  });

  function headerComponent() {
    return {
      id: "header",
      title: "Header",
      category: "Sections",
      document: {
        formatVersion: 1,
        kind: "component",
        nodes: [{ id: "d1", type: "acme/text", version: 1, props: {} }],
      } as unknown as ComponentDocument,
    };
  }

  /** The canvas's lookup, holding these rows' definitions. */
  function lookupFor(
    ...rows: { id: string; document: ComponentDocument }[]
  ): Map<string, ComponentDocument> {
    return new Map(rows.map(row => [row.id, row.document]));
  }

  it("refuses a PATTERN whose root is an instance the destination refuses", () => {
    // A pattern is copied in as it stands, so a saved-from-a-component pattern
    // carries the instance node; judged by that node's own type it was offered
    // at the root while the component's own tile was refused there.
    registerBlocks(
      [
        { ...base, name: "acme/column", parent: ["acme/columns"] },
        { ...base, name: "acme/columns", slots: { children: {} } },
        { ...base, name: "acme/text", editor: { label: "Text" } },
      ] as never,
      { source: "acme" }
    );
    const column = {
      id: "column",
      title: "Column",
      document: {
        formatVersion: 1,
        kind: "component",
        nodes: [{ id: "d1", type: "acme/column", version: 1, props: {} }],
      } as unknown as ComponentDocument,
    };
    const wrapping = {
      id: "wrapped",
      title: "Wrapped column",
      document: {
        formatVersion: 1,
        kind: "pattern",
        nodes: [
          {
            id: "p1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "column" },
          },
        ],
      } as unknown as BlockDocument,
    };
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        patterns={[wrapping]}
        componentDefinitions={lookupFor(column)}
      />
    );

    openTab("Sections");
    const wrapped = tile("Wrapped column");
    expect(wrapped.getAttribute("data-refused")).toBe("true");
    expect(describedBy(wrapped)).toContain("A Column has to go inside");
  });

  it("PLACES a pattern whose nested instance draws what the slot admits", () => {
    // The click plans against the same lookup the tile was judged by. Without
    // it the planner reads the nested node as `nextly/component-instance`,
    // which a slot naming its admissions does not name — so the tile was
    // offered, the click planned nothing, and the panel closed on an
    // unchanged page with no reason given.
    registerBlocks(
      [
        {
          ...base,
          name: "acme/row",
          editor: { label: "Row" },
          slots: { children: { allow: ["acme/cell"] } },
        },
        { ...base, name: "acme/cell", editor: { label: "Cell" } },
      ] as never,
      { source: "acme" }
    );
    const cell = {
      id: "cellish",
      document: {
        formatVersion: 1,
        kind: "component",
        nodes: [{ id: "d1", type: "acme/cell", version: 1, props: {} }],
      } as unknown as ComponentDocument,
    };
    const holding = {
      id: "holding",
      title: "Row of one",
      document: {
        formatVersion: 1,
        kind: "pattern",
        nodes: [
          {
            id: "p1",
            type: "acme/row",
            version: 1,
            props: {},
            slots: {
              children: [
                {
                  id: "p2",
                  type: COMPONENT_INSTANCE_TYPE,
                  version: 1,
                  props: { componentId: "cellish" },
                },
              ],
            },
          },
        ],
      } as unknown as BlockDocument,
    };
    const editor = editorSpy(documentOf());
    render(
      <InsertPanel
        editor={editor}
        patterns={[holding]}
        componentDefinitions={lookupFor(cell)}
      />
    );

    openTab("Sections");
    fireEvent.click(screen.getByRole("option", { name: /Row of one/ }));

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("offers no component for which the host supplied no definition", () => {
    // A tile places an instance the canvas resolves against its lookup; with
    // no definition there, the instance would be drawn as missing the moment
    // it landed. The row alone is not enough to offer it.
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        components={[headerComponent()]}
      />
    );

    // The block tier is drawn — the control that the panel rendered at all.
    expect(screen.getByRole("option", { name: /Text/ })).toBeDefined();
    expect(screen.queryByRole("option", { name: /Header/ })).toBeNull();
  });

  it("offers the site's components together under Your components, after the library's categories", () => {
    /*
     * The row says "Sections", and a component still goes under the one
     * components group, with the component mark: an author looks for the
     * site's own pieces apart from the library's blocks. No tier badge and no
     * tier sentence: the description is the component's own.
     */
    registerBlocks(
      [
        { ...base, name: "acme/text", editor: { label: "Text" } },
        {
          ...base,
          name: "acme/box",
          editor: { label: "Box", category: "layout" },
        },
      ] as never,
      { source: "acme" }
    );
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        categoryOrder={["layout"]}
        components={[{ ...headerComponent(), description: "The site header." }]}
        componentDefinitions={lookupFor(headerComponent())}
      />
    );

    const groups = [...document.querySelectorAll("[cmdk-group]")].map(
      group => ({
        heading: group.querySelector("[cmdk-group-heading]")?.textContent,
        options: [...group.querySelectorAll("[role=option]")].map(option =>
          option.getAttribute("aria-label")
        ),
      })
    );
    expect(groups).toEqual([
      { heading: "Layout", options: ["Box"] },
      { heading: "Your components", options: ["Header"] },
      { heading: "More blocks", options: ["Text"] },
    ]);
    const header = tile("Header");
    expect(header.querySelector(".nx-block-icon svg")).not.toBeNull();
    expect(header.querySelector(".nx-insert-panel__tier")).toBeNull();
    expect(describedBy(header)).toBe("The site header.");
  });

  it("finds a component by search, in the Blocks tab", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        components={[headerComponent()]}
        componentDefinitions={lookupFor(headerComponent())}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Insert a block" }), {
      target: { value: "Head" },
    });

    expect(tile("Header")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Text" })).toBeNull();
  });

  it("places a chosen component as ONE instance node, copying nothing", () => {
    registerBlocks([{ ...base, name: "acme/text" }] as never, {
      source: "acme",
    });
    const editor = editorSpy(documentOf());
    const onInsert = vi.fn();
    render(
      <InsertPanel
        editor={editor}
        components={[headerComponent()]}
        componentDefinitions={lookupFor(headerComponent())}
        onInsert={onInsert}
      />
    );

    fireEvent.click(screen.getByRole("option", { name: /Header/ }));

    // `apply` and not `applyAll`: an instance is one node, not a forest, and
    // there is nothing to plan — the definition's content stays where it is.
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(editor.apply).toHaveBeenCalledTimes(1);
    const op = editor.apply.mock.calls[0][0] as {
      kind: string;
      node: { id: string; type: string; props: unknown; slots?: unknown };
    };
    expect(op.kind).toBe("insert");
    expect(op.node.type).toBe(COMPONENT_INSTANCE_TYPE);
    expect(op.node.props).toEqual({ componentId: "header" });
    // Nothing of the definition's tree travelled into the page.
    expect(op.node.slots).toBeUndefined();
    expect(op.node.id).not.toBe("d1");
    expect(editor.select).toHaveBeenCalledWith(op.node.id);
    expect(onInsert).toHaveBeenCalledWith(op.node);
  });

  it("keeps a component the destination could not take in view, saying why", () => {
    // Judged by the definition's ROOT. A column may only live inside columns,
    // and this page's insertion point is the root — so the tile is refused,
    // with the rule's reason, and its click inserts nothing.
    registerBlocks(
      [
        { ...base, name: "acme/text" },
        { ...base, name: "acme/column", parent: ["acme/columns"] },
      ] as never,
      { source: "acme" }
    );
    const columnOnly = {
      ...headerComponent(),
      id: "col",
      title: "Column card",
      document: {
        formatVersion: 1,
        kind: "component",
        nodes: [{ id: "d1", type: "acme/column", version: 1, props: {} }],
      } as unknown as ComponentDocument,
    };
    const editor = editorSpy(documentOf());
    render(
      <InsertPanel
        editor={editor}
        components={[columnOnly, headerComponent()]}
        componentDefinitions={lookupFor(columnOnly, headerComponent())}
      />
    );

    expect(tile("Header").getAttribute("data-refused")).toBeNull();
    const card = tile("Column card");
    expect(card.getAttribute("data-refused")).toBe("true");
    // A component is not dragged, so the instruction offers only selecting.
    expect(describedBy(card)).toContain(
      "Goes inside a Columns. Select a Columns first."
    );
    expect(describedBy(card)).not.toContain("drag");
    fireEvent.click(card);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("hands a placement to the editor's apply, which is what judges the page's room for it", () => {
    // The tile is offered — room is a property of the page, not of the
    // definition — and the insert asks the resolver with the node in place.
    // A page of two nodes under a cap of four cannot hold a three-node
    // definition composed, so nothing is applied and the author is told.
    registerBlocks([{ ...base, name: "acme/text" }] as never, {
      source: "acme",
    });
    const three = {
      ...headerComponent(),
      id: "three",
      title: "Three up",
      document: {
        formatVersion: 1,
        kind: "component",
        nodes: [1, 2, 3].map(n => ({
          id: `d${n}`,
          type: "acme/text",
          version: 1,
          props: {},
        })),
      } as unknown as ComponentDocument,
    };
    const page = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "p1", type: "acme/text", version: 1, props: {} },
        { id: "p2", type: "acme/text", version: 1, props: {} },
      ],
    } as unknown as BlockDocument;
    // Room is the EDITOR's question, asked of every accepted group by its own
    // apply under the caps it enforces; the panel hands the insert over and
    // treats a null as the refusal it is. Pinned here so the panel cannot
    // grow a second answer in front of that one.
    const editor = editorSpy(page, { ...DEFAULT_LIMITS, maxNodes: 4 });
    render(
      <InsertPanel
        editor={editor}
        components={[three]}
        componentDefinitions={new Map([["three", three.document]])}
      />
    );

    fireEvent.click(screen.getByRole("option", { name: /Three up/ }));

    expect(editor.apply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "insert" })
    );
  });

  it("resolves a definition's own instances through the CANVAS's lookup before offering it", () => {
    // A definition whose root is an instance of another component is judged by
    // what that instance draws — and can only be once the lookup the canvas
    // resolves against is handed in. Without it the root cannot be determined
    // and the tile is withheld; with it, the root is the header's text and the
    // page root takes it.
    registerBlocks([{ ...base, name: "acme/text" }] as never, {
      source: "acme",
    });
    const header = headerComponent();
    const wrapper = {
      ...headerComponent(),
      id: "wrapper",
      title: "Wrapped header",
      document: {
        formatVersion: 1,
        kind: "component",
        nodes: [
          {
            id: "w1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "header" },
          },
        ],
      } as unknown as ComponentDocument,
    };

    const { unmount } = render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        components={[wrapper]}
        // The wrapper is in the lookup; only what its root names is not.
        componentDefinitions={lookupFor(wrapper)}
      />
    );
    expect(screen.queryByRole("option", { name: /Wrapped header/ })).toBeNull();
    unmount();

    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        components={[wrapper]}
        componentDefinitions={lookupFor(header, wrapper)}
      />
    );
    expect(screen.getByRole("option", { name: /Wrapped header/ })).toBeTruthy();
  });
});

describe("when the library was cut, or could not be read", () => {
  afterEach(() => {
    clearBlocks();
  });

  /** The notices, or none: they are status regions, so that is how they are found. */
  function notices(): HTMLElement[] {
    return screen.queryAllByRole("status");
  }

  it("says nothing when every tier arrived whole, or is still arriving", () => {
    // The control for the cases below, and the ordinary state: a notice that
    // was always on screen would be one an author learns to read past.
    render(<InsertPanel editor={editorSpy(documentOf())} />);
    expect(notices()).toEqual([]);

    cleanup();
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        library={{ patterns: "ready", components: "ready" }}
      />
    );
    expect(notices()).toEqual([]);
  });

  it("names the component tier as cut, and says what a left-out component looks like on the page", () => {
    // The second sentence is the one nothing else says: an instance of a
    // component the read left out draws as could-not-be-loaded, which without
    // this reads as a component somebody deleted.
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        library={{ components: "cut" }}
      />
    );

    const [status] = notices();
    expect(status?.textContent).toContain("some components are not offered");
    expect(status?.textContent).toContain("could not be loaded");
    expect(status?.textContent).not.toContain("patterns");
  });

  it("names the pattern tier as cut without the sentence about the page", () => {
    // A pattern left out is one the author cannot insert and nothing more: it
    // was copied into the page when placed, so no instance of it can be
    // waiting on the library.
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        library={{ patterns: "cut" }}
      />
    );
    // Patterns are offered on the Sections tab, so that is where it is said.
    openTab("Sections");

    const [status] = notices();
    expect(status?.textContent).toContain("some patterns are not offered");
    expect(status?.textContent).not.toContain("could not be loaded");
  });

  it("says each tier's state in the tab that offers it, and only there", () => {
    // Components are among the blocks and patterns are sections, so a tab
    // never reports content that could not appear in it.
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        library={{ patterns: "cut", components: "cut" }}
      />
    );

    expect(notices()).toHaveLength(1);
    expect(notices()[0]?.textContent).toContain(
      "some components are not offered"
    );
    expect(notices()[0]?.textContent).not.toContain("patterns");

    openTab("Sections");
    expect(notices()).toHaveLength(1);
    expect(notices()[0]?.textContent).toContain(
      "some patterns are not offered"
    );
    expect(notices()[0]?.textContent).not.toContain("components");
  });

  it("says when a tier could not be read at all, apart from a cut one, and offers the retry", () => {
    // Two different sentences for two different states — "some were left
    // out" and "none could be loaded" — and only the second has a remedy the
    // author can reach from here.
    const retry = vi.fn();
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        library={{ patterns: "cut", components: "unavailable", retry }}
      />
    );

    const [unavailable] = notices();
    expect(unavailable?.textContent).toContain(
      "components could not be loaded, so none are offered"
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    openTab("Sections");
    const [cut] = notices();
    expect(cut?.textContent).toContain("some patterns are not offered");
  });

  it("says when a tier could not be RE-read, apart from one never read, and offers the retry", () => {
    // A third sentence for a third state. The tiles are the last answer the
    // host holds, so "none are offered" would be false beside them; what is
    // true is that they may be out of date, and that a component on the page
    // draws as it was rather than as it is.
    const retry = vi.fn();
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        library={{ patterns: "stale", components: "stale", retry }}
      />
    );

    const [stale] = notices();
    expect(stale?.textContent).toContain(
      "components could not be reloaded, so those offered may be out of date"
    );
    expect(stale?.textContent).toContain("draws as it was");
    expect(stale?.textContent).not.toContain("none are offered");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("leaves the page sentence off a stale pattern tier", () => {
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        library={{ patterns: "stale" }}
      />
    );
    openTab("Sections");

    expect(notices()[0]?.textContent).toContain(
      "patterns could not be reloaded"
    );
    expect(notices()[0]?.textContent).not.toContain("draws as it was");
  });

  it("offers no retry when the host supplied none", () => {
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        library={{ components: "unavailable" }}
      />
    );

    expect(notices()[0]?.textContent).toContain("could not be loaded");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("the offer under the one placement rule", () => {
  /** A card whose link makes it refuse anything clickable beneath it. */
  const linkableCard = {
    ...base,
    name: "t/card",
    editor: { label: "Card" },
    slots: { children: {} },
    contentModel: (props: { link?: string }) =>
      props.link
        ? { is: ["flow", "interactive"], accepts: { without: ["interactive"] } }
        : { is: ["flow"] },
  };
  const button = {
    ...base,
    name: "t/button",
    editor: { label: "Button" },
    contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
  };
  const heading = { ...base, name: "t/heading", editor: { label: "Heading" } };
  const linkedCard = {
    id: "card",
    type: "t/card",
    version: 1,
    props: { link: "/go" },
  };

  it("judges the point by the palette's own definitions, not the registry's", () => {
    /*
     * The registry holds a Card with no content model; the palette is handed
     * the Card that refuses clickable blocks when linked. The catalog and the
     * insert both read the palette's, so the placement rule must too: judged
     * by the registry's Card, the Button is offered and its insert would build
     * a link inside a link.
     *
     * Added INSIDE the card, through the + gesture's `inside`: after it, at the
     * page's root, a Button is welcome whichever Card is read.
     */
    registerBlocks(
      [
        { ...base, name: "t/card", slots: { children: {} } },
        button,
        heading,
      ] as never,
      { source: "test" }
    );
    const editor = {
      ...editorSpy(documentOf([linkedCard] as never)),
      selectedId: "card",
    } as unknown as ReturnType<typeof editorSpy>;
    render(
      <InsertPanel
        editor={editor}
        definitions={[linkableCard, button, heading] as never}
        inside="card"
      />
    );

    // The point is inside the card: the Heading is offered there, the Button
    // refused.
    expect(tile("Heading").getAttribute("data-refused")).toBeNull();
    expect(tile("Button").getAttribute("data-refused")).toBe("true");
  });

  it("asks the placement rule nothing again while the author types", () => {
    /*
     * The verdict depends on the document, the point, the catalog and the
     * rule's sources, none of which a keystroke changes. Counted through the
     * nesting source every verdict reads: re-judging the catalog per keystroke
     * reads it again for every entry.
     */
    registerBlocks([button, heading] as never, { source: "test" });
    let asked = 0;
    const nesting = {
      parentsOf: () => {
        asked += 1;
        return undefined;
      },
      slotAllowOf: () => {
        asked += 1;
        return undefined;
      },
    };
    render(<InsertPanel editor={editorSpy(documentOf())} nesting={nesting} />);
    // The control: the first render did ask, so the count can move.
    expect(asked).toBeGreaterThan(0);
    const before = asked;

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "He" } });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Hea" },
    });

    // The query did narrow the rows, so the renders really happened.
    expect(screen.queryByRole("option", { name: "Button" })).toBeNull();
    expect(asked).toBe(before);
  });
});
