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

    // The OPTION rather than its label text: the description strip repeats the
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

  it("describes the tile the highlight is on, before anything is touched", () => {
    // The strip is the only place a sighted author reads the sentence now, so
    // a panel that opened with it blank would have removed the information
    // rather than moved it.
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    expect(strip()).toBe("B0 Block number 0.");
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
    expect(strip()).toBe("B4 Block number 4.");

    fireEvent.change(input, { target: { value: "B0" } });

    // B4 is gone from the document. Whatever the field now announces, it must
    // not be B4 — resolving to nothing is the failure being excluded.
    const after = input.getAttribute("aria-activedescendant");
    if (after !== null) {
      expect(document.getElementById(after)).not.toBeNull();
    }
    expect(strip()).toBe("B0 Block number 0.");
  });

  it("keeps a tile's token when the DEFINITIONS around it change", () => {
    /*
     * A host may replace `definitions` while the panel is mounted. Tokens
     * taken from an entry's POSITION would then be reassigned — inserting one
     * definition shifts every entry after it — so the same string would name a
     * different block while the palette is still holding it, and the strip
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

  it("returns the strip to the TOP when it changes subject", () => {
    /*
     * The strip is scrollable and React reuses the same element as the
     * highlight moves, so a description that was scrolled leaves the next one
     * opening partway through its own text — the block's name and first lines
     * above the fold, the reader looking at the middle of a sentence about a
     * block they have only just pointed at.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    const body = document.querySelector(
      ".nx-insert-panel__describes"
    ) as HTMLElement;
    expect(body).not.toBeNull();
    body.scrollTop = 40;
    // The control: jsdom computes no layout, so an element with no overflow
    // refuses a non-zero scrollTop and the assertion below would pass on an
    // element that was never scrolled.
    expect(body.scrollTop).toBe(40);

    fireEvent.pointerMove(tile("B4"));

    expect(body.scrollTop).toBe(0);
  });

  it("becomes keyboard-reachable ONLY while it is hiding text", () => {
    /*
     * The strip is bounded and scrollable, so a description longer than the box
     * has a tail a pointer can scroll to and a keyboard cannot — focus stays in
     * the search field and nothing can direct a scroll here.
     *
     * Both states are asserted, and the not-clipped one is what stops this
     * becoming an argument for a permanent tab stop. A stop between the search
     * field and the tiles costs every author a keystroke on the way to what
     * they came for, and buys nothing when the whole sentence is visible.
     *
     * Overflow is FORCED rather than produced by a long description, because
     * jsdom lays nothing out: `scrollHeight` and `clientHeight` are both 0 for
     * every element, so a real 400-character description overflows by exactly
     * as much as a short one — that is, not at all. Defining the two
     * properties is what puts the branch under test.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);

    const body = document.querySelector(
      ".nx-insert-panel__describes"
    ) as HTMLElement;
    expect(body).not.toBeNull();

    // Not clipped: hidden from assistive technology and out of the tab order.
    expect(body.getAttribute("aria-hidden")).toBe("true");
    expect(body.getAttribute("tabindex")).toBeNull();

    Object.defineProperty(body, "scrollHeight", {
      value: 200,
      configurable: true,
    });
    Object.defineProperty(body, "clientHeight", {
      value: 80,
      configurable: true,
    });
    fireEvent.pointerMove(tile("B4"));

    const after = document.querySelector(
      ".nx-insert-panel__describes"
    ) as HTMLElement;
    expect(after.getAttribute("tabindex")).toBe("0");
    // A focusable element must not be hidden from the tree it is focusable in,
    // and arriving somewhere unlabelled is its own defect.
    expect(after.getAttribute("aria-hidden")).toBeNull();
    expect(after.getAttribute("aria-label")).toBe("Block description");
  });

  /**
   * Force the strip to report that its content overflows its box.
   *
   * jsdom lays nothing out, so `scrollHeight` and `clientHeight` are 0 on every
   * element and a 400-character description overflows by exactly as much as a
   * short one — which is to say not at all. Defining the two properties is what
   * puts the branch under test at all.
   */
  function forceOverflow(element: HTMLElement, overflowing: boolean): void {
    Object.defineProperty(element, "scrollHeight", {
      value: overflowing ? 200 : 40,
      configurable: true,
    });
    Object.defineProperty(element, "clientHeight", {
      value: 80,
      configurable: true,
    });
  }

  /** Install a `ResizeObserver` whose callback the test can fire on demand. */
  function drivableObserver(): { fire: () => void; restore: () => void } {
    const previous = globalThis.ResizeObserver;
    let callback: (() => void) | undefined;
    globalThis.ResizeObserver = class {
      constructor(fn: () => void) {
        callback = fn;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    return {
      fire: () => {
        callback?.();
      },
      restore: () => {
        globalThis.ResizeObserver = previous;
      },
    };
  }

  it("re-measures when the STRIP RESIZES, with no change of subject", () => {
    /*
     * The panel is resizable, and browser zoom and font size move the box too.
     * None of those re-render anything here, so a measurement taken only when
     * the described block changes leaves a newly overflowing description out of
     * the tab order with its tail unreachable — and leaves a dead focus stop
     * behind when it stops overflowing.
     *
     * The subject deliberately never changes in this case. That is the whole
     * property: a measurement keyed on the subject cannot see this.
     */
    const observer = drivableObserver();
    try {
      sevenBlocks();
      render(<InsertPanel editor={editorSpy(documentOf())} />);
      const body = document.querySelector(
        ".nx-insert-panel__describes"
      ) as HTMLElement;
      expect(body.getAttribute("tabindex")).toBeNull();

      forceOverflow(body, true);
      act(() => {
        observer.fire();
      });

      expect(
        (
          document.querySelector(".nx-insert-panel__describes") as HTMLElement
        ).getAttribute("tabindex")
      ).toBe("0");

      // And back again, so this is not a one-way latch that accumulates focus
      // stops as an author drags the panel about.
      forceOverflow(body, false);
      act(() => {
        observer.fire();
      });
      expect(
        (
          document.querySelector(".nx-insert-panel__describes") as HTMLElement
        ).getAttribute("tabindex")
      ).toBeNull();
    } finally {
      observer.restore();
    }
  });

  it("re-measures when the DESCRIPTION changes but the block does not", () => {
    /*
     * The other half, and a `ResizeObserver` cannot see it: a longer sentence
     * inside a strip already at its bound grows `scrollHeight` while the border
     * box stays exactly where it was, so the observer never fires. The entry's
     * id is the BLOCK NAME, so replacing a definition's description leaves the
     * subject unchanged too.
     *
     * A measurement keyed on the subject is therefore blind to this, which is
     * why the effect carries no dependency list.
     */
    const defs = (description: string) =>
      [
        {
          ...base,
          name: "acme/solo",
          description,
          editor: { label: "Solo", category: "Layout" },
        },
      ] as never;

    const view = render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        definitions={defs("Short.")}
      />
    );
    const body = document.querySelector(
      ".nx-insert-panel__describes"
    ) as HTMLElement;
    forceOverflow(body, false);
    expect(body.getAttribute("tabindex")).toBeNull();

    forceOverflow(body, true);
    view.rerender(
      <InsertPanel
        editor={editorSpy(documentOf())}
        definitions={defs("A much longer sentence about the very same block.")}
      />
    );

    // Same block, same id, same box — only the text grew.
    expect(
      (
        document.querySelector(".nx-insert-panel__describes") as HTMLElement
      ).getAttribute("tabindex")
    ).toBe("0");
  });

  it("bounds the strip, so a long description cannot eat the palette", () => {
    /*
     * Asserted against the stylesheet for the same reason the `touch-action`
     * case above is: jsdom computes no layout, so every element reports zero
     * height and a case driving a long description through the DOM would pass
     * with the bound deleted.
     *
     * The failure is a valid input, not a malformed one. Nothing caps a
     * `BlockDefinition.description`, and the command root is `h-full` with
     * `overflow-hidden` — so an unshrinkable strip claims its full content
     * height, squeezes the tile list toward zero, and then clips its own
     * overflow with no way to scroll to it. One long-winded plugin hides every
     * block in the palette and is itself unreadable.
     */
    const css = readFileSync(
      join(process.cwd(), "src/styles/builder-chrome.css"),
      "utf8"
    );
    const rule = css.slice(css.indexOf(".nx-insert-panel__describes {"));
    // COMMENTS STRIPPED, because the block's own comment names the
    // declaration it exists to forbid — searching the raw text finds the prose
    // and reports a violation that is not there.
    const block = rule
      .slice(0, rule.indexOf("}"))
      .replace(/\/\*[\s\S]*?\*\//g, "");

    // Population first: a renamed selector leaves every assertion below
    // reading an empty string, and "the forbidden value is absent" passes on
    // nothing at all.
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain("max-height:");
    expect(block).toContain("overflow-y: auto;");
    // `flex: none` is the specific declaration that made it unshrinkable, and
    // it is what a later edit would most naturally reintroduce.
    expect(block).not.toContain("flex: none");
  });

  /** One definition with a description, so the strip and tiles both draw. */
  const described = [
    {
      ...base,
      name: "acme/solo",
      description: "A block with a description, so the strip renders.",
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

  it("keeps the hint OUT of the scrollable strip", () => {
    /*
     * Structural, because the failure is positional: the strip is bounded and
     * scrolls, so a line placed inside it leaves the viewport exactly when the
     * description is long — and the authors reading the longest descriptions
     * are the ones who most need to know what a lift does.
     */
    render(
      <InsertPanel editor={editorSpy(documentOf())} definitions={described} />
    );
    pressTile("touch");

    const strip = document.querySelector(".nx-insert-panel__describes");
    const hint = document.querySelector(".nx-insert-panel__gesture-hint");
    expect(strip).not.toBeNull();
    expect(hint).not.toBeNull();
    expect(strip?.contains(hint as Node)).toBe(false);
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
     * a case checking only the strip would pass against a panel that describes
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
    expect(strip()).toBe("Spacious A card.");

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
     * what the primitives report a highlight from — so on touch the strip
     * would describe whatever was current when the panel opened, and the tap
     * that finally moved it is the same tap that inserts.
     *
     * Driven with `pointerDown` and NOT `pointerMove`, because pointer-move is
     * the path that already worked: a case using it would pass against the
     * defect it is written for.
     */
    sevenBlocks();
    render(<InsertPanel editor={editorSpy(documentOf())} />);
    expect(strip()).toBe("B0 Block number 0.");

    fireEvent.pointerDown(tile("B4"), { button: 0, pointerId: 1 });

    expect(strip()).toBe("B4 Block number 4.");
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

    expect(strip()).toBe("B1 Block number 1.");
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
    expect(strip()).toBe("B0 Block number 0.");

    // The control: the same panel, a key the primitives DO bind, and the
    // highlight moves. Without it an inert panel satisfies the assertion above.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(strip()).toBe("B1 Block number 1.");
  });

  it("leaves a MODIFIED arrow to the command primitives", () => {
    // They bind first, last and by-group to the modified arrows. Meta+Down is
    // theirs and means "last".
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
