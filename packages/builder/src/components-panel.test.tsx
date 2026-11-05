// @vitest-environment jsdom

/**
 * The Components panel: that it lists the site's components by name with a
 * search, says plainly when there are none, and places one through the Add
 * panel's own path, by click, by keyboard and by drag, offering "Edit" only
 * where the host does.
 *
 * Where a component may go is not re-asserted here: `inserter.test.ts` holds
 * the placement rule. What is asserted is that this panel reaches the same
 * answer and the same op as Add's tile for the same component.
 *
 * @module components-panel.test
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";

import { ComponentsPanel } from "./components-panel";
import { EditorRail } from "./editor-rail";
import type { EditorState } from "./editor-state";
import { InsertPanel } from "./insert-panel";
import { EMPTY_SELECTION } from "./selection";
import type { LeftPanel } from "./shell-state";

beforeAll(() => {
  // The command primitives Add is drawn with observe their list, and jsdom
  // has no ResizeObserver; the same gap for the scroll into view.
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

function registerText(): void {
  registerBlocks(
    [
      { ...base, name: "acme/text", editor: { label: "Text" } },
      { ...base, name: "acme/heading", editor: { label: "Heading" } },
      { ...base, name: "acme/columns", slots: { children: {} } },
      { ...base, name: "acme/column", parent: ["acme/columns"] },
    ] as never,
    { source: "acme" }
  );
}

function node(id: string, type: string): BlockNode {
  return { id, type, version: 1, props: {} };
}

function documentOf(nodes: BlockNode[] = []): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** A component whose one root is a block of `rootType`. */
function component(
  id: string,
  title: string,
  rootType = "acme/text",
  description?: string
) {
  return {
    id,
    title,
    ...(description === undefined ? {} : { description }),
    document: {
      formatVersion: 1,
      kind: "component",
      nodes: [{ id: `${id}-root`, type: rootType, version: 1, props: {} }],
    } as unknown as ComponentDocument,
  };
}

function lookupFor(
  ...rows: { id: string; document: ComponentDocument }[]
): Map<string, ComponentDocument> {
  return new Map(rows.map(row => [row.id, row.document]));
}

