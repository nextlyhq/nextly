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
