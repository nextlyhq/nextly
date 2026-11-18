// @vitest-environment jsdom

/**
 * An Accordion's icon position, drawn in the real Style panel. The icon
 * itself is chosen in the Content tab (`accordion-question-settings.test.tsx`).
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
  it("holds Icon position alone: the icon is chosen in Content", () => {
    mount();
    open("Icon");
    expect(screen.getByRole("group", { name: "Icon position" })).toBeDefined();
    expect(screen.queryByRole("radiogroup", { name: "Icon" })).toBeNull();
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
  it("is not offered while the icon is none", () => {
    // An escaped spelling, which the engine reads as the same keyword.
    for (const icon of ["none", "n\\6f ne"]) {
      mount({ base: { [BASE_BREAKPOINT]: { disclosureIcon: icon } } });
      // Its one row hidden, the section has nothing to open.
      expect(screen.queryByRole("button", { name: /^Icon/ })).toBeNull();
      expect(screen.queryByRole("group", { name: "Icon position" })).toBeNull();
      cleanup();
      clearBlocks();
    }
  });

  it("is offered while a chevron, a plus or a stored Browser default is drawn", () => {
    for (const icon of ["plus", "chevron", "browser"]) {
      mount({ base: { [BASE_BREAKPOINT]: { disclosureIcon: icon } } });
      open("Icon");
      expect(
        screen.getByRole("group", { name: "Icon position" })
      ).toBeDefined();
      cleanup();
      clearBlocks();
    }
  });
});
