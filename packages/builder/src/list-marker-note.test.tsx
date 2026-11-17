// @vitest-environment jsdom

/**
 * A List's own marker, said under "List as" with a Clear, and Clear taking it
 * away wherever it is stored, so the list's kind decides its marker again.
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  customMarkerAt,
  ListMarkerNote,
  planClearMarker,
} from "./list-marker-note";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import type { BuilderOp } from "./op-vocabulary";
import { applyOp } from "./ops";

beforeAll(() =>
  registerBlocks(
    [
      {
        name: "core/list",
        version: 1,
        description: "A list.",
        example: { props: {} },
        editor: { label: "List" },
        props: {
          kind: {
            label: "List as",
            type: "select",
            options: ["unordered", "ordered"],
          },
        },
        supports: { list: true },
        render: () => null,
      },
    ] as never,
    { source: "list-marker-note-test" }
  )
);
afterAll(clearBlocks);
afterEach(cleanup);

const list = (styles?: BlockNode["styles"]): BlockNode => ({
  id: "l",
  type: "core/list",
  version: 1,
  props: { kind: "unordered" },
  ...(styles === undefined ? {} : { styles }),
});

/** The node after the op, through the real store. */
function applied(before: BlockNode, op: BuilderOp | null): BlockNode {
  if (op === null) return before;
  const document = applyOp(
    { formatVersion: 1, kind: "page", nodes: [before] } as unknown as BlockDocument,
    op
  ).document;
  return document.nodes[0] as BlockNode;
}

describe("a List's own marker", () => {
  it("is found at each state and device it is stored at", () => {
    const node = list({
      base: { base: { listStyleType: "square" }, sm: { color: "red" } },
      hover: { md: { listStyleType: "circle" } },
    });
    expect(customMarkerAt(node)).toEqual([
      { state: "base", breakpoint: "base" },
      { state: "hover", breakpoint: "md" },
    ]);
  });

  it("is cleared everywhere at once, leaving the rest of the styles", () => {
    const node = list({
      base: {
        base: { listStyleType: "square", color: "red" },
        md: { listStyleType: "circle" },
      },
    });
    const after = applied(node, planClearMarker(node));
    expect(customMarkerAt(after)).toEqual([]);
    expect(after.styles?.base?.base?.color).toBe("red");
  });

  it("clears nothing on a list without one", () => {
    expect(planClearMarker(list())).toBeNull();
  });
});

describe("Custom marker under List as", () => {
  it("says the marker is custom, and Clear applies the clear", () => {
    const onApply = vi.fn(() => true);
    const node = list({ base: { base: { listStyleType: "square" } } });
    render(<ListMarkerNote node={node} disabled={false} onApply={onApply} />);
    expect(screen.getByText(/Custom marker/)).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear the custom marker" })
    );
    expect(onApply).toHaveBeenCalledWith(planClearMarker(node));
  });

  it("is not drawn on a list whose kind decides its marker", () => {
    render(<ListMarkerNote node={list()} disabled={false} onApply={vi.fn()} />);
    expect(screen.queryByText(/Custom marker/)).toBeNull();
  });

  it("holds Clear where the block's styles are locked", () => {
    const node = list({ base: { base: { listStyleType: "square" } } });
    render(<ListMarkerNote node={node} disabled onApply={vi.fn()} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Clear the custom marker",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});

describe("the note in the block panel", () => {
  /** A List selected in the panel, with the styles it stores. */
  function drawn(node: BlockNode) {
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [node],
    } as BlockDocument;
    const apply = vi.fn(() => document);
    render(
      <InspectorPanel
        editor={
          {
            document,
            selectedId: node.id,
            selection: { ids: [node.id], primary: node.id },
            applyAll: vi.fn(() => document),
            select: vi.fn(),
            apply,
            undo: vi.fn(),
            redo: vi.fn(),
            canUndo: false,
            canRedo: false,
            undoDepth: 0,
            composed: () => undefined,
          } as unknown as EditorState
        }
      />
    );
    return apply;
  }

  it("is under List as in Content, and Clear clears the marker", () => {
    const node = list({ base: { base: { listStyleType: "square" } } });
    const apply = drawn(node);
    const kind = screen.getByRole("radiogroup", { name: "List as" });
    const note = screen.getByText(/Custom marker/);
    // After the field it speaks of, in the document's order.
    expect(
      kind.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear the custom marker" })
    );
    expect(apply).toHaveBeenCalledWith(planClearMarker(node));
  });
});
