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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { InsertPanel } from "./insert-panel";
import type { EditorState } from "./editor-state";

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
function editorSpy(document: BlockDocument): EditorState & {
  apply: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
} {
  return {
    document,
    selectedId: null,
    select: vi.fn(),
    apply: vi.fn(() => document),
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

describe("InsertPanel", () => {
  it("inserts the block a chosen row names, at the derived position", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    const onInsert = vi.fn();
    render(<InsertPanel editor={editor} onInsert={onInsert} />);

    fireEvent.click(screen.getByText("Text"));

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

    fireEvent.pointerDown(screen.getByText("Text"), {
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

    fireEvent.pointerDown(screen.getByText("Text"), {
      button: 0,
      pointerId: 1,
    });
    fireEvent.click(screen.getByText("Text"));

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

    fireEvent.click(screen.getByText("Row"));

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

    fireEvent.click(screen.getByText("Row"));

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

    fireEvent.click(screen.getByText("Text"));

    expect(editor.apply.mock.calls[0][0].at).toEqual({ index: 2 });
  });

  it("selects what it inserted, so a second insert lands after the first", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    const editor = editorSpy(documentOf());
    render(<InsertPanel editor={editor} />);

    fireEvent.click(screen.getByText("Text"));

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

    fireEvent.click(screen.getByText("Text"));

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

    fireEvent.change(screen.getByPlaceholderText("Search blocks"), {
      target: { value: "Picture" },
    });

    expect(screen.getByText("Picture")).toBeTruthy();
    expect(screen.queryByText("Heading")).toBeNull();
  });

  it("says nothing matched, distinctly from nothing being placeable", () => {
    registerBlocks(
      [{ ...base, name: "acme/text", editor: { label: "Text" } }] as never,
      { source: "acme" }
    );
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.change(screen.getByPlaceholderText("Search blocks"), {
      target: { value: "nonexistent" },
    });

    expect(screen.getByText(/No blocks match/)).toBeTruthy();
  });

  it("offers only what the target admits, and inserts none of the rest", () => {
    // The rule reaches the rendered list, rather than being applied somewhere
    // the panel then ignores. `acme/column` may only sit in `acme/columns`, and
    // the position here is the document root.
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
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    // Both halves: the refused entry is absent AND the permitted one is
    // present. Asserting only the absence passes on a panel that renders
    // nothing at all.
    expect(screen.getByText("Columns")).toBeTruthy();
    expect(screen.queryByText("Column")).toBeNull();
  });
});
