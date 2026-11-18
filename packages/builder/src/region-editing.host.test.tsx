// @vitest-environment jsdom

/**
 * Editing a header or footer in place, on a test host built the way an editor
 * composes the builder's parts: one `useEditingTarget` over the page's state,
 * its ACTIVE state handed to the canvas, Layers, the inspector, the Add panel
 * and the keyboard, the bar in the strip and the dim over the canvas. The
 * host supplies the region's document and every word; nothing here is wired
 * to a real header yet.
 *
 * What only this proves: that the parts, handed one switch, all move to the
 * region together, and all come back to the page together.
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { ShortcutProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Canvas } from "./canvas/canvas";
import type { CanvasRegion } from "./canvas/canvas-regions";
import { RegionEditingScrim } from "./canvas/region-editing-scrim";
import {
  canvasEditingOf,
  regionEscape,
  useEditingTarget,
  type EditingTargetState,
  type RegionEditing,
} from "./editing-target";
import { useEditorState, type EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import { BlockKeyboardActions } from "./keyboard-actions";
import { InsertPanel } from "./panels/add/insert-panel";
import { LayersPanel } from "./panels/layers/layers-panel";
import { RegionEditingBar } from "./region-editing-bar";
import { CANVAS_ROOT_CLASS } from "./shell-state";

beforeAll(() => {
  // The tree virtualizes and the Add panel scrolls its rows into view: jsdom
  // measures nothing and observes nothing, so both are stood in for.
  window.Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  // The canvas and its regions, laid out as a browser would: the header the
  // first 100px of an 800px canvas (the height the stand-ins below report), the footer the last 100px, so the dim has
  // something to be drawn around.
  const measured = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function rect(
    this: Element
  ): DOMRect {
    const box = (top: number, height: number) =>
      ({
        x: 0,
        y: top,
        left: 0,
        top,
        width: 800,
        height,
        right: 800,
        bottom: top + height,
        toJSON: () => ({}),
      }) as DOMRect;
    if (this.classList.contains(CANVAS_ROOT_CLASS)) return box(0, 800);
    const area = this.getAttribute("data-nx-region");
    if (area === "header") return box(0, 100);
    if (area === "footer") return box(700, 100);
    return measured.call(this);
  };
  for (const property of ["clientHeight", "offsetHeight"]) {
    Object.defineProperty(window.HTMLElement.prototype, property, {
      configurable: true,
      value: 800,
    });
  }
});

const base = { version: 1, description: "A block.", example: { props: {} } };

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/text",
        editor: { label: "Text" },
        render: ({
          className,
          props,
        }: {
          className: string;
          props: { text?: string };
        }) => createElement("p", { className }, props.text),
      },
      {
        ...base,
        name: "acme/nav",
        editor: { label: "Navigation" },
        render: ({
          className,
          props,
        }: {
          className: string;
          props: { text?: string };
        }) => createElement("nav", { className }, props.text),
      },
    ] as never,
    { source: "region-editing-host" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

function node(id: string, type: string, text: string): BlockNode {
  return { id, type, version: 1, props: { text } } as BlockNode;
}

function doc(kind: "page" | "component", nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind, nodes } as BlockDocument;
}

const PAGE = doc("page", [node("hero", "acme/text", "Welcome")]);
const HEADER = doc("component", [node("menu", "acme/nav", "Main menu")]);
const FOOTER = doc("component", [node("legal", "acme/text", "Legal")]);

/** The regions as drawn around the page, from their published documents. */
const REGIONS: readonly CanvasRegion[] = [
  {
    area: "header",
    document: HEADER,
    label: "Site header, from the Main header & footer",
    badge: "Site header · Main",
    name: "Site header",
  },
  {
    area: "footer",
    document: FOOTER,
    label: "Site footer, from the Main header & footer",
    badge: "Site footer · Main",
    name: "Site footer",
  },
];

/** What the host hands over to edit a region: its document and words. */
function editingFor(area: "header" | "footer"): RegionEditing {
  const name = area === "header" ? "header" : "footer";
  return {
    area,
    document: area === "header" ? HEADER : FOOTER,
    label: area === "header" ? "Site header" : "Site footer",
    words: {
      bar: `Editing the site ${name} · changes show on 11 pages`,
      done: "Done",
      entered: `Editing the site ${name}. Changes show on 11 pages.`,
      left: "Back to the page.",
    },
  };
}

const sheet = { breakpoints: { viewport: [], container: [] } };

/** The host's states, read by the tests after each step. */
const seen: { page?: EditorState; editing?: EditingTargetState } = {};