/** An editor whose `apply` is observed, selecting `selectedId`. */
function editorSpy(
  document: BlockDocument,
  selectedId: string | null = null
): EditorState & {
  apply: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
} {
  return {
    document,
    limits: DEFAULT_LIMITS,
    selectedId,
    selection:
      selectedId === null
        ? EMPTY_SELECTION
        : { ids: [selectedId], primary: selectedId },
    select: vi.fn(),
    apply: vi.fn(() => document),
    applyAll: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
  } as unknown as EditorState & {
    apply: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
}

const PROMO = component("promo", "Promo card", "acme/text", "A card.");
const BAND = component("band", "CTA band");

/** The button that places a component, by its exact name. */
function placeButton(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** The names of the rows drawn, in order. */
function rowNames(): (string | null)[] {
  return [...document.querySelectorAll("[data-component-row-place]")].map(row =>
    row.getAttribute("aria-label")
  );
}

function described(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(id => id !== "")
    .map(id => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof ComponentsPanel>> & {
    editor: EditorState;
  }
) {
  return render(
    <ComponentsPanel
      components={[PROMO, BAND]}
      componentDefinitions={lookupFor(PROMO, BAND)}
      {...props}
    />
  );
}

describe("the Components panel's list", () => {
  it("lists the site's components by name, in the order Add offers them", () => {
    registerText();
    renderPanel({ editor: editorSpy(documentOf()) });

    expect(rowNames()).toEqual(["Promo card", "CTA band"]);
    expect(described(placeButton("Promo card"))).toBe("A card.");
  });

  it("narrows the list by the search, and says when nothing matches", () => {
    registerText();
    renderPanel({ editor: editorSpy(documentOf()) });
    const search = screen.getByRole("searchbox", { name: "Search components" });

    fireEvent.change(search, { target: { value: "promo" } });
    expect(rowNames()).toEqual(["Promo card"]);

    fireEvent.change(search, { target: { value: "footer" } });
    expect(rowNames()).toEqual([]);
    expect(screen.getByText("No components match “footer”.")).toBeTruthy();
  });

  it("says plainly that the site has none, and how to make one", () => {
    registerText();
    renderPanel({
      editor: editorSpy(documentOf()),
      components: [],
      componentDefinitions: new Map(),
      mayCreate: true,
    });

    expect(screen.getByText("This site has no components yet.")).toBeTruthy();
    expect(screen.getByText(/choose Turn into component/)).toBeTruthy();
    expect(rowNames()).toEqual([]);
  });

  it("does not tell an author who may not make one how to", () => {
    registerText();
    renderPanel({
      editor: editorSpy(documentOf()),
      components: [],
      componentDefinitions: new Map(),
    });

    expect(screen.getByText("This site has no components yet.")).toBeTruthy();
    expect(screen.queryByText(/Turn into component/)).toBeNull();
  });

  it("says none can go inside the component being edited, not that the site has none", () => {
    registerText();
    renderPanel({
      editor: editorSpy(documentOf()),
      components: [],
      componentDefinitions: new Map(),
      withheld: 1,
    });

    expect(
      screen.getByText("No other component can be placed inside this one.")
    ).toBeTruthy();
    expect(screen.queryByText("This site has no components yet.")).toBeNull();
  });

  it("draws placeholders while the read is on its way, and claims nothing", () => {
    registerText();
    const { container } = renderPanel({
      editor: editorSpy(documentOf()),
      components: [],
      componentDefinitions: new Map(),
      loading: true,
    });

    expect(screen.getByRole("status").textContent).toBe("Loading components…");
    expect(
      container.querySelectorAll(".nx-components-panel__placeholder")
    ).toHaveLength(3);
    expect(screen.queryByText("This site has no components yet.")).toBeNull();
  });

  it("says a read that failed could not be loaded, with the retry, and not that there are none", () => {
    registerText();
    const retry = vi.fn();
    renderPanel({
      editor: editorSpy(documentOf()),
      components: [],
      componentDefinitions: new Map(),
      library: { components: "unavailable", retry },
    });

    expect(
      screen.getByText(/The site’s components could not be loaded/)
    ).toBeTruthy();
    expect(screen.queryByText("This site has no components yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("placing a component from the panel", () => {
  it("names the place first, and places ONE instance after the selected block", () => {
    registerText();
    const editor = editorSpy(
      documentOf([node("h", "acme/heading"), node("t", "acme/text")]),
      "h"
    );
    renderPanel({ editor });

    expect(screen.getByText(/Adding after/).textContent).toBe(
      "Adding after Heading"
    );
    fireEvent.click(placeButton("Promo card"));

    expect(editor.apply).toHaveBeenCalledTimes(1);
    const op = editor.apply.mock.calls[0][0] as {
      kind: string;
      node: BlockNode;
      at: unknown;
    };
    expect(op.kind).toBe("insert");
    expect(op.node.type).toBe(COMPONENT_INSTANCE_TYPE);
    expect(op.node.props).toEqual({ componentId: "promo" });
    expect(op.at).toEqual({ index: 1 });
    // Selected, so a second placement lands after this one.
    expect(editor.select).toHaveBeenCalledWith(op.node.id);
  });

  it("places at the end of an empty page", () => {
    registerText();
    const editor = editorSpy(documentOf());
    renderPanel({ editor });

    expect(screen.getByText(/Adding at/).textContent).toBe(
      "Adding at the end of the page"
    );
    fireEvent.click(placeButton("CTA band"));
    expect(editor.apply.mock.calls[0][0].at).toEqual({ index: 0 });
  });

  it("places exactly as Add's tile for the same component does", () => {
    // The one placement path: the same op, at the same place, from either
    // panel. A second path that computed its own place would pass the cases
    // above and disagree here once the two rules drifted.
    registerText();
    const doc = documentOf([node("h", "acme/heading"), node("t", "acme/text")]);
    const fromPanel = editorSpy(doc, "h");
    renderPanel({ editor: fromPanel });
    fireEvent.click(placeButton("Promo card"));
    cleanup();

    const fromAdd = editorSpy(doc, "h");
    render(
      <InsertPanel
        editor={fromAdd}
        components={[PROMO, BAND]}
        componentDefinitions={lookupFor(PROMO, BAND)}
      />
    );
    fireEvent.click(screen.getByRole("option", { name: "Promo card" }));

    const opOf = (editor: typeof fromAdd) => {
      const op = editor.apply.mock.calls[0][0] as {
        kind: string;
        node: BlockNode;
        at: unknown;
      };
      return {
        kind: op.kind,
        type: op.node.type,
        props: op.node.props,
        at: op.at,
      };
    };
    expect(opOf(fromPanel)).toEqual(opOf(fromAdd));
  });

  it("refuses a component the place cannot hold, saying why, and places nothing", () => {
    registerText();
    const column = component("col", "Column card", "acme/column");
    const editor = editorSpy(documentOf());
    renderPanel({
      editor,
      components: [column],
      componentDefinitions: lookupFor(column),
    });

    const row = placeButton("Column card");
    expect(row.closest("li")?.getAttribute("data-refused")).toBe("true");
    expect(described(row)).not.toBe("");
    fireEvent.click(row);
    expect(editor.apply).not.toHaveBeenCalled();
  });
});

describe("a component with nothing in it to place", () => {
  /** A published row saved without content, as the route may hand one. */
  const EMPTY = { id: "empty", title: "Empty card", document: null };

  it("is listed, says why it cannot be placed, and places nothing", () => {
    registerText();
    const editor = editorSpy(documentOf());
    renderPanel({
      editor,
      components: [EMPTY],
      componentDefinitions: new Map(),
    });

    const row = placeButton("Empty card");
    expect(row.closest("li")?.getAttribute("data-refused")).toBe("true");
    expect(described(row)).toBe("Nothing in it can be placed yet.");
    expect(screen.queryByText("This site has no components yet.")).toBeNull();
    fireEvent.click(row);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("can still be opened, to be filled", () => {
    registerText();
    const onEditComponent = vi.fn();
    renderPanel({
      editor: editorSpy(documentOf()),
      components: [EMPTY, PROMO],
      componentDefinitions: lookupFor(PROMO),
      onEditComponent,
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Empty card" }));
    expect(onEditComponent).toHaveBeenCalledWith("empty");
    expect(rowNames()).toEqual(["Empty card", "Promo card"]);
  });
});

describe("placing by keyboard", () => {
  it("moves from the search into the rows and between them with the arrows", () => {
    registerText();
    renderPanel({ editor: editorSpy(documentOf()) });
    const search = screen.getByRole("searchbox", { name: "Search components" });

    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(placeButton("Promo card"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(placeButton("CTA band"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(search);
  });

  it("places the first match when Enter is pressed in the search, as Add does", () => {
    registerText();
    const editor = editorSpy(documentOf());
    renderPanel({ editor });
    const search = screen.getByRole("searchbox", { name: "Search components" });

    fireEvent.change(search, { target: { value: "promo" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply.mock.calls[0][0].node.props).toEqual({
      componentId: "promo",
    });
  });

  it("places nothing on Enter in an empty search", () => {
    registerText();
    const editor = editorSpy(documentOf());
    renderPanel({ editor });
    fireEvent.keyDown(
      screen.getByRole("searchbox", { name: "Search components" }),
      { key: "Enter" }
    );
    expect(editor.apply).not.toHaveBeenCalled();
  });
});

describe("dragging a component onto the canvas", () => {
  it("starts the drag with the instance it places", () => {
    registerText();
    const editor = editorSpy(documentOf());
    const beginInsertDrag = vi.fn();
    renderPanel({ editor, beginInsertDrag });

    fireEvent.pointerDown(placeButton("Promo card"), {
      button: 0,
      pointerId: 1,
    });

    expect(beginInsertDrag).toHaveBeenCalledTimes(1);
    const entry = beginInsertDrag.mock.calls[0][1];
    expect(entry.blockName).toBe(COMPONENT_INSTANCE_TYPE);
    const made = entry.makeNode();
    expect(made.type).toBe(COMPONENT_INSTANCE_TYPE);
    expect(made.props).toEqual({ componentId: "promo" });
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("is offered from Add's tile for a component too, the same way", () => {
    registerText();
    const beginInsertDrag = vi.fn();
    render(
      <InsertPanel
        editor={editorSpy(documentOf())}
        components={[PROMO]}
        componentDefinitions={lookupFor(PROMO)}
        beginInsertDrag={beginInsertDrag}
      />
    );

    fireEvent.pointerDown(screen.getByRole("option", { name: "Promo card" }), {
      button: 0,
      pointerId: 1,
    });

    expect(beginInsertDrag).toHaveBeenCalledTimes(1);
    const entry = beginInsertDrag.mock.calls[0][1];
    expect(entry.blockName).toBe(COMPONENT_INSTANCE_TYPE);
    expect(entry.makeNode().props).toEqual({ componentId: "promo" });
  });
});

describe("Edit, on each row", () => {
  it("is offered where the host opens a component, and opens the row's", () => {
    registerText();
    const onEditComponent = vi.fn();
    const editor = editorSpy(documentOf());
    renderPanel({ editor, onEditComponent });

    fireEvent.click(screen.getByRole("button", { name: "Edit Promo card" }));

    expect(onEditComponent).toHaveBeenCalledWith("promo");
    // Opening is not placing.
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("is not offered at all to an author the host offers no edit to", () => {
    registerText();
    renderPanel({ editor: editorSpy(documentOf()) });

    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    // Placing is still offered.
    expect(placeButton("Promo card")).toBeTruthy();
  });
});

describe("the rail's Components item", () => {
  function railWith(available: readonly LeftPanel[]): void {
    // Inside the shortcut owner, as the shell draws the rail: its items
    // register their panels' keys.
    render(
      <ShortcutProvider>
        <EditorRail
          openPanel={null}
          isAvailable={panel => available.includes(panel)}
          onSelect={() => {}}
          onHelp={() => {}}
          railRef={() => {}}
        />
      </ShortcutProvider>
    );
  }

  it("is on the rail when the host offers the panel", () => {
    railWith(["add", "layers", "components", "design"]);
    expect(screen.getByRole("button", { name: "Components" })).toBeTruthy();
  });

  it("is not on the rail when the host does not", () => {
    railWith(["add", "layers", "design"]);
    expect(screen.queryByRole("button", { name: "Components" })).toBeNull();
  });
});
