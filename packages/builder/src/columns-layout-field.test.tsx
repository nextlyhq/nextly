// @vitest-environment jsdom

/**
 * The Columns row's layout tiles and stacking, as its Content tab draws them:
 * writing the row's own base values.
 *
 * @module columns-layout-field.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ColumnsLayoutControl } from "./columns-layout-field";
import type { EditorState } from "./editor-state";

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
    applyAll: vi.fn(() => document),
    apply: vi.fn(() => document),
  } as unknown as EditorState & {
    applyAll: ReturnType<typeof vi.fn>;
    apply: ReturnType<typeof vi.fn>;
  };
  render(
    <ColumnsLayoutControl
      editor={editor}
      nodeId="row"
      breakpoints={BREAKPOINTS}
    />
  );
  return editor;
}

const checked = (name: string) =>
  screen.getByRole("radio", { name }).getAttribute("aria-checked");

describe("a Columns row's layout", () => {
  it("offers the six layouts as pictured tiles, a row as placed reading 2 equal", () => {
    mount([column("a"), column("b")]);
    const tiles = screen.getByRole("radiogroup", { name: "Layout" });
    const radios = [...tiles.querySelectorAll('[role="radio"]')];
    expect(radios.map(tile => tile.getAttribute("aria-label"))).toEqual([
      "2 equal",
      "3 equal",
      "4 equal",
      "Wide left",
      "Wide right",
      "Wide middle",
    ]);
    // Each a picture of its columns: Wide middle's three, the middle wider.
    const bars = radios[5]?.querySelectorAll(".nx-columns-layout__glyph i");
    expect(
      [...(bars ?? [])].map(bar => (bar as HTMLElement).style.flexGrow)
    ).toEqual(["1", "2", "1"]);
    expect(checked("2 equal")).toBe("true");
    expect(
      screen.getByText("Equal columns that wrap when narrow.")
    ).toBeDefined();
  });

  it("writes a tile's template on the row's base values, with the columns it adds, as one step", () => {
    const editor = mount([column("a"), column("b")]);
    fireEvent.click(screen.getByRole("radio", { name: "3 equal" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    const ops = editor.applyAll.mock.calls[0]?.[0] as { kind: string }[];
    expect(JSON.stringify(ops)).toContain(
      '"base":{"base":{"gridTemplateColumns":"repeat(3, 1fr)"}}'
    );
    expect(ops.filter(op => op.kind === "insert")).toHaveLength(1);
  });

  it("writes the row's own base values, beside a template set for one device", () => {
    // A template stored at Mobile, as the Style tab once wrote one: the tile
    // still writes the row's own layout, and leaves Mobile's as it was.
    const editor = mount([column("a"), column("b")], {
      base: { sm: { gridTemplateColumns: "1fr 2fr" } },
    });
    fireEvent.click(screen.getByRole("radio", { name: "3 equal" }));
    const written = JSON.stringify(editor.applyAll.mock.calls[0]?.[0]);
    expect(written).toContain(
      '"base":{"gridTemplateColumns":"repeat(3, 1fr)"}'
    );
    expect(written).toContain('"sm":{"gridTemplateColumns":"1fr 2fr"}');
  });

  it("gives back a column a row reading 3 equal has lost, writing no template", () => {
    const editor = mount([column("a"), column("b")], {
      base: { base: { gridTemplateColumns: "repeat(3, 1fr)" } },
    });
    expect(checked("3 equal")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "3 equal" }));
    const ops = editor.applyAll.mock.calls[0]?.[0] as { kind: string }[];
    expect(ops.map(op => op.kind)).toEqual(["insert"]);
  });

  it("writes nothing for the tile already chosen", () => {
    const editor = mount([column("a"), column("b")]);
    fireEvent.click(screen.getByRole("radio", { name: "2 equal" }));
    expect(editor.applyAll).not.toHaveBeenCalled();
  });

  it("reads a template no tile writes as the row's own, set in Style", () => {
    mount([column("a"), column("b")], {
      base: { base: { gridTemplateColumns: "1fr 3fr" } },
    });
    const tiles = screen.getByRole("radiogroup", { name: "Layout" });
    expect(tiles.querySelector('[aria-checked="true"]')).toBeNull();
    expect(
      screen.getByText("A layout of its own, set in Style.")
    ).toBeDefined();
  });

  it("holds a tile that would remove a column with content, and says why", () => {
    const editor = mount([
      column("a", [words]),
      column("b", [words]),
      column("c", [words]),
    ]);
    const tile = screen.getByRole("radio", { name: "2 equal" });
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

  it("is one tab stop whose arrows choose", () => {
    const editor = mount([column("a"), column("b")]);
    const tiles = screen.getAllByRole("radio").slice(0, 6);
    expect(tiles.map(tile => tile.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
      "-1",
      "-1",
      "-1",
    ]);
    fireEvent.keyDown(tiles[0] as HTMLElement, { key: "ArrowRight" });
    expect(JSON.stringify(editor.applyAll.mock.calls[0]?.[0])).toContain(
      '"gridTemplateColumns":"repeat(3, 1fr)"'
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("3 equal");
  });
});

describe("where a Columns row stacks", () => {
  it("offers Never, Tablet and mobile, and Mobile, in that order", () => {
    mount([column("a"), column("b")]);
    const group = screen.getByRole("radiogroup", { name: "Stack on" });
    expect(
      [...group.querySelectorAll('[role="radio"]')].map(each =>
        each.textContent?.trim()
      )
    ).toEqual(["Never", "Tablet and mobile", "Mobile"]);
    expect(checked("Never")).toBe("true");
  });

  it("stacks at Tablet and below, reversed, writing the row only", () => {
    const editor = mount([column("a"), column("b")], {
      base: { md: { display: "flex", flexDirection: "column" } },
    });
    expect(checked("Tablet and mobile")).toBe("true");
    fireEvent.click(
      screen.getByRole("switch", { name: "Reverse when stacked" })
    );
    expect(JSON.stringify(editor.apply.mock.calls[0]?.[0])).toContain(
      '"md":{"display":"flex","flexDirection":"column-reverse"}'
    );
  });

  it("stacks on Mobile only at the mobile device", () => {
    const editor = mount([column("a"), column("b")]);
    fireEvent.click(screen.getByRole("radio", { name: "Mobile" }));
    expect(JSON.stringify(editor.apply.mock.calls[0]?.[0])).toContain(
      '"sm":{"display":"flex","flexDirection":"column"}'
    );
  });
});
