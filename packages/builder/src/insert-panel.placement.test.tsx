// @vitest-environment jsdom

/**
 * The Add panel's words for where a clicked block lands, and the sentence an
 * insert is announced with, against a Section that holds blocks: a Heading
 * goes inside it, at the end; a Box goes after it.
 *
 * @module insert-panel.placement.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  DEFAULT_LIMITS,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { InsertPanel } from "./insert-panel";
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

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

function register(): void {
  registerBlocks(
    [
      {
        ...base,
        name: "core/section",
        editor: { label: "Section", category: "layout" },
        slots: { children: {} },
      },
      {
        ...base,
        name: "core/box",
        editor: { label: "Box", category: "layout" },
        slots: { children: {} },
      },
      {
        ...base,
        name: "core/heading",
        editor: { label: "Heading", category: "content" },
      },
    ] as never,
    { source: "core" }
  );
}

/** Hero, a Section an author named, holding one Heading. */
const heroPage = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "hero",
      type: "core/section",
      version: 1,
      props: {},
      name: "Hero",
      slots: {
        children: [{ id: "h", type: "core/heading", version: 1, props: {} }],
      },
    },
  ],
} as BlockDocument;

function editorOn(
  selectedId: string | null
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
    document: heroPage,
    limits: DEFAULT_LIMITS,
    selectedId,
    selection:
      selectedId === null
        ? EMPTY_SELECTION
        : { ids: [selectedId], primary: selectedId },
    select: vi.fn(),
    apply: vi.fn(() => heroPage),
    applyAll: vi.fn(() => heroPage),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

function tile(name: string): HTMLElement {
  return screen.getByRole("option", { name });
}

function describedBy(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(id => id !== "")
    .map(id => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function line(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".nx-insert-panel__placement");
}

function announcement(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-insert-announcement]");
}

describe("where a clicked block lands, as the Add panel says it", () => {
  it("says a block goes inside a selected Section, at the end", () => {
    register();
    render(<InsertPanel editor={editorOn("hero")} />);
    expect(line()?.textContent).toBe("Adding inside Hero, at the end");
  });

  it("names the block a nested place is inside", () => {
    register();
    render(<InsertPanel editor={editorOn("h")} />);
    expect(line()?.textContent).toBe("Adding after Heading, inside Hero");
  });

  it("gives each tile a description that says where it goes", () => {
    register();
    render(<InsertPanel editor={editorOn("hero")} />);
    expect(describedBy(tile("Heading"))).toContain(
      "Goes inside Hero, at the end."
    );
    expect(describedBy(tile("Box"))).toContain("Goes after Hero.");
    expect(describedBy(tile("Section"))).toContain("Goes after Hero.");
  });

  it("keeps the line a polite live region only while no tile is highlighted", () => {
    register();
    render(<InsertPanel editor={editorOn("hero")} />);
    expect(line()?.getAttribute("aria-live")).toBe("polite");
    const search = screen.getByRole("combobox", { name: "Insert a block" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(line()?.getAttribute("aria-live")).toBe("off");
  });

  it("adds a Heading inside the selected Section and a Box after it", () => {
    register();
    const editor = editorOn("hero");
    render(<InsertPanel editor={editor} />);
    fireEvent.click(tile("Heading"));
    fireEvent.click(tile("Box"));
    expect(editor.apply.mock.calls[0][0].at).toEqual({
      parentId: "hero",
      slot: "children",
      index: 1,
    });
    expect(editor.apply.mock.calls[1][0].at).toEqual({ index: 1 });
  });

  it("announces what was added and where, politely", () => {
    register();
    render(<InsertPanel editor={editorOn("hero")} />);
    const region = announcement();
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("");
    fireEvent.click(tile("Heading"));
    expect(region?.textContent).toBe("Heading added inside Hero, at the end");
    fireEvent.click(tile("Box"));
    expect(region?.textContent).toBe("Box added after Hero");
  });

  it("adds in the gap a '+' chose below a selected Section, and says between what", () => {
    register();
    const twoSections = {
      ...heroPage,
      nodes: [
        ...heroPage.nodes,
        {
          id: "pricing",
          type: "core/section",
          version: 1,
          props: {},
          name: "Pricing",
          slots: { children: [] },
        },
      ],
    } as BlockDocument;
    const editor = { ...editorOn("hero"), document: twoSections };
    render(<InsertPanel editor={editor} after="hero" />);
    expect(line()?.textContent).toBe("Adding between Hero and Pricing");
    fireEvent.click(tile("Heading"));
    // In the gap, not inside the selected Section.
    expect(editor.apply.mock.calls[0][0].at).toEqual({ index: 1 });
    expect(announcement()?.textContent).toBe(
      "Heading added between Hero and Pricing"
    );
  });

  it("announces a repeated insert again", () => {
    register();
    render(<InsertPanel editor={editorOn("hero")} />);
    fireEvent.click(tile("Heading"));
    const first = announcement()?.textContent;
    fireEvent.click(tile("Heading"));
    const second = announcement()?.textContent;
    fireEvent.click(tile("Heading"));
    const third = announcement()?.textContent;
    // A live region reads a changed text only, so each repeat must differ in
    // its characters from the one before while saying the same words.
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    for (const said of [first, second, third]) {
      expect(said?.replace(/\u200b/g, "")).toBe(
        "Heading added inside Hero, at the end"
      );
    }
  });
});
