// @vitest-environment jsdom

/**
 * A type size picked in a block's font size field carries its line height:
 * set with it where the block has none of its own ("From H2 type size",
 * with "Detach"), and offered where it has ("Use H2's line height"). A
 * picked type size reads by its name and pair ("H2 · 28 / 1.2").
 *
 * @module type-size-pair.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  compilePageCss,
  registerBlocks,
  resolveSiteTokens,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type SiteTokenSet,
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
import { applyOps, type BuilderOp } from "./ops";
import { StyleInspectorPanel } from "./style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
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

/** The engine's built-in variables, the H1–H6 and Small type sizes among them. */
const TOKENS = resolveSiteTokens(undefined);

/** The Style tab over one text block holding these values. */
function mount(
  values: Record<string, unknown> = {},
  tokens: SiteTokenSet = TOKENS
) {
  registerBlocks(
    [
      {
        name: "acme/text",
        version: 1,
        description: "A text.",
        example: { props: {} },
        editor: { label: "Text" },
        props: { text: { type: "text" } },
        supports: { typography: true },
        render: () => null,
      },
    ] as never,
    { source: "type-size-pair-test" }
  );
  const document_ = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/text",
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
    select: vi.fn(),
    apply: vi.fn(() => document_),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { applyAll: ReturnType<typeof vi.fn> };
  render(<StyleInspectorPanel editor={editor} tokens={tokens} />);
  return { editor, document: document_ };
}

const field = (property: string) =>
  within(
    document.querySelector(`[data-property="${property}"]`) as HTMLElement
  );

/** Pick a type size in the font size field. */
function pickTypeSize(name: RegExp): void {
  // The field's menu, which lists the variables first: named for the unit
  // where the field holds one, else for the variables alone.
  fireEvent.click(
    screen.getByRole("combobox", { name: /^(Unit|Variables) for Font size$/ })
  );
  fireEvent.click(screen.getByRole("option", { name }));
}

/** The node's values at the base breakpoint after the one write made. */
function writtenValues(
  mounted: ReturnType<typeof mount>
): Record<string, unknown> {
  expect(mounted.editor.applyAll).toHaveBeenCalledTimes(1);
  const ops = mounted.editor.applyAll.mock.calls[0]?.[0] as BuilderOp[];
  const next = applyOps(mounted.document, ops).document;
  const node = next?.nodes[0] as BlockNode;
  return (node.styles?.base?.[BASE_BREAKPOINT] ?? {}) as Record<
    string,
    unknown
  >;
}

describe("picking a type size in a block's font size field", () => {
  it("sets the block's line height from it too, in the same edit, where it has none of its own", () => {
    const mounted = mount();
    pickTypeSize(/^H2\b/);
    const values = writtenValues(mounted);
    expect(values).toEqual({
      fontSize: { $token: "font-size.h2" },
      lineHeight: { $token: "line-height.h2" },
    });
    // What the page then renders: both, from the two variables.
    const css = compilePageCss(
      {
        ...mounted.document,
        nodes: [
          {
            ...(mounted.document.nodes[0] as BlockNode),
            styles: { base: { base: values } } as NodeStyles,
          },
        ],
      },
      { breakpoints: { viewport: [], container: [] } }
    ).css;
    expect(css).toContain("font-size: var(--site-font-size-h2)");
    expect(css).toContain("line-height: var(--site-line-height-h2)");
  });

  it("keeps the block's own line height", () => {
    const mounted = mount({ lineHeight: 1.4 });
    pickTypeSize(/^H2\b/);
    expect(writtenValues(mounted)).toEqual({
      fontSize: { $token: "font-size.h2" },
      lineHeight: 1.4,
    });
  });
});

describe("a line height beside a picked type size", () => {
  it('reads "From H2 type size" with "Detach" while it follows the type size', () => {
    const mounted = mount({
      fontSize: { $token: "font-size.h2" },
      lineHeight: { $token: "line-height.h2" },
    });
    const line = field("lineHeight");
    expect(line.getByText("From H2 type size")).toBeDefined();
    fireEvent.click(line.getByRole("button", { name: "Detach" }));
    // Its own value from then on: the type size's, as a number.
    expect(writtenValues(mounted).lineHeight).toBe(1.2);
  });

  it("Detach keeps the line height the canvas shows, its dark one on a dark canvas", () => {
    // A canvas pinned dark, as the editor marks it.
    const page = document.createElement("div");
    page.setAttribute("data-nx-theme", "dark");
    const canvas = document.createElement("div");
    canvas.className = "nx-canvas";
    page.append(canvas);
    document.body.append(page);
    try {
      const night: SiteTokenSet = {
        ...TOKENS,
        tokens: TOKENS.tokens.map(token =>
          token.name === "line-height.h2"
            ? { ...token, values: { light: "1.2", dark: "1.6" } }
            : token
        ),
      };
      const mounted = mount(
        {
          fontSize: { $token: "font-size.h2" },
          lineHeight: { $token: "line-height.h2" },
        },
        night
      );
      fireEvent.click(
        field("lineHeight").getByRole("button", { name: "Detach" })
      );
      expect(writtenValues(mounted).lineHeight).toBe(1.6);
    } finally {
      page.remove();
    }
  });

  it('offers "Use H2\'s line height" where the block has its own', () => {
    const mounted = mount({
      fontSize: { $token: "font-size.h2" },
      lineHeight: 1.4,
    });
    const line = field("lineHeight");
    expect(line.queryByText("From H2 type size")).toBeNull();
    fireEvent.click(line.getByRole("button", { name: "Use H2's line height" }));
    expect(writtenValues(mounted).lineHeight).toEqual({
      $token: "line-height.h2",
    });
  });
});

describe("a picked type size in the field", () => {
  it("reads as its name and pair", () => {
    mount({ fontSize: { $token: "font-size.h2" } });
    expect(field("fontSize").getByText("H2 · 28 / 1.2")).toBeDefined();
  });
});
