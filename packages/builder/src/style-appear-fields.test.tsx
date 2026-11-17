// @vitest-environment jsdom

/**
 * "Animation when it appears" on the Style tab: in Effects, named above its
 * four rows, each in an author's words, with the times in milliseconds and
 * the start a menu, since its two choices are sentences.
 *
 * @module style-appear-fields.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
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

/** A box offering Effects, its animation set as given. */
function mount(appear?: Record<string, unknown>): EditorState {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: {},
        supports: { effects: true },
        render: () => null,
      },
    ] as never,
    { source: "style-appear-fields-test" }
  );
  const document_ = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/box",
        version: 1,
        props: {},
        ...(appear === undefined
          ? {}
          : { styles: { base: { base: { appear } } } }),
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
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
  const effects = screen.getByRole("button", {
    name: /^Effects(has changes)?$/,
  });
  if (effects.getAttribute("aria-expanded") !== "true")
    fireEvent.click(effects);
  return editor;
}

/** The setting's own part of the panel. */
function setting(): HTMLElement {
  const found = document.querySelector('[data-property="appear"]');
  if (!(found instanceof HTMLElement)) throw new Error("no animation setting");
  return found;
}

describe("Animation when it appears", () => {
  it("shows in Effects, named above its effect, duration, delay and start", () => {
    mount();
    const own = setting();
    expect(own.textContent).toContain("Animation when it appears");
    for (const row of ["Effect", "Duration", "Delay", "Start"]) {
      expect(own.textContent).toContain(row);
    }
  });

  it("gives each time its unit, in milliseconds", () => {
    mount();
    const own = setting();
    const duration = screen.getByRole("textbox", { name: /^Duration/ });
    expect(own.contains(duration)).toBe(true);
    // The sign beside it, and the words a screen reader is given instead.
    expect(
      duration.closest(".nx-style-inspector__unit-field")?.textContent
    ).toContain("ms");
    const described = (duration.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map(id => document.getElementById(id)?.textContent ?? "");
    expect(described).toContain("milliseconds");
  });

  it("offers the start as a menu in words, since a row of buttons cannot hold them", () => {
    mount({ effect: "rise", start: "load" });
    const own = setting();
    // No pressed buttons for the two starts: a menu showing the choice.
    expect(own.querySelector("[aria-pressed]")).toBeNull();
    expect(own.textContent).toContain("When the page loads");
    expect(own.textContent).toContain("Rise");
  });
});
