// @vitest-environment jsdom

/**
 * The ancestor breadcrumb.
 *
 * The trail itself comes from `pathTo`, which is asserted in `layers.test.ts`
 * without a DOM. What is only true here is what the component does with it:
 * the page as the trail's root, which crumb is marked current, that every
 * crumb changes the selection, and a hint that offers only keys that work.
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
      {
        ...base,
        name: "core/heading",
        editor: { label: "Heading" },
        // Text the canvas edits in place, so Enter has something to begin.
        props: { text: { type: "text", inline: true } },
      },
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
              slots: {
                children: [
                  node("leaf", "core/heading", { props: { text: "Hello" } }),
                ],
              },
            }),
          ],
        },
      }),
    ],
  } as BlockDocument;
}

let editorRef: EditorState | null = null;

function Host({
  hints,
}: {
  hints?: React.ComponentProps<typeof SelectionBreadcrumb>["hints"];
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: documentOf() });
  editorRef = editor;
  return <SelectionBreadcrumb editor={editor} {...(hints ? { hints } : {})} />;
}

function crumbs(): string[] {
  return screen.queryAllByRole("button").map(b => b.textContent ?? "");
}

function hint(): string | null {
  return document.querySelector(".nx-bottom-bar__hint")?.textContent ?? null;
}

describe("SelectionBreadcrumb", () => {
  it("reads the page first, then outermost, and ends with the selected block", () => {
    register();
    render(<Host />);
    React.act(() => {
      editorRef?.select("leaf");
    });

    // The instance name where the author gave one, the block's name otherwise —
    // the same rule the palette and the layers panel use.
    expect(crumbs()).toEqual(["Page", "Section", "Box", "Heading"]);
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

    expect(marked).toEqual([null, null, null, "true"]);
  });

  it("selects the ancestor a crumb names, and the page clears the selection", () => {
    // The reason the trail is buttons rather than text. A full-width container
    // is almost entirely covered by its own children, so reaching it on the
    // canvas means finding a margin.
    register();
    render(<Host />);
    React.act(() => {
      editorRef?.select("leaf");
    });

    React.act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Section" }));
    });
    expect(editorRef?.selectedId).toBe("outer");

    React.act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Page" }));
    });
    expect(editorRef?.selectedId).toBeNull();
  });

  it("shows the page alone, as the current position, when nothing is selected", () => {
    // The bar always says where the author is: on the page, with nothing
    // inside it selected.
    register();
    render(<Host />);

    expect(crumbs()).toEqual(["Page"]);
    expect(
      screen.getByRole("button", { name: "Page" }).getAttribute("aria-current")
    ).toBe("true");
  });

  it("falls back to the page for a selection the document no longer holds", () => {
    // Routine rather than exotic: an undo can remove the selected node while
    // the selection stands, and a partial trail would name ancestors of a block
    // that is gone.
    register();
    render(<Host />);
    React.act(() => {
      editorRef?.select("leaf");
    });
    expect(crumbs()).toHaveLength(4);

    React.act(() => {
      editorRef?.apply({ kind: "remove", id: "outer" });
    });

    expect(crumbs()).toEqual(["Page"]);
  });

  it("hints only at keys that work for the selection", () => {
    // A hint is a promise that pressing something does something: Enter is
    // offered only where the host edits text and the block has some, and the
    // command palette only where the host has one.
    register();
    render(<Host hints={{ editText: true, commandPalette: true }} />);
    expect(hint()).toMatch(/^Click a block to select it · .+K for anything$/);

    React.act(() => {
      editorRef?.select("leaf");
    });
    expect(hint()).toMatch(
      /^Enter to edit text · Esc to go up · .+K for anything$/
    );

    // A container has no text of its own to edit.
    React.act(() => {
      editorRef?.select("inner");
    });
    expect(hint()).toMatch(/^Esc to go up · .+K for anything$/);
  });

  it("offers neither Enter nor the palette where the host has neither", () => {
    register();
    render(<Host />);
    React.act(() => {
      editorRef?.select("leaf");
    });
    expect(hint()).toBe("Esc to go up");
  });
});
