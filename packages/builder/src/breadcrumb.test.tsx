// @vitest-environment jsdom

/**
 * The ancestor breadcrumb.
 *
 * The trail itself comes from `pathTo`, which is asserted in `layers.test.ts`
 * without a DOM. What is only true here is what the component does with it:
 * which crumb is marked current, that every crumb changes the selection, and
 * that an empty path renders nothing rather than an empty bar.
 *
 * @module breadcrumb.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { SelectionBreadcrumb } from "./breadcrumb";
import { useEditorState, type EditorState } from "./editor-state";

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

function register() {
  if (hasBlock("core/heading")) return;
  registerBlocks(
    [
      { ...base, name: "core/heading", editor: { label: "Heading" } },
      {
        ...base,
        name: "core/box",
        editor: { label: "Box" },
        slots: { children: {} },
      },
    ] as never,
    { source: "breadcrumb-test" }
  );
}

function node(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props: {}, ...extra } as BlockNode;
}

/** A heading two containers deep, so the trail has three crumbs. */
function documentOf(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      node("outer", "core/box", {
        name: "Section",
        slots: {
          children: [
            node("inner", "core/box", {
              slots: { children: [node("leaf", "core/heading")] },
            }),
          ],
        },
      }),
    ],
  } as BlockDocument;
}

let editorRef: EditorState | null = null;

function Host(): React.JSX.Element {
  const editor = useEditorState({ initialDocument: documentOf() });
  editorRef = editor;
  return <SelectionBreadcrumb editor={editor} />;
}

function crumbs(): string[] {
  return screen.queryAllByRole("button").map(b => b.textContent ?? "");
}

describe("SelectionBreadcrumb", () => {
  it("reads outermost first and ends with the selected block", () => {
    register();
    render(<Host />);
    React.act(() => {
      editorRef?.select("leaf");
    });

    // The instance name where the author gave one, the block's name otherwise —
    // the same rule the palette and the layers panel use.
    expect(crumbs()).toEqual(["Section", "Box", "Heading"]);
  });

  it("marks the last crumb as the current position, and only the last", () => {
    register();
    render(<Host />);
    React.act(() => {
      editorRef?.select("leaf");
    });

    const marked = screen
      .getAllByRole("button")
      .map(b => b.getAttribute("aria-current"));

    expect(marked).toEqual([null, null, "true"]);
  });

  it("selects the ancestor a crumb names", () => {
    // The reason the trail is buttons rather than text. A full-width container
    // is almost entirely covered by its own children, so reaching it on the
    // canvas means finding a margin.
    register();
    render(<Host />);
    React.act(() => {
      editorRef?.select("leaf");
    });

    React.act(() => {
      fireEvent.click(screen.getAllByRole("button")[0] as HTMLElement);
    });

    expect(editorRef?.selectedId).toBe("outer");
  });

  it("renders nothing at all when there is no selection", () => {
    // Nothing rather than an empty bar: a bar would reserve height for a trail
    // that is not there, so clearing a selection would resize the canvas.
    register();
    const { container } = render(<Host />);

    expect(crumbs()).toEqual([]);
    expect(container.querySelector(".nx-breadcrumb")).toBeNull();
  });

  it("renders nothing for a selection the document no longer holds", () => {
    // Routine rather than exotic: an undo can remove the selected node while
    // the selection stands, and a partial trail would name ancestors of a block
    // that is gone.
    register();
    render(<Host />);
    React.act(() => {
      editorRef?.select("leaf");
    });
    expect(crumbs()).toHaveLength(3);

    React.act(() => {
      editorRef?.apply({ kind: "remove", id: "outer" });
    });

    expect(crumbs()).toEqual([]);
  });
});
