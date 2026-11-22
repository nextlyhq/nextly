/**
 * `core/table-of-contents`: the page's own headings, in page order, nested,
 * each linking to the id the page draws that heading with.
 *
 * Every case draws a whole page on the published path, as a route does with
 * no script: the list is read off the page's outline, so what decides it is
 * the page around the block, not the block alone.
 */
import {
  compileStyleValues,
  composeEntryContent,
  DISCLOSURE_ICON_CLASS,
  DOCUMENT_FORMAT_VERSION,
  stylePropertiesForSupports,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
  type RichTextNode,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createStandaloneContext,
  type PageBindings,
  type PageContext,
} from "../context";
import { drawWithRegions } from "../page-read-stages";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";
import {
  tableOfContents,
  type TableOfContentsProps,
} from "./table-of-contents";

const resolver = createBlockResolver(coreBlocks);

async function settled(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

/** The page as a published route draws one with no Layout. */
async function drawn(
  document: BlockDocument,
  options: { context?: PageContext; bindings?: PageBindings } = {}
): Promise<string> {
  return await settled(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      context={options.context ?? createStandaloneContext({})}
      {...(options.bindings === undefined
        ? {}
        : { bindings: options.bindings })}
    />
  );
}

let made = 0;
const nextId = (prefix: string): string => `${prefix}${(made += 1)}`;

const node = (
  type: string,
  props: Record<string, unknown> = {},
  extra: Partial<BlockNode> = {}
): BlockNode => ({ id: nextId("n"), type, version: 1, props, ...extra });

const heading = (
  text: string,
  level = "h2",
  extra: Partial<BlockNode> = {}
): BlockNode => node("core/heading", { text, level }, extra);

const words = (text: string): RichTextNode => ({
  type: "text",
  text,
  format: 0,
});

const passage = (
  ...headings: [tag: string, text: string][]
): RichTextValue => ({
  root: {
    type: "root",
    children: headings.map(([tag, text]) => ({
      type: "heading",
      tag,
      children: [words(text)],
    })),
  },
});

const richText = (value: RichTextValue): BlockNode =>
  node("core/rich-text", { content: value });

const holding = (type: string, children: BlockNode[]): BlockNode =>
  node(type, {}, { slots: { children } });

/** A Table of contents as a new block stores it, with these props over. */
const contents = (props: TableOfContentsProps = {}): BlockNode => ({
  id: nextId("toc"),
  type: "core/table-of-contents",
  version: 2,
  props: { ...tableOfContents.defaultProps, ...props },
});

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** The contents block's markup: its `<nav>`, or "" when none was drawn. */
function navOf(html: string): string {
  return /<nav[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
}

/** Each link in the contents: its target and its words, in order. */
function links(html: string): [string, string][] {
  return [...navOf(html).matchAll(/<a href="#([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(
    match => [match[1]!, match[2]!]
  );
}

/** Every heading the page draws, as `id words`. */
function headingsDrawn(html: string): string[] {
  return [...html.matchAll(/<h[1-6][^>]*\sid="([^"]*)"[^>]*>([^<]*)</g)].map(
    match => `${match[1]} ${match[2]}`
  );
}

/** The rules the page carries for its contents blocks, if any. */
function contentsRules(html: string): string {
  return (
    /<style[^>]*data-href="nx-table-of-contents"[^>]*>([^<]*)<\/style>/.exec(
      html
    )?.[1] ?? ""
  );
}

describe("the contents of a page", () => {
  /** A page with headings above and below its contents block. */
  const ARTICLE = page(
    heading("The page's own title", "h1"),
    contents(),
    heading("Getting started"),
    richText(passage(["h3", "Install"], ["h3", "Configure"], ["h4", "Flags"])),
    heading("Next steps")
  );

  it("lists the page's headings in page order, Heading blocks and Rich text alike, each linking to its heading", async () => {
    const html = await drawn(ARTICLE);
    expect(links(html)).toEqual([
      ["getting-started", "Getting started"],
      ["install", "Install"],
      ["configure", "Configure"],
      ["next-steps", "Next steps"],
    ]);
    const onPage = headingsDrawn(html);
    for (const [id, text] of links(html)) {
      expect(onPage, id).toContain(`${id} ${text}`);
    }
  });

  it("nests each heading in the list of the one above it", async () => {
    const nav = navOf(await drawn(ARTICLE));
    // The subsections sit in a list inside the first section's item, and the
    // next section follows that item: nested, not indented.
    expect(nav).toMatch(
      /Getting started<\/a><ol role="list" class="[^"]*sublist"><li[^>]*><a href="#install"[^>]*>Install<\/a><\/li><li[^>]*><a href="#configure"[^>]*>Configure<\/a><\/li><\/ol><\/li><li[^>]*><a href="#next-steps"/
    );
  });

  it("never lists an H1, which is the page's own title", async () => {
    const html = await drawn(
      page(
        heading("Title", "h1"),
        contents({ depth: "h2-h4" }),
        heading("Body")
      )
    );
    expect(links(html)).toEqual([["body", "Body"]]);
  });

  it("nests a heading that skips a level one level, with no empty item", async () => {
    const nav = navOf(
      await drawn(
        page(
          contents({ depth: "h2-h4" }),
          heading("Top"),
          heading("Deep", "h4")
        )
      )
    );
    expect(nav).toMatch(
      /Top<\/a><ol role="list" class="[^"]*sublist"><li[^>]*><a href="#deep"/
    );
    expect(nav).not.toMatch(/<li[^>]*><ol/);
  });

  it("follows the page's anchors where two headings share their words", async () => {
    // The Heading block's "Overview" comes first on the page, so the Rich
    // text's own "Overview" is drawn as `overview-2`, and listed so.
    const html = await drawn(
      page(
        contents(),
        heading("Overview"),
        richText(passage(["h2", "Overview"], ["h3", "Notes"]))
      )
    );
    expect(links(html)).toEqual([
      ["overview", "Overview"],
      ["overview-2", "Overview"],
      ["notes", "Notes"],
    ]);
    expect(headingsDrawn(html)).toEqual([
      "overview Overview",
      "overview-2 Overview",
      "notes Notes",
    ]);
  });

  it("links a heading with its own CSS id by that id", async () => {
    const html = await drawn(
      page(contents(), heading("Pricing", "h2", { cssId: "plans" }))
    );
    expect(links(html)).toEqual([["plans", "Pricing"]]);
  });
});

