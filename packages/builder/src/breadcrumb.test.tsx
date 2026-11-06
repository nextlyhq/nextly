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
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("names a selected component placement by its component's title", () => {
    // The engine's type for a placement reads "Component instance", which
    // names the mechanism rather than what the author placed.
    function PlacementHost(): React.JSX.Element {
      const editor = useEditorState({
        initialDocument: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            node("hero", "nextly/component-instance", {
              props: { componentId: "cmp-hero" },
            }),
          ],
        } as BlockDocument,
      });
      editorRef = editor;
      return (
        <SelectionBreadcrumb
          editor={editor}
          componentTitle={id => (id === "cmp-hero" ? "Hero banner" : undefined)}
        />
      );
    }
    render(<PlacementHost />);
    React.act(() => {
      editorRef?.select("hero");
    });

    expect(crumbs()).toEqual(["Page", "Hero banner"]);
  });

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
    render(
      <Host hints={{ editText: true, goUp: true, commandPalette: true }} />
    );
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

  it("offers no key the host has not bound", () => {
    // A bar mounted without the editor's keyboard actions promises nothing:
    // not Enter, not Escape, not the palette.
    register();
    render(<Host />);
    React.act(() => {
      editorRef?.select("leaf");
    });
    expect(hint()).toBeNull();

    React.act(() => {
      editorRef?.select(null);
    });
    expect(hint()).toBe("Click a block to select it");
  });

  it("names no platform key in a server render, where the platform is unknown", () => {
    // The server cannot tell a Mac from anything else, so a key spelled
    // there would differ from the browser's first render and be thrown away.
    // The palette's key arrives once the browser has said which it is.
    register();
    const editor = {
      document: documentOf(),
      selectedId: null,
      select: () => {},
    } as unknown as EditorState;
    const markup = renderToStaticMarkup(
      <SelectionBreadcrumb editor={editor} hints={{ commandPalette: true }} />
    );
    expect(markup).toContain("Click a block to select it");
    expect(markup).not.toContain("for anything");
  });

  it("keeps the page crumb apart from a block whose id is page", () => {
    // Block ids are any unique string, "page" among them, so the root crumb
    // cannot share their key space.
    register();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    function PageIdHost(): React.JSX.Element {
      const editor = useEditorState({
        initialDocument: {
          formatVersion: 1,
          kind: "page",
          nodes: [node("page", "core/heading", { props: { text: "Hi" } })],
        } as BlockDocument,
      });
      editorRef = editor;
      return <SelectionBreadcrumb editor={editor} />;
    }
    render(<PageIdHost />);
    React.act(() => {
      editorRef?.select("page");
    });

    expect(crumbs()).toEqual(["Page", "Heading"]);
    expect(
      errors.mock.calls.some(call => String(call[0]).includes("same key"))
    ).toBe(false);
    errors.mockRestore();
  });
});