function TestHost(): React.JSX.Element {
  const page = useEditorState({ initialDocument: PAGE });
  const editing = useEditingTarget(page);
  seen.page = page;
  seen.editing = editing;
  const { active, target } = editing;
  const region = target.kind === "region" ? target : undefined;
  return (
    <ShortcutProvider>
      <BlockKeyboardActions
        editor={active}
        onSaveAsPattern={() => undefined}
        onEscapeWithoutSelection={regionEscape(editing, {})}
      >
        <RegionEditingBar editing={editing} />
        <aside aria-label="Layers panel">
          <LayersPanel editor={active} editedRegion={region} />
        </aside>
        <aside aria-label="Add panel">
          <InsertPanel editor={active} />
        </aside>
        <aside aria-label="Inspector">
          <InspectorPanel editor={active} editingIn={region?.label} />
        </aside>
        <Canvas
          document={page.document}
          siteStyles={sheet as never}
          render={{ styleContext: sheet } as never}
          regions={REGIONS}
          selectedId={active.selectedId}
          selectedIds={active.selection.ids}
          onSelect={active.select}
          onEditRegion={area => editing.enter(editingFor(area))}
          {...(region === undefined
            ? {}
            : { editingRegion: canvasEditingOf(editing) })}
          overlay={
            <RegionEditingScrim
              area={region?.area}
              onPress={editing.pulseDone}
            />
          }
        />
      </BlockKeyboardActions>
    </ShortcutProvider>
  );
}

function current(): { page: EditorState; editing: EditingTargetState } {
  if (seen.page === undefined || seen.editing === undefined) {
    throw new Error("the host has not rendered");
  }
  return { page: seen.page, editing: seen.editing };
}

function ids(document: BlockDocument): string[] {
  return document.nodes.map(child => child.id);
}

function regionFrame(area: "header" | "footer"): HTMLElement {
  const frame = document.querySelector(`[data-nx-region="${area}"]`);
  if (!(frame instanceof HTMLElement)) throw new Error(`no ${area} drawn`);
  return frame;
}

function press(key: string): void {
  act(() => {
    window.document.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    );
  });
}

/** Into the header, the way an author goes: a double-click on it. */
function enterHeader(): void {
  fireEvent.doubleClick(regionFrame("header"));
}