describe("headings a table of contents leaves out", () => {
  /** A site with a phone breakpoint and a card-sized container one. */
  const CARD_BREAKPOINTS = {
    viewport: [{ id: "mobile", label: "Mobile", maxWidth: 640 }],
    container: [{ id: "card-wide", label: "Card wide", maxWidth: 480 }],
  };

  it("leaves out the headings inside a Collection list and an accordion", async () => {
    const find = () =>
      Promise.resolve({ items: [{ id: "a" }, { id: "b" }], total: 2 });
    const html = await drawn(
      page(
        contents(),
        heading("Listed"),
        node(
          "core/collection-loop",
          { collection: "posts", limit: 10 },
          { slots: { children: [heading("In each entry")] } }
        ),
        holding("core/accordion", [
          node(
            "core/accordion-item",
            { title: "A question" },
            { slots: { children: [heading("In an answer")] } }
          ),
        ]),
        heading("Also listed")
      ),
      { context: createStandaloneContext({ data: { find } }) }
    );
    // Must-be-found: the left-out headings are on the page.
    expect(html).toContain("In each entry");
    expect(html).toContain("In an answer");
    expect(links(html)).toEqual([
      ["listed", "Listed"],
      ["also-listed", "Also listed"],
    ]);
  });

  it("leaves out a heading its author left out, and one hidden on every device", async () => {
    const html = await drawn(
      page(
        contents(),
        heading("Kept"),
        node("core/heading", {
          text: "Left out",
          level: "h2",
          tocExclude: true,
        }),
        heading("Hidden", "h2", { visibility: { devices: { base: false } } }),
        heading("Not on phones", "h2", {
          visibility: { devices: { mobile: false } },
        })
      )
    );
    expect(headingsDrawn(html)).toContain("left-out Left out");
    expect(links(html)).toEqual([
      ["kept", "Kept"],
      ["not-on-phones", "Not on phones"],
    ]);
  });

  it("reads a heading's devices by the breakpoints the page is drawn with", async () => {
    // Hidden on every device; the `true` is stored for a container
    // breakpoint, which answers about a box and shows nothing again on a
    // device. Only the page's breakpoints can say which one it is.
    const html = await settled(
      <PageRenderer
        document={page(
          contents(),
          heading("Never on a device", "h2", {
            visibility: { devices: { base: false, "card-wide": true } },
          }),
          heading("Everywhere")
        )}
        blocks={resolver}
        context={createStandaloneContext({})}
        styleContext={{ breakpoints: CARD_BREAKPOINTS, namedClasses: [] }}
      />
    );
    expect(links(html)).toEqual([["everywhere", "Everywhere"]]);
  });

  it("reads devices by the breakpoints a page drawn inside its Layout is drawn with", async () => {
    const shared = {
      context: createStandaloneContext({}),
      blocks: resolver,
      styleContext: { breakpoints: CARD_BREAKPOINTS, namedClasses: [] },
    };
    const html = await settled(
      <>
        {drawWithRegions({
          regions: [],
          page: {
            ...shared,
            document: page(
              contents(),
              heading("Never on a device", "h2", {
                visibility: { devices: { base: false, "card-wide": true } },
              }),
              heading("Everywhere")
            ),
          },
          shared,
          siteStyles: undefined,
          definitions: new Map(),
        })}
      </>
    );
    expect(links(html)).toEqual([["everywhere", "Everywhere"]]);
  });

  it("leaves out the Layout's header and footer, listing the page's own", async () => {
    const region = (area: "header" | "footer", nodes: BlockNode[]) => ({
      region: { area, componentId: `${area}-component` },
      document: page(...nodes),
      prepared: null,
    });
    const shared = { context: createStandaloneContext({}), blocks: resolver };
    const html = await settled(
      <>
        {drawWithRegions({
          regions: [
            region("header", [heading("Notes")]),
            region("footer", [heading("Contact")]),
          ],
          page: {
            ...shared,
            document: page(contents(), heading("Notes"), heading("Pricing")),
          },
          shared,
          siteStyles: undefined,
          definitions: new Map(),
        })}
      </>
    );
    // The header's "Notes" is first on the page, so the page's is `notes-2`.
    expect(links(html)).toEqual([
      ["notes-2", "Notes"],
      ["pricing", "Pricing"],
    ]);
  });
});

