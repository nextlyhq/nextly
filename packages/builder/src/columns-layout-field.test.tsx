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
        baseStyles: {
          base: {
            base: {
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
            },
          },
        },
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

function mount(
  columns: BlockNode[],
  styles?: BlockNode["styles"],
  around: {
    classes?: string[];
    panel?: Partial<React.ComponentProps<typeof StyleInspectorPanel>>;
  } = {}
) {
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
        ...(around.classes === undefined ? {} : { classes: around.classes }),
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
  // A cascade given is compiled over this document's own tree.
  const cascade =
    around.panel?.cascade === undefined
      ? {}
      : { cascade: { ...around.panel.cascade, nodes: document.nodes } };
  render(
    <StyleInspectorPanel
      editor={editor}
      breakpoints={BREAKPOINTS}
      {...around.panel}
      {...cascade}
    />
  );
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

  it("is one tab stop whose arrows choose, skipping a held tile", () => {
    const editor = mount([column("a"), column("b")]);
    const tiles = screen.getAllByRole("radio").slice(0, 7);
    expect(tiles.map(tile => tile.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
      "-1",
      "-1",
      "-1",
      "-1",
    ]);
    fireEvent.keyDown(tiles[0] as HTMLElement, { key: "ArrowRight" });
    expect(JSON.stringify(editor.applyAll.mock.calls[0]?.[0])).toContain(
      '"gridTemplateColumns":"1fr 1fr"'
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("50 / 50");
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

describe("a layout reaching the row from elsewhere", () => {
  /** The row wearing a shared style whose base layout is `template`. */
  function mountWearing(template: string) {
    const card = {
      origin: { kind: "class", id: "cls-1", slug: "card" },
      property: "grid-template-columns",
      value: template,
      state: "base",
      breakpoint: BASE_BREAKPOINT,
    };
    return mount([column("a"), column("b")], undefined, {
      classes: ["cls-1"],
      panel: {
        target: {
          kind: "block",
          worn: [
            {
              id: "cls-1",
              name: "Card",
              styles: {
                base: { [BASE_BREAKPOINT]: { gridTemplateColumns: template } },
              },
            } as never,
          ],
        },
        liveBreakpoints: [BASE_BREAKPOINT] as never,
        cascade: { nodes: [], entries: [card] } as never,
      },
    });
  }

  it("shows a shared style's layout as the one in force", () => {
    mountWearing("1fr 1fr");
    expect(
      screen
        .getByRole("radio", { name: "50 / 50" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("restores the block's own wrapping columns over it with Auto", () => {
    // Clearing the row writes nothing while the style still sets a layout,
    // so Auto writes the block's own template at the row instead.
    const editor = mountWearing("1fr 1fr");
    fireEvent.click(screen.getByRole("radio", { name: "Auto" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(editor.applyAll.mock.calls[0]?.[0])).toContain(
      '"gridTemplateColumns":"repeat(auto-fit'
    );
  });

  it("shows a wider device's layout at a narrower one, from the cascade", () => {
    // Set at the base only; edited at Mobile, where every wider query matches.
    mount(
      [column("a"), column("b")],
      { base: { [BASE_BREAKPOINT]: { gridTemplateColumns: "1fr 1fr" } } },
      {
        panel: {
          breakpoint: "sm" as never,
          liveBreakpoints: [BASE_BREAKPOINT, "md", "sm"] as never,
          cascade: {
            nodes: [],
            entries: [
              {
                origin: { kind: "node", id: "row" },
                property: "grid-template-columns",
                value: "1fr 1fr",
                state: "base",
                breakpoint: BASE_BREAKPOINT,
              },
            ],
          } as never,
        },
      }
    );
    expect(
      screen
        .getByRole("radio", { name: "50 / 50" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });
});

describe("a stack reaching the row from a shared style", () => {
  /** The row wearing a style that stacks it at Tablet and below. */
  function mountStackedByStyle() {
    const fromCard = (property: string, value: string) => ({
      origin: { kind: "class", id: "cls-1", slug: "card" },
      property,
      value,
      state: "base",
      breakpoint: "md",
    });
    return mount([column("a"), column("b")], undefined, {
      classes: ["cls-1"],
      panel: {
        target: {
          kind: "block",
          worn: [
            {
              id: "cls-1",
              name: "Card",
              styles: {
                base: { md: { display: "flex", flexDirection: "column" } },
              },
            } as never,
          ],
        },
        liveBreakpoints: [BASE_BREAKPOINT] as never,
        cascade: {
          nodes: [],
          entries: [
            fromCard("display", "flex"),
            fromCard("flex-direction", "column"),
          ],
        } as never,
      },
    });
  }

  it("shows where the style stacks it", () => {
    mountStackedByStyle();
    expect(
      screen.getByRole("radio", { name: "Tablet" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("undoes it with Never, laying the row out as its block does there", () => {
    // Nothing of the row's own to clear: Never writes the block's own display
    // at the tier the style stacks it at, over the style's.
    const editor = mountStackedByStyle();
    fireEvent.click(screen.getByRole("radio", { name: "Never" }));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    const op = JSON.stringify(editor.apply.mock.calls[0]?.[0]);
    expect(op).toContain('"md":{"display":"grid"}');
  });
});
