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

/**
 * The tile offering a block, addressed as the option it is.
 *
 * By ROLE and by an EXACT name, rather than by text. A text query matches the
 * tile and the description strip alike — the strip repeats the name of
 * whichever tile is current — and refuses on the ambiguity. The exact name is
 * available because the tile states its own: the block's sentence is its
 * description now, not part of what it is called.
 */
function tile(name: string): HTMLElement {
  return screen.getByRole("option", { name });
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

    fireEvent.change(screen.getByPlaceholderText("Search blocks"), {
      target: { value: "Picture" },
    });

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
    expect(tile("Columns")).toBeTruthy();
    expect(screen.queryAllByRole("option", { name: /^Column\b/ })).toHaveLength(
      0
    );
  });
});

describe("the grid, and the strip that describes it", () => {
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

  /** The strip's text, or null where it is not rendered at all. */
  function strip(): string | null {
    return (
      document.querySelector(".nx-insert-panel__describes")?.textContent ?? null
    );
  }

  function search(): HTMLElement {
    return screen.getByPlaceholderText("Search blocks");
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

  it("describes the tile the highlight is on, before anything is touched", () => {
    // The strip is the only place a sighted author reads the sentence now, so
    // a panel that opened with it blank would have removed the information
    // rather than moved it.
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    expect(strip()).toBe("B0 Block number 0.");
  });

  it("moves DOWN by a row, not by one tile", () => {
    /*
     * The whole point of the grid being a grid. Three columns, so the tile
     * below B0 is B3 — a panel that kept the list's linear navigation would
     * answer B1, which is the tile to its RIGHT.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.keyDown(search(), { key: "ArrowDown" });

    expect(strip()).toBe("B3 Block number 3.");
  });

  it("moves RIGHT by one tile once the search field has no use for the key", () => {
    // The field is empty, so there is no caret to move and the key is the
    // grid's.
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.keyDown(search(), { key: "ArrowRight" });

    expect(strip()).toBe("B1 Block number 1.");
  });

  it("leaves a horizontal arrow to the SEARCH FIELD while a caret can move", () => {
    /*
     * Focus stays in the search box while the highlight moves, so a panel that
     * claimed Left and Right outright would make the box uneditable: an author
     * correcting a typo would move the tile selection instead of the caret.
     *
     * Asserted against the same key succeeding once the caret is at the end,
     * because an assertion that the highlight did not move is satisfied by a
     * handler that never runs at all.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    const input = search();
    fireEvent.change(input, { target: { value: "b" } });
    (input as HTMLInputElement).setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(strip()).toBe("B0 Block number 0.");

    (input as HTMLInputElement).setSelectionRange(1, 1);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(strip()).toBe("B1 Block number 1.");
  });

  it("leaves a MODIFIED arrow to the command primitives", () => {
    /*
     * They bind first, last and by-group to the modified arrows, and this
     * handler runs before theirs — so claiming a modified key would remove a
     * binding silently. Meta+Down is theirs and means "last".
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.keyDown(search(), { key: "ArrowDown", metaKey: true });

    expect(strip()).toBe("B6 Block number 6.");
  });

  it("follows the POINTER as well as the keyboard, through one piece of state", () => {
    // The primitives highlight on pointer move and report it the same way they
    // report an arrow key, which is what lets one value drive the strip. A
    // panel tracking hover separately would hold a second answer.
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.pointerMove(tile("B4"));

    expect(strip()).toBe("B4 Block number 4.");
  });

  it("shows NO strip when nothing can be offered", () => {
    // There is no tile to describe, and a strip left standing would describe
    // whichever block was current before the search emptied the list.
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    fireEvent.change(search(), { target: { value: "nothing matches this" } });

    expect(strip()).toBeNull();
    expect(screen.getByText(/No blocks match/)).toBeTruthy();
  });
});