describe("the contents of a collection template", () => {
  const POSTS: readonly BindingFieldShape[] = [
    { name: "title", type: "text" },
    { name: "body", type: "richText" },
  ];

  const bindings = (entry: Record<string, unknown>): PageBindings => ({
    entry,
    entryRef: { collection: "posts" },
    fieldShapes: {
      fieldsOf: ref =>
        "collection" in ref && ref.collection === "posts" ? POSTS : undefined,
    },
  });

  it("lists the entry's own headings, by its words, where the body is bound", async () => {
    const template: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "template",
      nodes: [
        heading("Placeholder title", "h1", {
          bindings: { text: { $bind: "title" } },
        }),
        contents(),
        node(
          "core/rich-text",
          {},
          { bindings: { content: { $bind: "body" } } }
        ),
      ],
    };
    const html = await drawn(template, {
      bindings: bindings({
        title: "A post",
        body: passage(["h2", "Why"], ["h3", "Notes"], ["h2", "How"]),
      }),
    });
    expect(links(html)).toEqual([
      ["why", "Why"],
      ["notes", "Notes"],
      ["how", "How"],
    ]);
  });

  it("lists the template's headings and the entry's content field's, in place", async () => {
    const template: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "template",
      nodes: [
        contents(),
        heading("Before the body"),
        node("core/entry-content", { field: "body" }),
        heading("After the body"),
      ],
    };
    const body = page(
      heading("In the body"),
      richText(passage(["h3", "Deeper"]))
    );
    const html = await drawn(
      composeEntryContent(template, { valueOf: field => ({ body })[field] })
    );
    expect(links(html)).toEqual([
      ["before-the-body", "Before the body"],
      ["in-the-body", "In the body"],
      ["deeper", "Deeper"],
      ["after-the-body", "After the body"],
    ]);
  });
});