describe("editing the site header in place", () => {
  it("dims the page and takes it out of reach, under the bar with the host's words", () => {
    render(<TestHost />);
    enterHeader();
    expect(
      screen.getByText("Editing the site header · changes show on 11 pages")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    // The page and the footer: drawn, inert, hidden, under the dim.
    for (const text of ["Welcome", "Legal"]) {
      const drawn = screen.getByText(text);
      expect(drawn.closest("[inert]"), text).not.toBeNull();
      expect(drawn.closest('[aria-hidden="true"]'), text).not.toBeNull();
    }
    // Under the header, the rest of the canvas: one band, below it.
    const dims = Array.from(
      document.querySelectorAll<HTMLElement>(".nx-region-scrim__dim")
    );
    expect(dims.map(dim => [dim.style.top, dim.style.height])).toEqual([
      ["100px", "700px"],
    ]);
  });

  it("shows the header's blocks in Layers, under its name, with focus on the first", () => {
    render(<TestHost />);
    enterHeader();
    const layers = within(
      screen.getByRole("complementary", { name: "Layers panel" })
    );
    expect(
      layers.getByRole("heading", { name: "Layers · Site header" })
    ).toBeTruthy();
    const rows = layers.getAllByRole("treeitem");
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining("Navigation"),
    ]);
    expect(document.activeElement).toBe(rows[0]);
  });

  it("starts Layers' search afresh in the header, so a page search hides none of its rows", () => {
    render(<TestHost />);
    const layers = within(
      screen.getByRole("complementary", { name: "Layers panel" })
    );
    fireEvent.change(layers.getByRole("textbox", { name: "Search layers" }), {
      target: { value: "Text" },
    });
    enterHeader();
    expect(
      (
        layers.getByRole("textbox", {
          name: "Search layers",
        }) as HTMLInputElement
      ).value
    ).toBe("");
    const rows = layers.getAllByRole("treeitem");
    expect(rows).toHaveLength(1);
    expect(document.activeElement).toBe(rows[0]);
  });

  it("edits a header block in the inspector, which says where it is", () => {
    render(<TestHost />);
    enterHeader();
    fireEvent.click(screen.getByText("Main menu"));
    expect(current().editing.active.selectedId).toBe("menu");
    const inspector = within(
      screen.getByRole("complementary", { name: "Inspector" })
    );
    // Read as text: the card draws "· in Site header" in a span of its own.
    expect(inspector.getByRole("heading").textContent).toBe(
      "Navigation · in Site header"
    );
    // The page's selection is not where the click went.
    expect(current().page.selectedId).toBeNull();
  });

  it("changes nothing on a press of the dimmed page, and highlights Done", () => {
    render(<TestHost />);
    act(() => current().page.select("hero"));
    enterHeader();
    const [dim] = Array.from(
      document.querySelectorAll(".nx-region-scrim__dim")
    );
    if (dim === undefined) throw new Error("no dim drawn");
    const page = current().page.document;
    fireEvent.click(dim);
    expect(
      screen.getByRole("button", { name: "Done" }).hasAttribute("data-pulsing")
    ).toBe(true);
    expect(current().page.document).toBe(page);
    expect(current().page.selectedId).toBe("hero");
    expect(current().editing.target.kind).toBe("region");
  });

  it("inserts from the Add panel into the header, never the page", () => {
    render(<TestHost />);
    enterHeader();
    const add = within(
      screen.getByRole("complementary", { name: "Add panel" })
    );
    fireEvent.click(add.getByRole("option", { name: "Text" }));
    const { page, editing } = current();
    expect(ids(editing.active.document)).toHaveLength(2);
    expect(ids(editing.active.document)[0]).toBe("menu");
    expect(ids(page.document)).toEqual(["hero"]);
    expect(page.canUndo).toBe(false);
  });

  it("announces entering and leaving, and gives the header back its focus", () => {
    render(<TestHost />);
    const live = document.querySelector("[data-nx-region-announcer]");
    if (live === null) throw new Error("no announcer drawn");
    enterHeader();
    expect(live.textContent).toBe(
      "Editing the site header. Changes show on 11 pages."
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(live.textContent).toBe("Back to the page.");
    expect(document.activeElement).toBe(regionFrame("header"));
    // The page is back in reach and heard again.
    const welcome = screen.getByText("Welcome");
    expect(welcome.closest("[inert]")).toBeNull();
    expect(welcome.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("leaves the innermost thing first on Escape: the selection, then the header", () => {
    render(<TestHost />);
    enterHeader();
    fireEvent.click(screen.getByText("Main menu"));
    press("Escape");
    // The header's block is let go; the header is still edited.
    expect(current().editing.active.selectedId).toBeNull();
    expect(current().editing.target.kind).toBe("region");
    press("Escape");
    expect(current().editing.target.kind).toBe("page");
  });

  it("steps Undo through the header's edits only, and never reaches them after Done", () => {
    render(<TestHost />);
    act(() => {
      current().page.apply({
        kind: "insert",
        node: node("intro", "acme/text", "Intro"),
        at: { index: 1 },
      });
    });
    enterHeader();
    const add = within(
      screen.getByRole("complementary", { name: "Add panel" })
    );
    fireEvent.click(add.getByRole("option", { name: "Text" }));
    fireEvent.click(add.getByRole("option", { name: "Navigation" }));
    expect(ids(current().editing.active.document)).toHaveLength(3);
    for (let step = 0; step < 3; step += 1) {
      act(() => {
        current().editing.active.undo();
      });
    }
    expect(ids(current().editing.active.document)).toEqual(["menu"]);
    expect(ids(current().page.document)).toEqual(["hero", "intro"]);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    act(() => {
      current().editing.active.undo();
    });
    expect(ids(current().page.document)).toEqual(["hero"]);
    expect(current().editing.active.canUndo).toBe(false);
  });
});

describe("editing the site footer in place", () => {
  it("behaves the same, in the footer's words", () => {
    render(<TestHost />);
    fireEvent.doubleClick(regionFrame("footer"));
    expect(
      screen.getByText("Editing the site footer · changes show on 11 pages")
    ).toBeTruthy();
    const layers = within(
      screen.getByRole("complementary", { name: "Layers panel" })
    );
    expect(
      layers.getByRole("heading", { name: "Layers · Site footer" })
    ).toBeTruthy();
    for (const text of ["Welcome", "Main menu"]) {
      expect(screen.getByText(text).closest("[inert]"), text).not.toBeNull();
    }
    fireEvent.click(screen.getByText("Legal"));
    const inspector = within(
      screen.getByRole("complementary", { name: "Inspector" })
    );
    expect(inspector.getByRole("heading").textContent).toBe(
      "Text · in Site footer"
    );
    const add = within(
      screen.getByRole("complementary", { name: "Add panel" })
    );
    fireEvent.click(add.getByRole("option", { name: "Navigation" }));
    expect(ids(current().editing.active.document)).toHaveLength(2);
    expect(ids(current().page.document)).toEqual(["hero"]);
  });
});
