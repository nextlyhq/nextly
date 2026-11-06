// @vitest-environment jsdom

/**
 * An Accordion's icon and its position, drawn in the real Style panel.
 *
 * @module accordion-settings.test
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

/** An Accordion, selected, with what it stores. */
function mount(styles?: BlockNode["styles"]) {
  registerBlocks(
    [
      {
        name: "core/accordion",
        version: 1,
        description: "Accordion",
        example: { props: {} },
        editor: { label: "Accordion" },
        props: {},
        render: () => null,
        supports: { spacing: true, disclosure: true },
      },
    ] as never,
    { source: "accordion-settings-test" }
  );
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n",
        type: "core/accordion",
        version: 1,
        props: {},
        ...(styles === undefined ? {} : { styles }),
      },
    ],
  } as unknown as BlockDocument;
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
  } as unknown as EditorState & { applyAll: ReturnType<typeof vi.fn> };
  render(<StyleInspectorPanel editor={editor} />);
  return editor;
}

/** Open a section of the panel by its heading. */
function open(section: string): void {
  const heading = screen.getByRole("button", {
    name: new RegExp(`^${section}`),
  });
  if (heading.getAttribute("aria-expanded") !== "true")
    fireEvent.click(heading);
}

describe("an Accordion's Icon section", () => {
  it("names its rows Icon and Position, as an author says them", () => {
    mount();
    open("Icon");
    // Each control is named by its row's label.
    expect(screen.getByRole("radiogroup", { name: "Icon" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Position" })).toBeDefined();
  });

  it("offers each icon by name, and writes the one chosen", () => {
    const editor = mount();
    open("Icon");
    for (const name of ["Chevron", "Plus", "None", "Browser default"]) {
      expect(screen.getByRole("radio", { name })).toBeDefined();
    }
    fireEvent.click(screen.getByRole("radio", { name: "Plus" }));
    expect(JSON.stringify(editor.applyAll.mock.calls[0]?.[0])).toContain(
      '"disclosureIcon":"plus"'
    );
  });

  it("offers the icon's position as Before and After", () => {
    const editor = mount({
      base: { [BASE_BREAKPOINT]: { disclosurePosition: "after" } },
    });
    open("Icon");
    expect(
      screen.getByRole("button", { name: "After" }).getAttribute("aria-pressed")
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Before" }));
    expect(JSON.stringify(editor.applyAll.mock.calls[0]?.[0])).toContain(
      '"disclosurePosition":"before"'
    );
  });
});

describe("an Accordion's icon position, offered where an icon is drawn", () => {
  it("is not offered while the icon is the browser's own or none", () => {
    // An escaped spelling, which the engine reads as the same keyword.
    for (const icon of ["browser", "none", "br\\6f wser"]) {
      mount({ base: { [BASE_BREAKPOINT]: { disclosureIcon: icon } } });
      open("Icon");
      expect(screen.queryByRole("group", { name: "Position" })).toBeNull();
      cleanup();
      clearBlocks();
    }
  });

  it("is offered while a chevron or a plus is drawn", () => {
    mount({ base: { [BASE_BREAKPOINT]: { disclosureIcon: "plus" } } });
    open("Icon");
    expect(screen.getByRole("group", { name: "Position" })).toBeDefined();
  });
});