describe("a table of contents' settings", () => {
  const body = [
    heading("One"),
    heading("One point one", "h3"),
    heading("One point one point one", "h4"),
    heading("Two"),
  ];

  it("lists H2 and H3 by default, H2 only, or H2 to H4", async () => {
    const listed = async (depth?: unknown) =>
      links(
        await drawn(page(contents({ depth } as TableOfContentsProps), ...body))
      ).map(([id]) => id);
    expect(await listed()).toEqual(["one", "one-point-one", "two"]);
    expect(await listed("h2")).toEqual(["one", "two"]);
    expect(await listed("h2-h4")).toEqual([
      "one",
      "one-point-one",
      "one-point-one-point-one",
      "two",
    ]);
    // A stored depth the block does not know lists as the default does.
    expect(await listed("h9")).toEqual(await listed("h2-h3"));
  });

  it("numbers a new block's entries with counters joined down the nesting (1, 1.1)", async () => {
    const html = await drawn(page(contents(), ...body));
    expect(tableOfContents.defaultProps?.marker).toBe("numbered");
    expect(navOf(html)).toMatch(
      /<ol role="list" class="[^"]*list" data-nx-toc="numbered"/
    );
    const rules = contentsRules(html);
    expect(rules).toContain(
      ":is([data-nx-toc],[data-nx-toc] ol){counter-reset:nx-toc}"
    );
    expect(rules).toContain("[data-nx-toc] li{counter-increment:nx-toc}");
    // The number is drawn with an empty alternative text: a screen reader
    // already says each item's place.
    expect(rules).toContain(
      '[data-nx-toc="numbered"] li::before{content:counters(nx-toc,".");content:counters(nx-toc,".")/""}'
    );
    // One list holds the marks; a nested one carries none of its own.
    expect(navOf(html).match(/data-nx-toc=/g)).toHaveLength(1);
  });

  it("draws bullets when set to, and when the setting is unset", async () => {
    for (const marker of ["bullets", undefined] as const) {
      const html = await drawn(
        page(
          {
            ...contents(),
            props: { ...contents().props, marker },
          },
          ...body
        )
      );
      expect(navOf(html), String(marker)).toContain('data-nx-toc="bullets"');
      expect(contentsRules(html)).toContain(
        '[data-nx-toc="bullets"] li::before{content:"\\2022";content:"\\2022"/""}'
      );
    }
  });

  it("folds under its title by default, starting open, with the browser's own disclosure", async () => {
    const nav = navOf(
      await drawn(page(contents({ title: "In this post" }), ...body))
    );
    expect(nav).toMatch(
      /^<nav class="[^"]*" aria-label="In this post"><details open=""><summary class="[^"]*" data-nx-toc-toggle=""><span class="nx-pb-disclosure-icon" aria-hidden="true"><\/span><span class="nx-pb-disclosure-title">In this post<\/span><\/summary><ol role="list"/
    );
  });

  it("makes its folding title a target at least 44px tall, a floor an author's own minimum height replaces", async () => {
    const html = await drawn(page(contents({}), ...body));
    expect(navOf(html)).toContain("<summary");
    // Under `:where`, so the rule weighs nothing against a minimum height an
    // author sets on the title.
    expect(contentsRules(html)).toContain(
      ":where([data-nx-toc-toggle]){min-height:44px}"
    );
  });

  it("draws its title as a label above the list when it cannot be folded", async () => {
    const nav = navOf(
      await drawn(page(contents({ collapsible: false }), ...body))
    );
    expect(nav).not.toContain("<details");
    expect(nav).toMatch(
      /^<nav class="[^"]*" aria-label="On this page"><p class="[^"]*">On this page<\/p><ol role="list"/
    );
  });

  it("is a navigation landmark named `On this page` when its title is empty", async () => {
    const nav = navOf(await drawn(page(contents({ title: "   " }), ...body)));
    expect(nav).toContain('aria-label="On this page"');
    expect(nav).toContain(">On this page</span></summary>");
  });

  it("highlights the section being read by default, with CSS alone", async () => {
    const html = await drawn(page(contents(), ...body));
    expect(navOf(html)).toMatch(
      /<ol role="list" class="[^"]*list"[^>]* data-nx-toc-highlight=""/
    );
    const rules = contentsRules(html);
    expect(rules).toContain(
      "[data-nx-toc-highlight]{scroll-target-group:auto}"
    );
    expect(rules).toContain(
      "[data-nx-toc-highlight] a:target-current{font-weight:600}"
    );
    expect(html).not.toContain("<script");
  });

  it("highlights nothing when turned off, and when unset reads as on", async () => {
    const off = await drawn(page(contents({ highlight: false }), ...body));
    expect(navOf(off)).not.toContain("data-nx-toc-highlight");
    // Must-be-found: the list was drawn.
    expect(links(off)).toHaveLength(3);
    const unset = await drawn(
      page({ ...contents(), props: { title: "On this page" } }, ...body)
    );
    expect(navOf(unset)).toContain("data-nx-toc-highlight");
  });
});

