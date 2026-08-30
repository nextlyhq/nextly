/**
 * What `core/rich-text` adds, and what it deliberately does not.
 *
 * The walk that turns a stored tree into elements is covered by the renderer's
 * own suite, so repeating it here would assert someone else's work and pass
 * even if this block stopped calling it. What is asserted instead is the seam:
 * that the value reaches the renderer unnarrowed, that the element carrying the
 * block's styles is the one an editor is told to put a caret into, that the
 * words a crawler sees come from the same flattener the rest of the product
 * uses, and that a default holding a TREE cannot be edited into every other
 * block inserted from it.
 */
import {
  RICH_TEXT_PROP_TYPE,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockRenderArgs, PageContext } from "../context";

import { coreBlocks } from "./index";
import { renderRichText, richText, type RichTextBlockProps } from "./rich-text";

const NODE = {
  id: "n1",
  type: "core/rich-text",
  version: 1,
  props: {},
} as const;

function context(): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
}

function args(
  props: RichTextBlockProps,
  markProp?: (name: string) => Record<string, string>
): BlockRenderArgs<RichTextBlockProps> {
  return {
    props,
    node: NODE,
    className: "nx-n1",
    // Required by the render contract. These fixtures declare no parts, so the
    // answer is empty for every name — but a renderer that could omit it would
    // leave every block's parts unmarked with nothing to report.
    partClass: () => "",
    ctx: context(),
    renderSlot: () => null,
    ...(markProp === undefined ? {} : { markProp }),
  };
}

const html = (element: ReactElement | null): string =>
  element === null ? "" : renderToStaticMarkup(element);

/** A passage whose second half is bold, which is two text leaves in one line. */
function passage(): RichTextValue {
  return {
    root: {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", text: "Hello ", format: 0 },
            { type: "text", text: "world", format: 1 },
          ],
        },
      ],
    },
  };
}

describe("core/rich-text", () => {
  describe("what it draws", () => {
    it("draws the stored tree as elements rather than as its own text", () => {
      // The failure this separates from a pass is a block that renders the
      // value through a string helper: that produces "[object Object]" or an
      // empty box, and both look like an empty passage to anyone reading the
      // page rather than the markup.
      const out = html(renderRichText(args({ content: passage() })));
      expect(out).toContain("<strong>world</strong>");
      expect(out).toContain("Hello ");
    });

    it("keeps the block's own box when the stored value is not rich text", () => {
      // A string left by a document written before the prop was rich. Rendering
      // NOTHING AT ALL would take the block's class with it, so the author
      // loses the spacing and background they set as well as the words — and a
      // block that vanishes from the canvas cannot be selected to be fixed.
      const stored = {
        content: "plain words",
      } as unknown as RichTextBlockProps;
      const out = html(renderRichText(args(stored)));
      expect(out).toBe('<div class="nx-n1"></div>');
    });

    it("marks the element that carries the block's styles", () => {
      // Marking an inner element instead would put the caret inside a box whose
      // padding, colour and border live on a parent, so an author would edit
      // one element and style another with nothing saying so.
      const out = html(
        renderRichText(
          args({ content: passage() }, name => ({ "data-nx-prop": name }))
        )
      );
      expect(out).toContain('<div class="nx-n1" data-nx-prop="content">');
    });

    it("spreads nothing outside an editor", () => {
      // `markProp` is absent on a published page, and a block that assumed it
      // would throw there rather than in any test that supplies one.
      expect(html(renderRichText(args({ content: passage() })))).toContain(
        '<div class="nx-n1">'
      );
    });
  });

  describe("what a crawler is told", () => {
    it("describes the page with the words, not the formatting", () => {
      // Two adjacent leaves are one word split by a format change. A
      // description that joined leaves with a space would read "Hello  world"
      // here and "pre fix" on a word half-bolded, which is the text a search
      // result quotes.
      expect(richText.seo?.({ content: passage() })).toEqual({
        description: "Hello world",
      });
    });

    it("contributes nothing for a value that is not rich text", () => {
      // Rather than an empty description, which would OVERRIDE a description
      // an earlier block supplied: the metadata walk fills each field once.
      const stored = { content: 42 } as unknown as RichTextBlockProps;
      expect(richText.seo?.(stored)).toBeUndefined();
    });
  });

  describe("the block's empty value", () => {
    it("is one empty paragraph, not an empty root", () => {
      // A root with no children renders to nothing at all, leaving no line for
      // a caret. This is the block's `""`, in the sense `core/text` holds one.
      const content = richText.defaultProps?.content;

      expect(content?.root.children).toHaveLength(1);
      expect(content?.root.children[0]?.type).toBe("paragraph");
    });

    it("is NOT what an inserted block carries, because the example overlays it", () => {
      /*
       * The palette spreads `example.props` over the defaults, so a block
       * declaring an example never inserts its empty value — the same reason
       * inserting `core/text` yields its example sentence rather than "".
       *
       * Asserted because the two are easy to confuse, and confusing them is how
       * a block ends up documented as inserting something it does not.
       */
      const inserted = richText.example.props as RichTextBlockProps;

      expect(inserted.content).not.toEqual(richText.defaultProps?.content);
      expect(JSON.stringify(inserted.content)).toContain("A passage");
    });
  });

  describe("what an editor is told the prop IS", () => {
    it("declares the type through the shared constant", () => {
      // Spelled here and read elsewhere, the two would agree until one moved.
      // The editor that reads it treats anything else as a line of text and
      // commits an empty string over the passage.
      expect(richText.props?.content?.type).toBe(RICH_TEXT_PROP_TYPE);
    });

    it("offers the value for editing on the canvas", () => {
      // Without this the passage is editable nowhere: the inspector draws no
      // control for a rich prop, deliberately.
      expect(richText.props?.content?.inline).toBe(true);
    });
  });

  it("is registered in the library", () => {
    // A block absent from this list exists as an export and appears in no
    // palette, which reads as a missing feature rather than a missing line.
    expect(coreBlocks).toContain(richText);
  });
});
