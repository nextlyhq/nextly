// @vitest-environment jsdom

/**
 * The Style tab's words and marks: the site's variables are reached through
 * each field's own value menu, so no ◇ is drawn anywhere in it, as text or as
 * an icon, and no button is drawn for variables alone beside a menu.
 *
 * Rendered with every kind of field that offers variables, empty and holding
 * one, so a ◇ any of them drew would show here; and read from the source too,
 * since a field this panel does not reach here could still import the icon.
 *
 * @module style-tab-words.test
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { StyleInspectorPanel } from "./inspector/style-inspector/style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
  // Radix measures; jsdom provides no observer.
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "font-size.display", kind: "dimension", values: { light: "48px" } },
    {
      name: "line-height.display",
      kind: "dimension",
      values: { light: "56px" },
    },
    { name: "space.sm", kind: "dimension", values: { light: "8px" } },
    { name: "radius.pill", kind: "dimension", values: { light: "12px" } },
    { name: "weight.heavy", kind: "number", values: { light: "700" } },
    { name: "color.ink", kind: "color", values: { light: "#111111" } },
    {
      name: "shadow.soft",
      kind: "shadow",
      values: { light: "0 1px 2px rgb(0 0 0 / 0.2)" },
    },
  ],
};

function mount(values: Record<string, unknown>): void {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { text: { type: "text" } },
        supports: {
          typography: true,
          spacing: true,
          color: { text: true },
          border: { radius: true },
          shadow: true,
          effects: true,
        },
        render: () => null,
      },
    ] as never,
    { source: "style-tab-words-test" }
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
        styles: { base: { [BASE_BREAKPOINT]: values } } as NodeStyles,
      },
    ] as BlockNode[],
  } as BlockDocument;
  const editor = {
    document: document_,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document_),
    apply: vi.fn(() => document_),
    select: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState;
  render(<StyleInspectorPanel editor={editor} tokens={TOKENS} />);
}

/**
 * Every section opened in turn, with what each drew that could be a ◇, so a
 * section closed at first is read too, however many may be open at once.
 */
function diamondsInEverySection(): string[] {
  const found = [...diamondsDrawn()];
  const headers = document.querySelectorAll<HTMLElement>(
    '[data-section] [data-slot="accordion-trigger"]'
  );
  for (const header of headers) {
    if (header.getAttribute("aria-expanded") !== "true")
      fireEvent.click(header);
    found.push(...diamondsDrawn());
  }
  return found;
}

/** What the tab draws that could be a ◇: its text, its icons, its titles. */
function diamondsDrawn(): string[] {
  const found: string[] = [];
  if (document.body.textContent?.includes("◇") === true) found.push("text");
  for (const icon of document.querySelectorAll(".lucide-diamond")) {
    found.push(icon.outerHTML);
  }
  for (const titled of document.querySelectorAll("[title]")) {
    if (titled.getAttribute("title")?.includes("◇") === true) {
      found.push(titled.outerHTML);
    }
  }
  for (const named of document.querySelectorAll("[aria-label]")) {
    if (named.getAttribute("aria-label")?.includes("◇") === true) {
      found.push(named.outerHTML);
    }
  }
  return found;
}

describe("the Style tab draws no ◇", () => {
  it("on fields that offer variables and hold none", () => {
    mount({});
    expect(diamondsInEverySection()).toEqual([]);
    // The fields were there to draw one, so its absence is not an empty tab.
    expect(document.querySelector('[data-property="fontSize"]')).not.toBeNull();
    expect(
      document.querySelector('[aria-label="Variables for Line height"]')
    ).not.toBeNull();
    expect(
      document.querySelector('[aria-label="Unit for Font size"]')
    ).not.toBeNull();
    expect(document.querySelector('[title="Use a variable"]')).toBeNull();
  });

  it("on fields holding a variable", () => {
    mount({
      fontSize: { $token: "font-size.display" },
      lineHeight: { $token: "line-height.display" },
      borderRadius: { $token: "radius.pill" },
      fontWeight: { $token: "weight.heavy" },
      color: { $token: "color.ink" },
      boxShadow: { $token: "shadow.soft" },
    });
    expect(diamondsInEverySection()).toEqual([]);
    // Each held variable is a chip naming it, so the fields were drawn.
    expect(
      document.querySelectorAll(".nx-variable-chip").length
    ).toBeGreaterThanOrEqual(3);
  });

  it("in its source: no field imports the ◇ icon", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const importers = (readdirSync(root, { recursive: true }) as string[])
      .filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter(file =>
        /import\s*\{[^}]*\bDiamond\b[^}]*\}\s*from\s*"lucide-react"/.test(
          readFileSync(join(root, file), "utf8")
        )
      );
    expect(importers).toEqual([]);
  });
});