describe("a table of contents with nothing to list", () => {
  /** Pages with no heading this block lists. */
  const empty = [
    page(contents()),
    page(contents(), richText(passage())),
    page(contents(), heading("Only a title", "h1")),
    page(contents({ depth: "h2" }), heading("A subsection", "h3")),
    page(
      contents(),
      node("core/heading", { text: "Left out", level: "h2", tocExclude: true })
    ),
  ];

  it("draws nothing at all for a visitor, not even its rules", async () => {
    for (const document of empty) {
      const html = await drawn(document);
      expect(html).not.toContain("<nav");
      expect(contentsRules(html)).toBe("");
    }
  });

  it("tells an author on the canvas to add H2 headings, with no links", async () => {
    for (const document of empty) {
      const nav = navOf(
        await drawn(document, {
          context: createStandaloneContext({ diagnostics: true }),
        })
      );
      expect(nav).toContain('aria-label="On this page"');
      expect(nav).toMatch(
        /<p class="[^"]*note">Add H2 headings to this page and they(&#x27;|')ll be listed here\.<\/p>/
      );
      expect(nav).not.toContain("<a ");
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

  it("offers its settings and nothing to fill in: no passage to bind", () => {
    expect(tableOfContents.version).toBe(2);
    expect(Object.keys(tableOfContents.props ?? {})).toEqual([
      "title",
      "depth",
      "marker",
      "collapsible",
      "highlight",
    ]);
    const labels = Object.fromEntries(
      Object.entries(tableOfContents.props ?? {}).map(([name, schema]) => [
        name,
        schema.label,
      ])
    );
    expect(labels).toEqual({
      title: "Title",
      depth: "Headings",
      marker: "List as",
      collapsible: "Can be folded",
      highlight: "Highlight the section being read",
    });
    expect(tableOfContents.props?.marker?.optionLabels).toEqual({
      numbered: "Numbers",
      bullets: "Bullets",
    });
    expect(tableOfContents.defaultProps).toEqual({
      title: "On this page",
      depth: "h2-h3",
      marker: "numbered",
      collapsible: true,
      highlight: true,
    });
  });
});

describe("a contents block's folding icon", () => {
  const supports = coreBlocks.find(
    block => block.name === "core/table-of-contents"
  )?.supports;

  it("is offered in Style › Icon, with where it sits", () => {
    const offered = stylePropertiesForSupports(supports as never).map(
      entry => entry.property
    );
    expect(offered).toContain("disclosureIcon");
    expect(offered).toContain("disclosurePosition");
  });

  it("is drawn in the folding title, where the icon's styles reach it", async () => {
    const nav = navOf(await drawn(page(contents(), heading("One"))));
    // The icon's rules are written from the block's element down: a nav
    // holding the details, its summary, and the icon first in it.
    expect(nav).toMatch(
      new RegExp(
        `^<nav[^>]*><details open=""><summary[^>]*><span class="${DISCLOSURE_ICON_CLASS}" aria-hidden="true"></span>`
      )
    );
    const written = compileStyleValues(
      { disclosureIcon: "chevron", disclosurePosition: "before" },
      "/s"
    ).declarations.map(each => each.descendant ?? "");
    expect(written).toContain(
      `> details > summary > .${DISCLOSURE_ICON_CLASS}`
    );
  });

  it("is not drawn on a list that does not fold", async () => {
    const nav = navOf(
      await drawn(page(contents({ collapsible: false }), heading("One")))
    );
    expect(nav).toContain("<nav");
    expect(nav).not.toContain(DISCLOSURE_ICON_CLASS);
  });
});
