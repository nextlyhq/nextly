// @vitest-environment jsdom

/**
 * A block's own words for a Style property, in the real Style panel: a
 * Divider's line named as a line, and every other block's border as ever.
 *
 * @module block-style-words.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { StyleInspectorPanel } from "./inspector/style-inspector/style-inspector-panel";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

function mount(type: string, extra: Partial<BlockNode> = {}): void {
  registerBlocks(
    [
      {
        name: type,
        version: 1,
        description: type,
        example: { props: {} },
        editor: { label: type },
        props: {},
        supports: { border: true },
        render: () => null,
      },
    ] as never,
    { source: "block-style-words-test" }
  );
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n", type, version: 1, props: {}, ...extra }],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "n",
    selection: { ids: ["n"], primary: "n" },
    applyAll: vi.fn(() => document),
    apply: vi.fn(() => document),
    select: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState;
  render(<StyleInspectorPanel editor={editor} />);
  const heading = screen
    .getAllByRole("button", { name: /^Border/ })
    .find(button => button.hasAttribute("aria-expanded"));
  if (heading?.getAttribute("aria-expanded") !== "true")
    fireEvent.click(heading!);
}

/** The labels the border property's fields are drawn with, in order. */
function borderLabels(): (string | null)[] {
  return Array.from(
    window.document.querySelectorAll(
      '[data-property="border"] .nx-style-inspector__field-label-text'
    )
  ).map(label => label.textContent);
}

describe("a Divider's line", () => {
  it("is Line colour, Thickness and Line style, and no box's sides", () => {
    mount("core/divider");
    expect(borderLabels()).toEqual(["Line colour", "Thickness", "Line style"]);
  });

  it("says the line is the divider's top border", () => {
    mount("core/divider");
    expect(
      screen.getByText("The divider's line is its top border.")
    ).toBeDefined();
  });

  it("still draws a side set another way, so it can be cleared", () => {
    mount("core/divider", {
      styles: {
        base: {
          [BASE_BREAKPOINT]: { border: { width: { blockEnd: "2px" } } },
        },
      },
    });
    expect(borderLabels()).toHaveLength(4);
    expect(borderLabels().slice(0, 3)).toEqual([
      "Line colour",
      "Thickness",
      "Line style",
    ]);
  });
});

describe("another block's border", () => {
  it("keeps the catalog's words for every side", () => {
    mount("acme/panel");
    expect(borderLabels()).not.toContain("Thickness");
    // Named by side; with no writing direction given, logically.
    expect(borderLabels()).toContain("Block start");
    expect(
      screen.queryByText("The divider's line is its top border.")
    ).toBeNull();
  });
});
