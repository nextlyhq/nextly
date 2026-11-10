/**
 * `core/table-of-contents`: a passage's headings, nested, each linking to the
 * id `core/rich-text` draws that heading with.
 *
 * The block is rendered alone for its own markup, and on a page beside a
 * rich-text block, both bound to one field of the entry, for the claim that
 * matters to a reader: every contents link reaches the heading it names.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BindingFieldShape,
  type BlockDocument,
  type RichTextNode,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockRenderArgs, PageContext, PageBindings } from "../context";
import { createStandaloneContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";
import {
  renderTableOfContents,
  tableOfContents,
  type TableOfContentsProps,
} from "./table-of-contents";

const words = (text: string): RichTextNode => ({
  type: "text",
  text,
  format: 0,
});

const heading = (tag: string, text: string): RichTextNode => ({
  type: "heading",
  tag,
  children: [words(text)],
});

const passage = (...children: RichTextNode[]): RichTextValue => ({
  root: { type: "root", children },
});

/** A post body: a title, two sections, the first with two subsections. */
const BODY = passage(
  heading("h1", "The post's own title"),
  heading("h2", "Getting started"),
  { type: "paragraph", children: [words("Some words.")] },
  heading("h3", "Install"),
  heading("h3", "Configure"),
  heading("h4", "Advanced options"),
  heading("h2", "Next steps")
);

function context(diagnostics = false): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
    ...(diagnostics ? { diagnostics: true } : {}),
  };
}

function args(
  props: TableOfContentsProps,
  options: { diagnostics?: boolean } = {}
): BlockRenderArgs<TableOfContentsProps> {
  return {
    props,
    node: {
      id: "toc",
      type: "core/table-of-contents",
      version: 1,
      props: {},
    },
    className: "nx-toc",
    partClass: name => `nx-toc-${name}`,
    ctx: context(options.diagnostics === true),
    renderSlot: () => null,
  };
}

const html = (element: ReactElement | null): string =>
  element === null ? "" : renderToStaticMarkup(element);

