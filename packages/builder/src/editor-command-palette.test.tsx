// @vitest-environment jsdom
/**
 * The editor's search: blocks to add, the page's blocks and the host's own
 * results, each doing its action.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  DEFAULT_LIMITS,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { EditorCommandPalette } from "./editor-command-palette";
import type { EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";

// The command primitives observe their list to size it and scroll the active
// row into view; jsdom has neither.
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

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/** A page with a named Hero holding a heading, then a paragraph. */
function page(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "hero",
        type: "acme/section",
        version: 1,
        name: "Hero",
        props: {},
        slots: {
          children: [
            {
              id: "welcome",
              type: "acme/heading",
              version: 1,
              name: "Welcome to Acme",
              props: {},
            },
          ],
        },
      },
      { id: "intro", type: "acme/text", version: 1, props: {} },
    ],
  } as BlockDocument;
}

function register(): void {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/section",
        editor: { label: "Section" },
        slots: { children: {} },
      },
      { ...base, name: "acme/heading", editor: { label: "Heading" } },
      { ...base, name: "acme/text", editor: { label: "Text" } },
    ] as never,
    { source: "acme" }
  );
}

/** An editor whose `apply` and `select` are observed, not reconstructed. */
function editorSpy(document: BlockDocument, selectedId: string | null) {
  return {
    document,
    limits: DEFAULT_LIMITS,
    selectedId,
    selection: {
      ids: selectedId === null ? [] : [selectedId],
      primary: selectedId,
    },
    select: vi.fn(),
    apply: vi.fn(() => document),
    applyAll: vi.fn(() => document),
    undo: vi.fn(() => Promise.resolve(true)),
    redo: vi.fn(() => Promise.resolve(true)),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
  } as unknown as EditorState & {
    apply: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
}

function mount(
  editor: EditorState,
  extra: Partial<React.ComponentProps<typeof EditorCommandPalette>> = {}
): void {
  render(
    <ShortcutProvider>
      <BlockKeyboardActions onSaveAsPattern={() => undefined} editor={editor}>
        <EditorCommandPalette editor={editor} insert={{}} open {...extra} />
      </BlockKeyboardActions>
    </ShortcutProvider>
  );
}

function search(text: string): void {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });
}

/** The rows under one heading, by their accessible names. */
function rowsUnder(heading: string): HTMLElement[] {
  const group = screen.getByRole("group", { name: heading });
  return within(group).getAllByRole("option");
}

describe("the editor's search", () => {
  it("adds a block where the Add panel would, and says where first", () => {
    register();
    const editor = editorSpy(page(), "intro");
    mount(editor);
    search("head");

    const [row] = rowsUnder("Add");
    // The Add panel's own words for the place, naming the selection.
    expect(row?.textContent).toContain("Adding after Text");
    fireEvent.click(row as HTMLElement);

    expect(editor.apply).toHaveBeenCalledTimes(1);
    const op = editor.apply.mock.calls[0]?.[0];
    expect(op.kind).toBe("insert");
    expect(op.node.type).toBe("acme/heading");
    // After the selected paragraph, the second block on the page.
    expect(op.at).toEqual({ index: 2 });
    expect(editor.select).toHaveBeenCalledWith(op.node.id);
  });

  it("lists blocks whose name the search begins first, before a match in a description", () => {
    register();
    registerBlocks(
      [
        { ...base, name: "acme/quote", editor: { label: "Zebra block" } },
      ] as never,
      { source: "acme" }
    );
    mount(editorSpy(page(), null));
    // Every fixture's description is "A block.", so all of them match; the one
    // NAMED for it leads, though it comes last in the catalogue.
    search("block");
    const [first] = rowsUnder("Add");
    expect(first?.textContent).toContain("Zebra block");
  });

  it("finds a block on the page by its name or its kind, and selects and reveals it", () => {
    register();
    const editor = editorSpy(page(), null);
    const revealBlock = vi.fn();
    mount(editor, { revealBlock });
    search("heading");

    const [row] = rowsUnder("On this page");
    // Its name, then what it is and where it sits.
    expect(row?.textContent).toContain("Welcome to Acme");
    expect(row?.textContent).toContain("Heading · in Hero");
    fireEvent.click(row as HTMLElement);

    expect(editor.select).toHaveBeenCalledWith("welcome");
    expect(revealBlock).toHaveBeenCalledWith("welcome");
  });

  it("finds a placed component by its component's title, and says it is one", () => {
    register();
    const editor = editorSpy(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "offer",
            type: "nextly/component-instance",
            version: 1,
            props: { componentId: "cmp-offer" },
          },
        ],
      } as BlockDocument,
      null
    );
    mount(editor, {
      componentTitle: id => (id === "cmp-offer" ? "Pricing card" : undefined),
    });
    search("pricing");

    const [row] = rowsUnder("On this page");
    expect(row?.textContent).toContain("Pricing card");
    // What it is, in the word Layers uses, not the engine's type.
    expect(row?.textContent).toContain("Component");
    expect(row?.textContent).not.toContain("instance");

    // And found by what it is, as a heading is by "heading".
    search("component");
    expect(rowsUnder("On this page")[0]?.textContent).toContain("Pricing card");
  });

  it("adds inside the container whose + opened Add, as the panel would", () => {
    register();
    const editor = editorSpy(page(), "hero");
    mount(editor, { insert: { inside: "hero" } });
    search("text");

    const [row] = rowsUnder("Add");
    expect(row?.textContent).toContain("Adding inside Hero");
    fireEvent.click(row as HTMLElement);
    const op = editor.apply.mock.calls[0]?.[0];
    // At the end of the Hero's own region, not after it.
    expect(op.at).toEqual({ parentId: "hero", slot: "children", index: 1 });
  });

  it("lists neither blocks to add nor the page's blocks before anything is typed", () => {
    register();
    mount(editorSpy(page(), null));
    expect(screen.queryByRole("group", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("group", { name: "On this page" })).toBeNull();
  });

  it("shows the host's own results between the page and the commands", () => {
    register();
    const onSearchChange = vi.fn();
    mount(editorSpy(page(), null), {
      onSearchChange,
      results: {
        group: { name: "Pages", status: "Searching pages…" },
        commands: [],
      },
    });
    search("acme");

    expect(onSearchChange).toHaveBeenLastCalledWith("acme");
    const headings = [...document.querySelectorAll("[cmdk-group-heading]")].map(
      heading => heading.textContent
    );
    expect(headings.indexOf("Pages")).toBeGreaterThan(
      headings.indexOf("On this page")
    );
    const pages = screen.getByRole("group", { name: "Pages" });
    expect(within(pages).getByRole("status").textContent).toBe(
      "Searching pages…"
    );
  });
});
