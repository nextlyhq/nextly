/**
 * `core/text`, version 2: one paragraph of words with bold, italic, links and
 * line breaks, upgraded from the plain string version 1 stored, and drawn
 * through the same restriction whatever the document holds.
 */
import {
  canBindFieldToProp,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  fieldFitsProp,
  TEXT_FORMAT,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type PropSchema,
  type RichTextNode,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockRenderArgs, PageContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { prepareDocumentReadStages } from "../prepare-document";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from ".";
import { paragraph, renderParagraph, type ParagraphProps } from "./paragraph";

const NODE: BlockNode = { id: "n1", type: "core/text", version: 2, props: {} };

function args(
  props: ParagraphProps,
  extra: Partial<BlockRenderArgs<ParagraphProps>> = {}
): BlockRenderArgs<ParagraphProps> {
  const ctx: PageContext = {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
  return {
    props,
    node: NODE,
    className: "nx-n1",
    // No parts: the answer is empty for every name.
    partClass: () => "",
    ctx,
    renderSlot: () => null,
    ...extra,
  };
}

const html = (element: ReactElement): string => renderToStaticMarkup(element);

const draw = (text: unknown): string => html(renderParagraph(args({ text })));

const value = (...children: RichTextNode[]) => ({
  root: { type: "root", children: [{ type: "paragraph", children }] },
});

const words = (text: string, format = 0): RichTextNode => ({
  type: "text",
  text,
  format,
});

describe("core/text: what it draws", () => {
  it("draws a string saved by version 1 exactly as it did", () => {
    expect(draw("Hello")).toBe('<p class="nx-n1">Hello</p>');
  });

  it("draws each line of an older string on a line of its own", () => {
    expect(draw("First\nSecond")).toBe('<p class="nx-n1">First<br/>Second</p>');
  });

  it("draws bold, italic, a link and a line break in one paragraph", () => {
    expect(
      draw(
        value(
          words("A "),
          words("bold", TEXT_FORMAT.BOLD),
          words(" and "),
          words("italic", TEXT_FORMAT.ITALIC),
          { type: "linebreak" },
          {
            type: "link",
            url: "/about",
            target: "_blank",
            children: [words("link")],
          }
        )
      )
    ).toBe(
      '<p class="nx-n1">A <strong>bold</strong> and <em>italic</em><br/>' +
        '<a href="/about" target="_blank" rel="noopener noreferrer">link</a></p>'
    );
  });

  it("draws a heading or a list a document holds as its words, never as a heading", () => {
    const out = draw({
      root: {
        type: "root",
        children: [
          { type: "heading", tag: "h1", children: [words("Title")] },
          {
            type: "list",
            children: [{ type: "listitem", children: [words("Item")] }],
          },
        ],
      },
    });
    expect(out).toBe('<p class="nx-n1">Title<br/>Item</p>');
  });

  it("never draws an address that runs script, and keeps its words", () => {
    const out = draw(
      value({
        type: "link",
        url: "javascript:alert(1)",
        children: [words("Click")],
      })
    );
    expect(out).toBe('<p class="nx-n1">Click</p>');
  });

  it("escapes markup in the words rather than drawing it", () => {
    const out = draw(value(words('<img src=x onerror="alert(1)"><script>')));
    expect(out).toBe(
      '<p class="nx-n1">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;</p>'
    );
    expect(draw("<b>not bold</b>")).toBe(
      '<p class="nx-n1">&lt;b&gt;not bold&lt;/b&gt;</p>'
    );
  });

  it("drops an inline style and any mark but bold and italic", () => {
    const out = draw(
      value(
        { type: "text", text: "red", format: 0, style: "color: red" },
        words(" under", TEXT_FORMAT.UNDERLINE)
      )
    );
    expect(out).toBe('<p class="nx-n1">red under</p>');
  });

  it("keeps a bound date's machine-readable value", () => {
    const out = html(
      renderParagraph(
        args(
          { text: "17 November" },
          {
            bound: {
              text: {
                kind: "date",
                datetime: "2026-11-17",
              } as never,
            },
          }
        )
      )
    );
    expect(out).toBe(
      '<p class="nx-n1"><time dateTime="2026-11-17">17 November</time></p>'
    );
  });

  it("describes the page by its words, with the marks left out", () => {
    expect(
      paragraph.seo?.({
        text: value(words("One "), words("two", TEXT_FORMAT.BOLD), {
          type: "linebreak",
        }),
      })
    ).toEqual({ description: "One two" });
    expect(paragraph.seo?.({ text: "Old\nwords" })).toEqual({
      description: "Old words",
    });
  });

  it("is interactive only while it draws a link", () => {
    expect(paragraph.contentModel?.({ text: "Plain" })).toEqual({
      is: ["flow"],
    });
    expect(
      paragraph.contentModel?.({
        text: value({ type: "link", url: "/a", children: [words("a")] }),
      })
    ).toEqual({ is: ["flow", "interactive"] });
    expect(
      paragraph.contentModel?.({
        text: value({
          type: "link",
          url: "javascript:x",
          children: [words("a")],
        }),
      })
    ).toEqual({ is: ["flow"] });
  });
});

const resolver = createBlockResolver(coreBlocks);

const v1Text = (id: string, text: string): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: { text },
});

