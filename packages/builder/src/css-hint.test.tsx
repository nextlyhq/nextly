// @vitest-environment jsdom

/**
 * What a panel control writes, on hover or keyboard focus, and printed under
 * its label while "Show CSS names" is on.
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { keyboardFocus, withNavigationNoted } from "./css-hint";
import type { EditorState } from "./editor-state";
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

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    nodeOf("section", "core/section", {
      props: { as: "section", contained: true },
      styles: { base: { base: { minHeight: "40px" } } },
    }),
  ],
} as BlockDocument;

function mount(): void {
  const editor = {
    document: PAGE,
    selectedId: "section",
    selection: { ids: ["section"], primary: "section" },
    applyAll: vi.fn(() => PAGE),
    select: vi.fn(),
    apply: vi.fn(() => PAGE),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState;
  render(<InspectorPanel editor={editor} />);
}

function openTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

/** Open a section of the shown tab unless it is open. */
function openSection(key: string): void {
  const header = document.querySelector<HTMLElement>(
    `[role="tabpanel"]:not([hidden]) [data-section="${key}"] [data-slot="accordion-trigger"]`
  );
  if (header !== null && header.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header);
  }
}

/** Hover an element, and read the tooltip it opens. */
async function hintOn(element: Element): Promise<string> {
  fireEvent.pointerMove(element);
  const tip = await screen.findByRole("tooltip", {}, { timeout: 2000 });
  return tip.textContent ?? "";
}

/** The field a label names. */
function fieldOf(label: string): HTMLElement {
  const field = screen
    .getByText(label, { selector: ".nx-style-inspector__field-label-text" })
    .closest<HTMLElement>(".nx-inspector__field");
  if (field === null) throw new Error(`no field for ${label}`);
  return field;
}

describe("a control's tooltip says what it writes", () => {
  it("on a catalog control, with the value it holds", async () => {
    mount();
    openTab("Style");
    openSection("size");
    expect(await hintOn(fieldOf("Min height"))).toContain("min-height: 40px");
  });

  it("closes on Escape, and the Escape goes no further", async () => {
    mount();
    openTab("Style");
    openSection("size");
    await hintOn(fieldOf("Min height"));
    const escape = createEvent.keyDown(document.body, { key: "Escape" });
    fireEvent(document.body, escape);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    // Handled: the editor's own Escape, which moves the selection, skips it.
    expect(escape.defaultPrevented).toBe(true);
  });

  it("on a block shortcut's choice, as the shortcut writes it", async () => {
    mount();
    openTab("Style");
    openSection("size");
    const screenChoice = screen.getAllByRole("radio", {
      name: "Full screen",
    })[0];
    if (screenChoice === undefined) throw new Error("no Full screen choice");
    expect(await hintOn(screenChoice)).toContain("min-height: 100svh");
  });

  it("on the HTML tag menu, as the tag it writes", async () => {
    mount();
    openTab("Advanced");
    openSection("html");
    const tag = screen.getByRole("combobox", { name: "HTML tag" });
    expect(await hintOn(tag)).toContain("<section>");
  });

  it("on a built-in Advanced row: the Anchor writes the id", async () => {
    mount();
    openTab("Advanced");
    openSection("html");
    expect(
      await hintOn(screen.getByRole("textbox", { name: "Anchor (ID)" }))
    ).toBe("id");
  });

  it("on Content width's Boxed, as the class it puts on the block", async () => {
    mount();
    openTab("Style");
    openSection("layout");
    const boxed = within(
      screen.getByRole("radiogroup", { name: "Content width" })
    ).getByRole("radio", { name: "Boxed" });
    expect(await hintOn(boxed)).toBe('class="nx-pb-contained"');
  });
});

describe("the tooltip on keyboard focus", () => {
  it("opens when the author reaches the control with the keyboard", async () => {
    mount();
    openTab("Advanced");
    openSection("html");
    const anchor = screen.getByRole("textbox", { name: "Anchor (ID)" });
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => anchor.focus());
    const tip = await screen.findByRole("tooltip", {}, { timeout: 2000 });
    expect(tip.textContent).toBe("id");
  });

  it("stays closed when focus is only handed back, as after a menu closes", async () => {
    mount();
    openTab("Advanced");
    openSection("html");
    const anchor = screen.getByRole("textbox", { name: "Anchor (ID)" });
    // Escape, as closing a menu does: not a key that moves between controls.
    fireEvent.keyDown(document.body, { key: "Escape" });
    act(() => anchor.focus());
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(screen.queryByRole("tooltip")).toBe(null);
  });
});

describe("Show CSS names", () => {
  function toggleCssNames(): void {
    const options = screen.getByRole("button", { name: "Panel options" });
    fireEvent.keyDown(options, { key: "Enter" });
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Show CSS names" })
    );
  }

  it("prints each control's CSS names under its label while on, and describes it", () => {
    mount();
    openTab("Style");
    openSection("size");
    const field = fieldOf("Min height");
    expect(field.querySelector(".nx-css-names")).toBe(null);
    const input = within(field).getByRole("textbox", { name: /^Min height/ });
    expect(input.getAttribute("aria-describedby") ?? "").not.toMatch(/-css/);

    toggleCssNames();
    const names =
      fieldOf("Min height").querySelector<HTMLElement>(".nx-css-names");
    expect(names?.textContent).toBe("min-height");
    // Part of the control's description, for a screen reader, while shown.
    const described = within(fieldOf("Min height"))
      .getByRole("textbox", { name: /^Min height/ })
      .getAttribute("aria-describedby");
    expect(described?.split(" ")).toContain(names?.id);
    // A description, never a refusal: the field stays valid.
    const shownInput = within(fieldOf("Min height")).getByRole("textbox", {
      name: /^Min height/,
    });
    expect(shownInput.getAttribute("aria-invalid")).toBe(null);

    toggleCssNames();
    expect(fieldOf("Min height").querySelector(".nx-css-names")).toBe(null);
  });

  it("is off at first, and offered as an on and off item", () => {
    mount();
    const options = screen.getByRole("button", { name: "Panel options" });
    fireEvent.keyDown(options, { key: "Enter" });
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Show CSS names" })
        .getAttribute("aria-checked")
    ).toBe("false");
  });
});

describe("keyboard navigation, noted in the control's own document", () => {
  it("reads a Tab pressed in another document, as an editor drawn in a frame", () => {
    const frameDocument = document.implementation.createHTMLDocument("frame");
    const control = frameDocument.createElement("button");
    frameDocument.body.append(control);
    // Mounting the control notes its own document, not the page's.
    withNavigationNoted(undefined)(control);
    frameDocument.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
    );
    expect(keyboardFocus(control)).toBe(true);
    // Spent on that one focus.
    expect(keyboardFocus(control)).toBe(false);
  });

  it("CONTROL: a Tab pressed in the page says nothing about the frame", () => {
    const frameDocument = document.implementation.createHTMLDocument("frame");
    const control = frameDocument.createElement("button");
    frameDocument.body.append(control);
    withNavigationNoted(undefined)(control);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
    );
    expect(keyboardFocus(control)).toBe(false);
  });
});
