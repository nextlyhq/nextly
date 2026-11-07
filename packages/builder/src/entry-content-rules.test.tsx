// @vitest-environment jsdom

/**
 * What the editor holds a template's Entry content block to: offered in a
 * template only, one per template (the Add panel's tile and Duplicate refuse
 * a second, with one sentence), and placed naming the collection's first
 * blocks field.
 *
 * Each refusal sits beside the case that is let through, so a rule refusing
 * the block always, or never, fails one of the pair.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  DEFAULT_LIMITS,
  ENTRY_CONTENT_TYPE,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { blockDuplication } from "./duplicate-block";
import type { EditorState } from "./editor-state";
import {
  duplicationRefusal,
  entryContentRefusal,
  offeredIn,
  withEntryContentField,
} from "./entry-content-rules";
import { InsertPanel } from "./insert-panel";
import {
  PreviewedEntryProvider,
  type PreviewedCollection,
} from "./previewed-entry";
import { EMPTY_SELECTION } from "./selection";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

const ONE_REASON = "A template holds one Entry content block.";

const entryContent = {
  id: "ec",
  type: ENTRY_CONTENT_TYPE,
  version: 1,
  props: { field: "body" },
};
const heading = { id: "h", type: "acme/heading", version: 1, props: {} };

function documentOf(
  kind: string,
  nodes: BlockDocument["nodes"] = []
): BlockDocument {
  return { formatVersion: 1, kind, nodes } as BlockDocument;
}

const POSTS: PreviewedCollection = {
  slug: "posts",
  singular: "post",
  plural: "Posts",
  blocksFields: [
    { name: "body", label: "Body" },
    { name: "sidebar", label: "Sidebar" },
  ],
  // Its label where it has one, else the host's words for a key: here a
  // stand-in that says which it took.
  fieldLabel: name =>
    (({ body: "Body", sidebar: "Sidebar" }) as Record<string, string>)[name] ??
    `Words for ${name}`,
  entryHref: id => `/admin/collections/posts/${id}`,
};

describe("which documents are offered Entry content", () => {
  it("offers it in a template, and nowhere else", () => {
    expect(offeredIn("template", ENTRY_CONTENT_TYPE)).toBe(true);
    for (const kind of ["page", "component", "pattern", "region"]) {
      expect(offeredIn(kind, ENTRY_CONTENT_TYPE), kind).toBe(false);
    }
    // Every other block is offered everywhere (the control).
    expect(offeredIn("page", "core/heading")).toBe(true);
  });
});

describe("one Entry content block per template", () => {
  it("refuses a second once one is placed, and nothing before (the control)", () => {
    expect(
      entryContentRefusal(documentOf("template"), ENTRY_CONTENT_TYPE)
    ).toBeUndefined();
    expect(
      entryContentRefusal(
        documentOf("template", [entryContent]),
        ENTRY_CONTENT_TYPE
      )
    ).toBe(ONE_REASON);
    // Not while the collection's fields are unknown, and offered once known.
    expect(
      entryContentRefusal(documentOf("template"), ENTRY_CONTENT_TYPE, false)
    ).toBe("Loading the collection’s fields…");
    expect(
      entryContentRefusal(documentOf("template"), ENTRY_CONTENT_TYPE, true)
    ).toBeUndefined();
    // Another block is never refused by it.
    expect(
      entryContentRefusal(
        documentOf("template", [entryContent]),
        "acme/heading"
      )
    ).toBeUndefined();
  });

  it("refuses Duplicate on the block and on a block holding it, and on no other", () => {
    const box = {
      id: "box",
      type: "acme/box",
      version: 1,
      props: {},
      slots: { children: [entryContent] },
    };
    const document = documentOf("template", [box, heading]);
    expect(duplicationRefusal(document, "ec")).toBe(ONE_REASON);
    expect(duplicationRefusal(document, "box")).toBe(ONE_REASON);
    expect(blockDuplication(document, "ec")).toBeNull();
    expect(blockDuplication(document, "box")).toBeNull();
    // The control: a heading beside it duplicates as ever.
    expect(duplicationRefusal(document, "h")).toBeUndefined();
    expect(blockDuplication(document, "h")).not.toBeNull();
  });
});

describe("the field a placed block names", () => {
  it("names the collection's first blocks field where it names none", () => {
    const placed = withEntryContentField(
      { ...entryContent, props: {} },
      "body"
    );
    expect(placed.props).toEqual({ field: "body" });
    // Kept where it names one, and no other block is touched.
    expect(withEntryContentField(entryContent, "sidebar").props).toEqual({
      field: "body",
    });
    expect(withEntryContentField(heading, "body")).toBe(heading);
  });
});

describe("Entry content in the Add panel", () => {
  const base = {
    version: 1,
    description: "A block.",
    example: { props: {} },
    render: () => null,
  };

  function editorOf(document: BlockDocument) {
    return {
      document,
      limits: DEFAULT_LIMITS,
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
    } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  }

  function registerLibrary(): void {
    registerBlocks(
      [
        { ...base, name: "acme/heading", editor: { label: "Heading" } },
        {
          ...base,
          name: ENTRY_CONTENT_TYPE,
          editor: { label: "Entry content", category: "entry" },
        },
      ] as never,
      { source: "acme" }
    );
  }

  it("is listed under Entry in a template, and placed naming the collection's first blocks field", () => {
    registerLibrary();
    const editor = editorOf(documentOf("template"));
    render(
      <PreviewedEntryProvider
        value={{ kind: "none", reason: "empty" }}
        collection={POSTS}
      >
        <InsertPanel editor={editor} />
      </PreviewedEntryProvider>
    );
    expect(screen.getByText("Entry")).toBeTruthy();
    const tile = screen.getByRole("option", { name: "Entry content" });
    expect(tile.getAttribute("data-refused")).toBeNull();
    fireEvent.click(tile);
    expect(editor.apply).toHaveBeenCalledTimes(1);
    const op = editor.apply.mock.calls[0]?.[0] as {
      node: { type: string; props: Record<string, unknown> };
    };
    expect(op.node.type).toBe(ENTRY_CONTENT_TYPE);
    expect(op.node.props.field).toBe("body");
  });

  it("is refused, saying why, once one is placed, and inserts nothing", () => {
    registerLibrary();
    const editor = editorOf(documentOf("template", [entryContent]));
    render(<InsertPanel editor={editor} />);
    const tile = screen.getByRole("option", { name: "Entry content" });
    expect(tile.getAttribute("data-refused")).toBe("true");
    fireEvent.click(tile);
    expect(editor.apply).not.toHaveBeenCalled();
    // The control: another block is offered as usual.
    expect(
      screen
        .getByRole("option", { name: "Heading" })
        .getAttribute("data-refused")
    ).toBeNull();
  });

  it("is refused, saying why, while the collection's fields are on their way, and inserts nothing", () => {
    registerLibrary();
    const editor = editorOf(documentOf("template"));
    render(
      <PreviewedEntryProvider
        value={{ kind: "none", reason: "loading" }}
        collection={{ ...POSTS, blocksFields: undefined }}
      >
        <InsertPanel editor={editor} />
      </PreviewedEntryProvider>
    );
    const tile = screen.getByRole("option", { name: "Entry content" });
    expect(tile.getAttribute("data-refused")).toBe("true");
    expect(document.body.textContent).toContain(
      "Loading the collection’s fields…"
    );
    fireEvent.click(tile);
    // Placed now it would name no field, and nothing would fill it later.
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("is not listed at all outside a template", () => {
    registerLibrary();
    render(<InsertPanel editor={editorOf(documentOf("page"))} />);
    expect(screen.queryByRole("option", { name: "Entry content" })).toBeNull();
    // The control: the rest of the library is.
    expect(screen.getByRole("option", { name: "Heading" })).toBeTruthy();
  });
});