const page = (nodes: unknown[]): BlockDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  }) as BlockDocument;

describe("core/text: the upgrade from version 1", () => {
  it("reads a version 1 string as one paragraph, each \\n a line break, losing nothing", () => {
    const stages = prepareDocumentReadStages(
      page([v1Text("t1", "Line one\nLine two")]),
      { resolver }
    );
    const upgraded = stages?.prepared.nodes[0];
    expect(upgraded?.version).toBe(2);
    expect(upgraded?.props.text).toEqual(
      value(words("Line one"), { type: "linebreak" }, words("Line two"))
    );
  });

  it("upgrades a Text inside a component the same way", () => {
    const hero = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [v1Text("d1", "In a\ncomponent")],
    } as unknown as ComponentDocument;
    const stages = prepareDocumentReadStages(
      page([
        {
          id: "i1",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "hero" },
        },
      ]),
      { resolver, definitions: new Map([["hero", hero as BlockDocument]]) }
    );
    const upgraded = stages?.prepared.nodes[0];
    expect(upgraded?.type).toBe("core/text");
    expect(upgraded?.props.text).toEqual(
      value(words("In a"), { type: "linebreak" }, words("component"))
    );
  });

  it("leaves a value already rich as it is", () => {
    const rich = value(words("Kept", TEXT_FORMAT.BOLD));
    expect(paragraph.migrate?.[1]?.({ text: rich })).toEqual({ text: rich });
  });
});

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

describe("core/text: bindings", () => {
  const schema = paragraph.props?.text as PropSchema;

  it("is filled from a text field, and is never offered a rich-text field", () => {
    expect(fieldFitsProp({ name: "summary", type: "textarea" }, schema)).toBe(
      true
    );
    expect(fieldFitsProp({ name: "title", type: "text" }, schema)).toBe(true);
    expect(
      canBindFieldToProp({ type: "richText" }, { type: schema.type })
    ).toBe(false);
    expect(fieldFitsProp({ name: "body", type: "richText" }, schema)).toBe(
      false
    );
  });

  it("draws a bound text field's words as one plain paragraph", async () => {
    const out = await renderToHtml(
      <PageRenderer
        document={page([
          {
            id: "t1",
            type: "core/text",
            version: 2,
            props: { text: value(words("Own", TEXT_FORMAT.BOLD)) },
            bindings: { text: { $bind: "summary" } },
          },
        ])}
        blocks={resolver}
        siteStyles={false}
        bindings={{ entry: { summary: "From <b>the</b> entry\nsecond line" } }}
      />
    );
    const drawn = /<p[^>]*>(.*?)<\/p>/s.exec(out)?.[1];
    expect(drawn).toBe("From &lt;b&gt;the&lt;/b&gt; entry<br/>second line");
  });
});
