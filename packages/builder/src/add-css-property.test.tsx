// @vitest-environment jsdom

/**
 * "CSS properties" and "+ Add CSS property" on the Style tab, with the real
 * editor and the core blocks: no section has a "+ More"; the list offers only
 * what works on the block, by CSS name, plain name and section; a picked
 * property is a row with its value focused; Remove clears the value and the
 * row in one undoable step; and "Find a setting" offers to add what it finds.
 *
 * @module add-css-property.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  getStyleProperty,
  registerBlocks,
  type AppliesWhen,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useEditorState, type EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

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

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => {
  cleanup();
  clearBlocks();
});

function nodeOf(id: string, type: string, extra: Partial<BlockNode> = {}) {
  const block = coreBlocks.find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return { id, type, version: block.version, props: {}, ...extra } as BlockNode;
}

/** A Section holding two Boxes, the first with these styles. */
function pageOf(first?: NodeStyles, section?: NodeStyles): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      nodeOf("section", "core/section", {
        props: { as: "section" },
        styles: section,
        slots: {
          children: [
            nodeOf("box", "core/box", {
              props: { as: "div" },
              styles: first,
              slots: { children: [] },
            }),
            nodeOf("other", "core/box", {
              props: { as: "div" },
              slots: { children: [] },
            }),
          ],
        },
      }),
    ],
  } as BlockDocument;
}

/** Styles at the base state and breakpoint. */
function at(values: Record<string, unknown>): NodeStyles {
  return { base: { [BASE_BREAKPOINT]: values } } as NodeStyles;
}

/** A Stack: a box laid out in flow, in a parent laid out in flow. */
const STACK = at({ display: "block" });

let editorRef: EditorState | null = null;
const editor = (): EditorState => editorRef!;

function Host({ page }: { page: BlockDocument }): React.JSX.Element {
  const state = useEditorState({ initialDocument: page });
  editorRef = state;
  return <InspectorPanel editor={state} breakpoint={BASE_BREAKPOINT} />;
}

/** The panel on the first Box's Style tab, with "CSS properties" open. */
function mount(page: BlockDocument = pageOf(STACK, STACK)): void {
  render(<Host page={page} />);
  act(() => editor().select("box"));
  fireEvent.mouseDown(screen.getByRole("tab", { name: /^Style/ }));
  openSection(/^CSS properties/);
}

function openSection(name: RegExp): void {
  const trigger = screen.getByRole("button", { name });
  if (trigger.getAttribute("aria-expanded") !== "true")
    fireEvent.click(trigger);
}

function addButton(): HTMLElement {
  return screen.getByRole("button", { name: "+ Add CSS property" });
}

function openPicker(): void {
  if (addButton().getAttribute("aria-expanded") !== "true") {
    fireEvent.click(addButton());
  }
}

/** The ids the open list offers. */
function offered(): string[] {
  return screen
    .queryAllByRole("option")
    .map(option => option.getAttribute("data-css-id") ?? "");
}

function pick(cssName: string): void {
  openPicker();
  fireEvent.click(
    screen.getByRole("option", { name: new RegExp(`^${cssName} `) })
  );
}

function rowOf(id: string): HTMLElement | null {
  return document.querySelector(`[data-css-property="${id}"]`);
}

/** What the first Box stores at the base address. */
function stored(): Record<string, unknown> {
  const node = findNode(editor().document.nodes, "box");
  return (node?.styles?.base?.[BASE_BREAKPOINT] ?? {}) as Record<
    string,
    unknown
  >;
}

/** The conditions only a flex or grid container, or child, meets. */
const FLEX_OR_GRID: ReadonlySet<AppliesWhen> = new Set([
  "flex-container",
  "grid-container",
  "flex-or-grid-container",
  "wrapping-flex-or-grid",
  "flex-child",
  "grid-child",
  "flex-or-grid-child",
]);

/** Whether a property (or a field of one) has an effect only in flex or grid. */
function flexOrGridOnly(id: string): boolean {
  const [property = "", field] = id.split(".");
  const entry = getStyleProperty(property);
  const conditions =
    (field === undefined ? undefined : entry?.fieldAppliesWhen?.[field]) ??
    entry?.appliesWhen ??
    [];
  return (
    conditions.length > 0 && conditions.every(each => FLEX_OR_GRID.has(each))
  );
}

