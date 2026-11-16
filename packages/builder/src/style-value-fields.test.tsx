// @vitest-environment jsdom

/**
 * Spell-check and earlier-entry lists on the inspector's fields.
 *
 * A spell-checker marks "12px" or "#1d2b6b" with the same red wavy line an
 * error gets, so the Style tab's value fields must not be checked; the words
 * an author writes on the Content tab must still be. The two tabs are mounted
 * together through the inspector a host renders, so a rule set on the wrong
 * element (the inspector as a whole, say) cannot pass both halves.
 *
 * @module style-value-fields.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither, and a missing one
  // throws during render rather than failing an assertion.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

/** A heading-like block: text to write on Content, sizes to set on Style. */
function register(): void {
  registerBlocks(
    [
      {
        name: "acme/heading",
        version: 1,
        description: "A heading.",
        example: { props: { text: "Hello" } },
        editor: { label: "Heading" },
        props: { text: { type: "text" } },
        supports: { typography: true, color: true },
        render: () => null,
      },
    ] as never,
    { source: "style-value-fields-test" }
  );
}

function mount(): void {
  register();
  const document_ = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/heading",
        version: 1,
        props: { text: "Hello" },
      },
    ] as BlockNode[],
  } as BlockDocument;
  const editor = {
    document: document_,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document_),
    select: vi.fn(),
    apply: vi.fn(() => document_),
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

/**
 * Whether the browser spell-checks a field, by the attribute's own rule: the
 * nearest element, itself or an ancestor, that sets `spellcheck` decides, and
 * with none the browser's default applies, which checks text. Read this way
 * because jsdom does not compute the inherited `spellcheck` property.
 */
function spellChecked(field: HTMLElement): boolean {
  const decider = field.closest("[spellcheck]");
  return decider === null || decider.getAttribute("spellcheck") !== "false";
}

describe("spell-check on the inspector's fields", () => {
  it("keeps it on the Content tab, where the author writes words", () => {
    mount();

    expect(spellChecked(screen.getByRole("textbox", { name: "Text" }))).toBe(
      true
    );
  });

  it("turns it off, and the earlier-entry list, on a Style value field", () => {
    mount();
    // `mouseDown`, as the tab trigger activates on pointer-down.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    const typography = screen.getByRole("button", { name: /^Typography/ });
    if (typography.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(typography);
    }

    const size = screen.getByRole("textbox", { name: /^Font size/ });
    const lineHeight = screen.getByRole("textbox", { name: /^Line height/ });

    expect(spellChecked(size)).toBe(false);
    expect(spellChecked(lineHeight)).toBe(false);
    expect(size.getAttribute("autocomplete")).toBe("off");
    expect(lineHeight.getAttribute("autocomplete")).toBe("off");
  });

  it("turns it off in the colour picker too, which is drawn outside the tab", () => {
    /*
     * The picker opens in a layer at the end of the page, so the tab's own
     * setting does not reach it by inheritance; its hex field needs the
     * setting on the layer. Without it this field alone, of everything the
     * Style tab offers, would still show the red line under "#1d2b6b".
     */
    mount();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    const typography = screen.getByRole("button", { name: /^Typography/ });
    if (typography.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(typography);
    }
    fireEvent.click(screen.getByRole("button", { name: /^Colour for Colour/ }));
    fireEvent.click(screen.getByRole("button", { name: "Custom colour" }));
    const layer = document.querySelector("[data-radix-popper-content-wrapper]");
    if (!(layer instanceof HTMLElement)) throw new Error("no picker layer");
    const hex = within(layer).getByRole("textbox");
    // The control: the field really is outside the tab.
    expect(hex.closest(".nx-style-inspector")).toBeNull();

    expect(spellChecked(hex)).toBe(false);
  });
});
