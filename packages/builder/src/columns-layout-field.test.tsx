// @vitest-environment jsdom

/**
 * The Columns row's layout tiles and stacking, drawn in the real Style panel.
 *
 * @module columns-layout-field.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { StyleInspectorPanel } from "./style-inspector-panel";

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

const BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: "md", label: "Tablet", maxWidth: 1024 },
    { id: "sm", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

function register(): void {
  const block = (name: string, extra: Record<string, unknown>) => ({
    name,
    version: 1,
    description: name,
    example: { props: {} },
    editor: { label: name },
    props: {},
    defaultProps: {},
    render: () => null,
    ...extra,
  });
  registerBlocks(
    [
      block("core/columns", {
        supports: { layout: true },
        slots: { children: { allow: ["core/column"] } },
      }),
      block("core/column", { slots: { children: {} } }),
      block("core/text", { props: { text: { type: "text" } } }),
    ] as never,
    { source: "columns-layout-field-test" }
  );
}

const column = (id: string, children: BlockNode[] = []): BlockNode => ({
  id,
  type: "core/column",
  version: 1,
  props: {},
  slots: { children },
});
const words: BlockNode = {
  id: "t1",
  type: "core/text",
  version: 1,
  props: { text: "Words" },
};

function mount(columns: BlockNode[], styles?: BlockNode["styles"]) {
  register();
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "row",
        type: "core/columns",
        version: 1,
        props: {},
        slots: { children: columns },
        ...(styles === undefined ? {} : { styles }),
      },
    ],
  } as unknown as BlockDocument;
  const editor = {
    document,
    selectedId: "row",
    selection: { ids: ["row"], primary: "row" },
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
  } as unknown as EditorState & {
    applyAll: ReturnType<typeof vi.fn>;
    apply: ReturnType<typeof vi.fn>;
  };
  render(<StyleInspectorPanel editor={editor} breakpoints={BREAKPOINTS} />);
  return editor;
}

describe("a Columns row's layout", () => {
  it("offers its layouts as tiles, Auto first and chosen while nothing is set", () => {
    mount([column("a"), column("b")]);
    const tiles = screen.getByRole("radiogroup", { name: "Widths" });
    const names = [...tiles.querySelectorAll('[role="radio"]')].map(tile =>
      tile.getAttribute("aria-label")
    );
    expect(names).toEqual([
      "Auto",
      "50 / 50",
      "33 / 67",
      "67 / 33",
      "25 / 75",
      "3 equal",
      "4 equal",
    ]);
    expect(
      screen.getByRole("radio", { name: "Auto" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByText("Equal columns that wrap when narrow.")
    ).toBeDefined();
  });

  it("writes a tile's template, with the columns it adds, as one step", () => {
    const editor = mount([column("a"), column("b")]);
    fireEvent.click(screen.getByRole("radio", { name: "3 equal" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    const ops = editor.applyAll.mock.calls[0]?.[0] as { kind: string }[];
    expect(JSON.stringify(ops)).toContain(
      '"gridTemplateColumns":"repeat(3, 1fr)"'
    );
    expect(ops.filter(op => op.kind === "insert")).toHaveLength(1);
  });

  it("holds a tile that would remove a column with content, and says why", () => {
    const editor = mount([
      column("a", [words]),
      column("b", [words]),
      column("c", [words]),
    ]);
    const tile = screen.getByRole("radio", { name: "50 / 50" });
    // Held, not disabled: it can still be reached to read why.
    expect(tile.getAttribute("aria-disabled")).toBe("true");
    expect((tile as HTMLButtonElement).disabled).toBe(false);
    // The hint under the tiles says why while the tile is focused or hovered,
    // and is the tile's description.
    fireEvent.focus(tile);
    const why = document.getElementById(
      tile.getAttribute("aria-describedby") ?? ""
    );
    expect(why?.textContent).toBe(
      "Needs 2 columns. This row has 3 with content; empty one out first."
    );
    fireEvent.click(tile);
    expect(editor.applyAll).not.toHaveBeenCalled();
    fireEvent.blur(tile);
    expect(why?.textContent).not.toMatch(/Needs 2 columns/);
  });

  it("stacks at Tablet and below, reversed, writing the row only", () => {
    const editor = mount([column("a"), column("b")], {
      base: { md: { display: "flex", flexDirection: "column" } },
    });
    expect(
      screen.getByRole("radio", { name: "Tablet" }).getAttribute("aria-checked")
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("switch", { name: "Reverse when stacked" })
    );
    expect(JSON.stringify(editor.apply.mock.calls[0]?.[0])).toContain(
      '"md":{"display":"flex","flexDirection":"column-reverse"}'
    );
  });

  it("is not offered on a block that is not a Columns row", () => {
    register();
    expect(BASE_BREAKPOINT).toBe("base");
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "c",
          type: "core/column",
          version: 1,
          props: {},
          slots: { children: [] },
        },
      ],
    } as unknown as BlockDocument;
    render(
      <StyleInspectorPanel
        editor={
          {
            document,
            selectedId: "c",
            selection: { ids: ["c"], primary: "c" },
            lockRefusalFor: () => undefined,
            composed: () => undefined,
          } as unknown as EditorState
        }
      />
    );
    expect(screen.queryByRole("radiogroup", { name: "Widths" })).toBeNull();
  });
});
