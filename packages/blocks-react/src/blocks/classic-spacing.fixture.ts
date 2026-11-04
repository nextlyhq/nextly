/**
 * A page holding every block whose spacing differs between the two spacing
 * models, nested the way a site builds them: a section around headings, text,
 * rich text, a quote, a divider, a button, a card, columns, a gallery, an
 * accordion and a box.
 *
 * `__fixtures__/classic-spacing.css` beside it is this page's stylesheet as the compiler
 * before container gaps wrote it, captured by running that compiler on this
 * very document; `classic-spacing.test.tsx` compiles it under the classic
 * model and asks for the same bytes.
 *
 * @module blocks/classic-spacing.fixture
 */
import type {
  BlockDocument,
  BlockNode,
  BreakpointSet,
} from "@nextlyhq/blocks-engine";

const node = (
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children?: readonly BlockNode[]
): BlockNode =>
  ({
    id,
    type,
    version: 1,
    props,
    ...(children === undefined ? {} : { slots: { children } }),
  }) as BlockNode;

const text = (value: string) => ({ type: "text", text: value });

/** A passage with a heading, two paragraphs and a list. */
const PASSAGE = {
  root: {
    type: "root",
    children: [
      { type: "heading", tag: "h3", children: [text("Inside")] },
      { type: "paragraph", children: [text("One")] },
      { type: "paragraph", children: [text("Two")] },
      {
        type: "list",
        listType: "bullet",
        children: [{ type: "listitem", children: [text("Item")] }],
      },
    ],
  },
};

export const CLASSIC_SPACING_PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    node("band", "core/section", {}, [
      node("title", "core/heading", { text: "Title", level: "h1" }),
      node("sub", "core/heading", { text: "Sub", level: "h2" }),
      node("lead", "core/text", { text: "Lead" }),
      node("body", "core/rich-text", { content: PASSAGE }),
      node("said", "core/quote", { text: "Said" }),
      node("rule", "core/divider"),
      node("go", "core/button", { text: "Go" }),
      node("tile", "core/card", {}, [node("in-card", "core/text")]),
      node("row", "core/columns", {}, [
        node("left", "core/column", {}, [node("l-text", "core/text")]),
        node("right", "core/column", {}, [node("r-text", "core/text")]),
      ]),
      node("pics", "core/gallery"),
      node("faq", "core/accordion", {}, [
        node("q1", "core/accordion-item", { title: "Q" }, [
          node("a1", "core/text"),
        ]),
      ]),
      node("plain", "core/box", {}, [
        node("b1", "core/text"),
        node("b2", "core/list"),
      ]),
    ]),
  ],
};

/** The breakpoints both compiles run under: one, at the base width. */
export const CLASSIC_SPACING_BREAKPOINTS: BreakpointSet = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};