/** Each link's target and words, in order. */
function links(markup: string): [string, string][] {
  return [...markup.matchAll(/<a href="#([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(
    match => [match[1]!, match[2]!]
  );
}

describe("the contents of a passage", () => {
  it("lists H2 and H3 by default, nesting each H3 inside the H2 before it", () => {
    const markup = html(renderTableOfContents(args({ content: BODY })));
    expect(links(markup)).toEqual([
      ["getting-started", "Getting started"],
      ["install", "Install"],
      ["configure", "Configure"],
      ["next-steps", "Next steps"],
    ]);
    // The subsections sit in a list inside the first section's item, and the
    // second section follows that item: nested, not indented.
    expect(markup).toContain(
      '<li class="nx-toc-item"><a href="#getting-started" class="nx-toc-link">Getting started</a><ol role="list" class="nx-toc-sublist"><li class="nx-toc-item"><a href="#install"'
    );
    expect(markup).toMatch(
      /Configure<\/a><\/li><\/ol><\/li><li class="nx-toc-item"><a href="#next-steps"/
    );
  });

  it("never lists the H1, which is the page's own title", () => {
    expect(
      links(
        html(renderTableOfContents(args({ content: BODY, depth: "h2-h4" })))
      )
        .map(([id]) => id)
        .includes("the-posts-own-title")
    ).toBe(false);
  });

  it("lists to the depth chosen", () => {
    const only = (depth: TableOfContentsProps["depth"]) =>
      links(html(renderTableOfContents(args({ content: BODY, depth })))).map(
        ([id]) => id
      );
    expect(only("h2")).toEqual(["getting-started", "next-steps"]);
    expect(only("h2-h4")).toEqual([
      "getting-started",
      "install",
      "configure",
      "advanced-options",
      "next-steps",
    ]);
    // A stored depth the block does not know lists as the default does.
    expect(only("h9" as TableOfContentsProps["depth"])).toEqual(only("h2-h3"));
  });

  it("nests a heading that skips a level one level, with no empty item", () => {
    const markup = html(
      renderTableOfContents(
        args({
          content: passage(heading("h2", "Top"), heading("h4", "Deep")),
          depth: "h2-h4",
        })
      )
    );
    expect(markup).toContain(
      '<a href="#top" class="nx-toc-link">Top</a><ol role="list" class="nx-toc-sublist"><li class="nx-toc-item"><a href="#deep"'
    );
    expect(markup).not.toMatch(/<li[^>]*><ol/);
  });

  it("is a navigation landmark named by its title, folded in an open disclosure by default", () => {
    const markup = html(
      renderTableOfContents(args({ content: BODY, title: "In this post" }))
    );
    expect(markup).toMatch(
      /^<nav class="nx-toc" aria-label="In this post"><details open=""><summary class="nx-toc-title">In this post<\/summary><ol role="list" class="nx-toc-list">/
    );
  });

  it("draws its title as a label above the list when it cannot be folded", () => {
    const markup = html(
      renderTableOfContents(args({ content: BODY, collapsible: false }))
    );
    expect(markup).not.toContain("<details");
    expect(markup).toMatch(
      /^<nav class="nx-toc" aria-label="On this page"><p class="nx-toc-title">On this page<\/p><ol/
    );
  });

  it("names itself `On this page` when its title is empty", () => {
    const markup = html(
      renderTableOfContents(args({ content: BODY, title: "   " }))
    );
    expect(markup).toContain('aria-label="On this page"');
    expect(markup).toContain(">On this page</summary>");
  });
});

describe("a contents block with nothing to list", () => {
  const empty = [
    undefined,
    passage({ type: "paragraph", children: [words("No headings here.")] }),
    passage(heading("h1", "Only a title")),
  ];

  it("draws nothing at all for a visitor", () => {
    for (const content of empty) {
      expect(renderTableOfContents(args({ content }))).toBeNull();
    }
  });

  it("shows an author its frame and why it is empty, with no links", () => {
    for (const content of empty) {
      const markup = html(
        renderTableOfContents(args({ content }, { diagnostics: true }))
      );
      expect(markup).toContain(
        '<nav class="nx-toc" aria-label="On this page">'
      );
      expect(markup).toContain(
        '<p class="nx-toc-note">No headings to list yet. Bind Content to the rich text this lists; its headings appear here.</p>'
      );
      expect(markup).not.toContain("<a ");
    }
  });
});

describe("the block's registration", () => {
  it("is in the core library, after rich text", () => {
    const names = coreBlocks.map(block => block.name);
    expect(names).toContain("core/table-of-contents");
    expect(names.indexOf("core/table-of-contents")).toBe(
      names.indexOf("core/rich-text") + 1
    );
  });

  it("takes its passage as rich text, which binds as the body does, and is typed nowhere", () => {
    const content = tableOfContents.props?.content;
    expect(content?.type).toBe("richText");
    expect(content?.inline).toBeUndefined();
    expect(content?.role).toBeUndefined();
  });
});

describe("a contents block beside its passage, on a page", () => {
  const POSTS: readonly BindingFieldShape[] = [
    { name: "body", type: "richText" },
  ];

  const page: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "contents",
        type: "core/table-of-contents",
        version: 1,
        props: {},
        bindings: { content: { $bind: "body" } },
      },
      {
        id: "article",
        type: "core/rich-text",
        version: 1,
        props: {},
        bindings: { content: { $bind: "body" } },
      },
    ],
  };

  async function render(entry: Record<string, unknown>): Promise<string> {
    const bindings: PageBindings = {
      entry,
      entryRef: { collection: "posts" },
      fieldShapes: {
        fieldsOf: ref =>
          "collection" in ref && ref.collection === "posts" ? POSTS : undefined,
      },
    };
    const stream = await renderToReadableStream(
      <PageRenderer
        document={page}
        blocks={createBlockResolver(coreBlocks)}
        siteStyles={false}
        bindings={bindings}
        context={createStandaloneContext({})}
      />,
      {
        onError(error) {
          throw error;
        },
      }
    );
    await stream.allReady;
    return await new Response(stream).text();
  }

  it("links every entry to a heading drawn with that id and those words", async () => {
    const markup = await render({
      body: passage(
        heading("h2", "Why"),
        heading("h3", "Notes"),
        heading("h2", "How"),
        heading("h3", "Notes")
      ),
    });
    const listed = links(markup);
    expect(listed).toEqual([
      ["why", "Why"],
      ["notes", "Notes"],
      ["how", "How"],
      ["notes-2", "Notes"],
    ]);
    for (const [id, text] of listed) {
      expect(markup, id).toMatch(
        new RegExp(`<h[23] id="${id}">${text}</h[23]>`)
      );
    }
  });

  it("links only to ids the page draws, on a messy passage", async () => {
    const image = (...kids: RichTextNode[]): RichTextNode => ({
      type: "image",
      src: "/media/a.png",
      altText: "A picture",
      ...(kids.length > 0 ? { children: kids } : {}),
    });
    const markup = await render({
      body: passage(
        // Block content inside a heading moves out after it.
        {
          type: "heading",
          tag: "h2",
          children: [words("Before"), image(), words("After")],
        },
        // A heading inside a heading is drawn after it, as its own.
        {
          type: "heading",
          tag: "h2",
          children: [words("Outer"), heading("h3", "Inner")],
        },
        // A heading stored under an image is never drawn.
        image(heading("h2", "Stale")),
        // A heading in a disclosure label is rebuilt by the renderer.
        {
          type: "collapsible-container",
          open: true,
          children: [
            {
              type: "collapsible-title",
              children: [
                {
                  type: "heading",
                  tag: "h3",
                  children: [words("Label"), image()],
                },
              ],
            },
            {
              type: "collapsible-content",
              children: [heading("h3", "Inside")],
            },
          ],
        },
        // A linked heading, a repeat, and one with no words.
        {
          type: "heading",
          tag: "h2",
          children: [{ type: "link", url: "/x", children: [words("Linked")] }],
        },
        heading("h2", "Outer"),
        { type: "heading", tag: "h2", children: [] }
      ),
    });
    const listed = links(markup);
    expect(listed).toEqual([
      ["before", "Before"],
      ["outer", "Outer"],
      ["inner", "Inner"],
      ["label", "Label"],
      ["inside", "Inside"],
      ["linked", "Linked"],
      ["outer-2", "Outer"],
    ]);
    const drawn = new Set(
      [...markup.matchAll(/<h[1-6] id="([^"]*)"/g)].map(match => match[1])
    );
    for (const [id] of listed) expect(drawn.has(id), id).toBe(true);
    expect(markup).not.toContain("Stale");
  });

  it("draws nothing for a post whose body has no headings, while the body still draws", async () => {
    const markup = await render({
      body: passage({ type: "paragraph", children: [words("Just words.")] }),
    });
    expect(markup).not.toContain("<nav");
    expect(markup).toContain("Just words.");
  });
});