describe("CSS properties replaces + More", () => {
  it("draws no + More in any section, and ends the tab with CSS properties", () => {
    mount();
    const panel = screen.getByRole("tabpanel");
    // Every section opened, so a "+ More" drawn in any of them is found.
    for (const trigger of panel.querySelectorAll<HTMLElement>(
      ".nx-style-inspector__section-trigger"
    )) {
      if (trigger.getAttribute("aria-expanded") !== "true") {
        fireEvent.click(trigger);
      }
    }
    expect(within(panel).queryByText("+ More")).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: /^More .* properties$/ })
    ).toBeNull();
    // The control: the sections are open, and the last is CSS properties.
    const sections = [
      ...panel.querySelectorAll<HTMLElement>("[data-section]"),
    ].map(each => each.getAttribute("data-section"));
    expect(sections.length).toBeGreaterThan(3);
    expect(sections.at(-1)).toBe("css-properties");
    expect(addButton()).toBeDefined();
  });
});

describe("+ Add CSS property", () => {
  it("lists on a Stack Box only what works on it, each by CSS name, plain name and section", () => {
    mount();
    openPicker();
    const ids = offered();
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.filter(flexOrGridOnly)).toEqual([]);
    const blend = screen.getByRole("option", { name: /^mix-blend-mode / });
    expect(blend.textContent).toBe("mix-blend-mode Mix blend mode Effects");
    expect(
      screen.getByText("Only properties that work on this block are listed.")
    ).toBeDefined();
  });

  it("lists a Grid Box's grid properties, which a Stack Box doesn't", () => {
    // The control for the case above: the filter is by what the block is.
    mount(pageOf(at({ display: "grid" }), STACK));
    openPicker();
    expect(offered()).toContain("gridAutoFlow");
    expect(offered().filter(flexOrGridOnly).length).toBeGreaterThan(0);
  });

  it("offers a Custom layout's rows and columns apart, which Arrange doesn't draw then", () => {
    // Column sizes with no plain words read as Arrange: Custom, whose raw
    // rows hold the layout; space between isn't drawn by Arrange there.
    mount(
      pageOf(at({ display: "grid", gridTemplateColumns: "1fr 2fr" }), STACK)
    );
    openPicker();
    expect(offered()).toContain("rowGap");
    expect(offered()).toContain("columnGap");
  });

  it("offers a Columns block's rows and columns apart, which no Arrange draws there", () => {
    // Columns draws its own layout in Content, so its Layout has no Arrange
    // to hold a gap; a row or column gap is added like any other.
    render(
      <Host
        page={
          {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "page",
            nodes: [
              nodeOf("columns", "core/columns", {
                props: { as: "div" },
                styles: at({ gridTemplateColumns: "1fr 1fr" }),
                slots: { children: [] },
              }),
            ],
          } as BlockDocument
        }
      />
    );
    act(() => editor().select("columns"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Style/ }));
    openSection(/^CSS properties/);
    openPicker();
    expect(offered()).toContain("rowGap");
    expect(offered()).toContain("columnGap");
  });

  it("keeps the option chosen from the keyboard in view", () => {
    mount();
    openPicker();
    const search = screen.getByRole("combobox", {
      name: "Search CSS properties",
    });
    const scrolled: Element[] = [];
    const scroll = window.Element.prototype.scrollIntoView;
    window.Element.prototype.scrollIntoView = function into(): void {
      scrolled.push(this as Element);
    };
    try {
      // Up from the first wraps to the last, past the list's first screen.
      fireEvent.keyDown(search, { key: "ArrowUp" });
      const options = screen.getAllByRole("option");
      const last = options.at(-1);
      expect(last?.getAttribute("aria-selected")).toBe("true");
      expect(scrolled.at(-1)).toBe(last);
      fireEvent.keyDown(search, { key: "ArrowDown" });
      expect(scrolled.at(-1)).toBe(options[0]);
    } finally {
      window.Element.prototype.scrollIntoView = scroll;
    }
  });

  it("narrows by what is typed, and picks with the keyboard", () => {
    mount();
    openPicker();
    const search = screen.getByRole("combobox", {
      name: "Search CSS properties",
    });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "blend" } });
    expect(offered()).toEqual(["mixBlendMode"]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(rowOf("mixBlendMode")).not.toBeNull();
  });

  it("closes on Escape, back to the button", () => {
    mount();
    openPicker();
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Search CSS properties" }),
      { key: "Escape" }
    );
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(addButton());
  });

  it("adds a picked property to CSS properties, its value focused, and keeps it there", () => {
    mount();
    pick("mix-blend-mode");
    const row = rowOf("mixBlendMode");
    expect(row).not.toBeNull();
    expect(row?.contains(document.activeElement)).toBe(true);
    // No longer offered: it is drawn.
    openPicker();
    expect(offered()).not.toContain("mixBlendMode");
  });

  it("says when nothing that applies is left", () => {
    mount();
    // Each offered property added in turn, until none is.
    for (let round = 0; round < 60; round += 1) {
      openPicker();
      const [next] = screen.queryAllByRole("option");
      if (next === undefined) break;
      fireEvent.click(next);
    }
    openPicker();
    expect(offered()).toEqual([]);
    expect(screen.getByText("Nothing left that applies here.")).toBeDefined();
  });
});

describe("removing an added property", () => {
  it("clears z-index and its row in one step, which one undo brings back", async () => {
    mount();
    pick("z-index");
    const field = within(rowOf("position.zIndex") as HTMLElement).getByRole(
      "textbox",
      { name: "z-index" }
    );
    // Its value is what the pick focused.
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "2" } });
    fireEvent.blur(field);
    expect(stored()).toEqual({ display: "block", position: { zIndex: 2 } });

    fireEvent.click(screen.getByRole("button", { name: "Remove z-index" }));

    expect(stored()).toEqual({ display: "block" });
    expect(rowOf("position.zIndex")).toBeNull();
    // The only row: focus goes back to "+ Add CSS property".
    expect(document.activeElement).toBe(addButton());

    await act(async () => {
      await editor().undo();
    });

    expect(stored()).toEqual({ display: "block", position: { zIndex: 2 } });
    expect(rowOf("position.zIndex")).not.toBeNull();
  });

  it("stays open, at + Add CSS property, once the last value it held is removed", () => {
    // Opened because it holds a value, with no fold of the author's: removing
    // that value must not close the section being worked in.
    mount(pageOf(at({ display: "block", mixBlendMode: "multiply" }), STACK));
    const section = screen.getByRole("button", { name: /^CSS properties/ });
    expect(section.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove mix-blend-mode" })
    );

    expect(stored()).toEqual({ display: "block" });
    expect(section.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(addButton());
  });

  it("takes focus to the next row", () => {
    mount();
    pick("mix-blend-mode");
    pick("filter");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter" }));
    expect(rowOf("filter")).toBeNull();
    expect(rowOf("mixBlendMode")?.contains(document.activeElement)).toBe(true);
  });

  it("keeps a property holding a value on its block, and not on the next", () => {
    mount(pageOf(at({ display: "block", position: { zIndex: 3 } }), STACK));
    expect(rowOf("position.zIndex")).not.toBeNull();
    act(() => editor().select("other"));
    expect(rowOf("position.zIndex")).toBeNull();
    act(() => editor().select("box"));
    expect(rowOf("position.zIndex")).not.toBeNull();
  });
});

describe("Find a setting offers to add", () => {
  it("lists a CSS property the block can use but hasn't added, with Add", () => {
    mount();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find a setting" }),
      {
        target: { value: "blend mode" },
      }
    );
    expect(rowOf("mixBlendMode")).toBeNull();
    const found = screen.getByRole("list", {
      name: "CSS properties you can add",
    });
    expect(found.textContent).toContain("mix-blend-mode");

    fireEvent.click(
      within(found).getByRole("button", { name: "Add mix-blend-mode" })
    );

    expect(rowOf("mixBlendMode")).not.toBeNull();
    expect(rowOf("mixBlendMode")?.contains(document.activeElement)).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Add mix-blend-mode" })
    ).toBeNull();
  });

  it("finds z-index by its other words", () => {
    mount();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find a setting" }),
      {
        target: { value: "layer order" },
      }
    );
    expect(screen.getByRole("button", { name: "Add z-index" })).toBeDefined();
  });
});
