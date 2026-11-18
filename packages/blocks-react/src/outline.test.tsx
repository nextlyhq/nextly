/**
 * The page outline: every heading the page draws, in page order, each with
 * one anchor that is unique on the whole page. Heading blocks and the
 * headings inside Rich text take their ids from it, so these cases are read
 * off the drawn page as well as off the outline itself.
 */
import {
  composeEntryContent,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type RichTextNode,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { coreBlocks } from "./blocks";
import {
  createStandaloneContext,
  defineBlock,
  type PageContext,
  type PageBindings,
} from "./context";
import { BlockList } from "./block-boundary";
import {
  anchorsWithin,
  outlineForPart,
  pageOutline,
  type OutlinePart,
  type PageOutline,
} from "./outline";
import { PageRenderer } from "./page-renderer";
import { drawWithRegions } from "./page-read-stages";
import { createBlockResolver } from "./resolver";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

/** The outline a block on the page was drawn with, kept for the test. */
let seen: PageOutline | undefined;

/**
 * The outline kept, read through a call: the compiler narrows `seen` to
 * `undefined` after a test resets it, not knowing the render set it since.
 */
const outlineSeen = (): PageOutline | undefined => seen;

/** A block that keeps the outline its context carries, and draws nothing. */
const probe = defineBlock<Record<string, never>>({
  name: "test/outline-probe",
  version: 1,
  description: "Keeps the page outline it is drawn with.",
  example: { props: {} },
  render: ({ ctx, className }) => {
    seen = ctx.outline;
    return <i className={className} />;
  },
});

const resolver = createBlockResolver([...coreBlocks, probe]);

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

let made = 0;
const nextId = (prefix: string) => `${prefix}${(made += 1)}`;

const heading = (
  text: string,
  extra: Partial<BlockNode> & { props?: Record<string, unknown> } = {}
): BlockNode => ({
  id: nextId("h"),
  type: "core/heading",
  version: 1,
  ...extra,
  props: { text, level: "h2", ...extra.props },
});

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

const richText = (value: RichTextValue, id = nextId("r")): BlockNode => ({
  id,
  type: "core/rich-text",
  version: 1,
  props: { content: value },
});

const box = (
  children: BlockNode[],
  extra: Partial<BlockNode> = {}
): BlockNode => ({
  id: nextId("b"),
  type: "core/box",
  version: 1,
  props: {},
  ...extra,
  slots: { children },
});

const probeNode = (): BlockNode => ({
  id: nextId("p"),
  type: "test/outline-probe",
  version: 1,
  props: {},
});

/** The page drawn as a published route draws one with no Layout. */
async function drawn(
  document: BlockDocument,
  extra: { bindings?: PageBindings; context?: PageContext } = {}
): Promise<string> {
  return await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      {...(extra.context === undefined ? {} : { context: extra.context })}
      {...(extra.bindings === undefined ? {} : { bindings: extra.bindings })}
    />
  );
}

/** Every heading element's id in the drawn page, in order. */
function headingIds(html: string): (string | null)[] {
  return [...html.matchAll(/<h[1-6]([^>]*)>/g)].map(
    ([, attributes]) => /\sid="([^"]*)"/.exec(attributes ?? "")?.[1] ?? null
  );
}

describe("the page outline's anchors, as the page draws them", () => {
  it("numbers repeats across Heading blocks and Rich text, in page order", async () => {
    const html = await drawn(
      page(
        heading("Notes"),
        heading("Notes"),
        richText(passage(["h2", "Notes"]))
      )
    );
    expect(headingIds(html)).toEqual(["notes", "notes-2", "notes-3"]);
  });

  it("numbers a heading two Rich text passages share, rather than repeating its id", async () => {
    const html = await drawn(
      page(
        richText(passage(["h2", "Notes"], ["h3", "Details"])),
        richText(passage(["h2", "Notes"]))
      )
    );
    expect(headingIds(html)).toEqual(["notes", "details", "notes-2"]);
  });

  it("keeps letters in any script", async () => {
    const html = await drawn(
      page(
        heading("Über uns"),
        heading("日本語"),
        richText(passage(["h2", "Café au lait"]))
      )
    );
    expect(headingIds(html)).toEqual(["über-uns", "日本語", "café-au-lait"]);
  });

  it("never makes an id the author gave any block on the page, before or after it", async () => {
    const html = await drawn(
      page(
        heading("Intro"),
        heading("About", { cssId: "intro" }),
        box([], { cssId: "notes" }),
        richText(passage(["h2", "Notes"]))
      )
    );
    // The author's own id is the anchor of the heading that carries it.
    expect(headingIds(html)).toEqual(["intro-2", "intro", "notes-2"]);
  });

  it("counts an id written in a block's HTML attributes as the author's", async () => {
    const html = await drawn(
      page(box([], { attributes: { id: "faq" } }), heading("FAQ"))
    );
    expect(headingIds(html)).toEqual(["faq-2"]);
  });

  it("gives a heading with no words no id", async () => {
    const html = await drawn(page(heading("   "), heading("Kept")));
    expect(headingIds(html)).toEqual([null, "kept"]);
  });

  it("lists a bound heading by its entry's words", async () => {
    seen = undefined;
    const html = await drawn(
      page(
        heading("Placeholder", {
          bindings: { text: { $bind: "title" } },
        }),
        probeNode()
      ),
      { bindings: { entry: { title: "Hello, world" } } }
    );
    expect(headingIds(html)).toEqual(["hello-world"]);
    expect(
      outlineSeen()?.headings.map(({ text, anchor }) => [text, anchor])
    ).toEqual([["Hello, world", "hello-world"]]);
  });

  it("lists a template's own headings and the entry's content field's, in place", async () => {
    const template: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "template",
      nodes: [
        heading("Notes", { id: "title" }),
        {
          id: "ec",
          type: "core/entry-content",
          version: 1,
          props: { field: "body" },
        },
        heading("Notes", { id: "after" }),
        probeNode(),
      ],
    };
    const body = page(heading("Notes"), richText(passage(["h3", "Deeper"])));
    seen = undefined;
    const html = await drawn(
      composeEntryContent(template, { valueOf: field => ({ body })[field] })
    );
    expect(headingIds(html)).toEqual(["notes", "notes-2", "deeper", "notes-3"]);
    // The entry's blocks are composed in with ids of their own, so they are
    // told apart by sitting inside the Entry content block.
    expect(
      outlineSeen()?.headings.map(({ text, anchor, level, within }) => [
        text,
        anchor,
        level,
        within.includes("core/entry-content"),
      ])
    ).toEqual([
      ["Notes", "notes", 2, false],
      ["Notes", "notes-2", 2, true],
      ["Deeper", "deeper", 3, true],
      ["Notes", "notes-3", 2, false],
    ]);
  });

  it("is set on the context of a page drawn with no outline of its own", async () => {
    seen = undefined;
    await drawn(page(heading("One"), probeNode()), {
      context: createStandaloneContext(),
    });
    expect(outlineSeen()?.headings.map(entry => entry.anchor)).toEqual(["one"]);
  });
});

describe("blocks drawn with no page outline", () => {
  it("anchor their headings as the block alone would be", async () => {
    // `BlockList` is public, and a host drawing blocks with it makes no
    // outline: each block is then outlined by itself.
    const html = await renderToHtml(
      <BlockList
        nodes={[
          heading("Notes"),
          heading("Own words", { cssId: "own" }),
          richText(passage(["h2", "Notes"], ["h3", "Notes"])),
        ]}
        context={createStandaloneContext()}
        blocks={resolver}
        classes={{}}
      />
    );
    expect(headingIds(html)).toEqual(["notes", "own", "notes", "notes-2"]);
  });
});

describe("a list drawn with no page outline", () => {
  it("still tells its entries' headings apart", async () => {
    const find = vi.fn(() =>
      Promise.resolve({ items: [{ id: "a" }, { id: "b" }], total: 2 })
    );
    const html = await renderToHtml(
      <BlockList
        nodes={[
          {
            id: "list",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", limit: 10 },
            slots: {
              children: [heading("Title"), richText(passage(["h2", "Notes"]))],
            },
          },
        ]}
        context={createStandaloneContext({ data: { find } })}
        blocks={resolver}
        classes={{}}
      />
    );
    expect(headingIds(html)).toEqual([
      "title--0",
      "notes--0",
      "title--1",
      "notes--1",
    ]);
  });
});

describe("a host's own class-based context", () => {
  it("gets the outline without being copied: its methods keep their receiver", async () => {
    // A method reading a native private field throws on any object but the
    // instance itself, so a copy of the context would fail here.
    class HostContext implements PageContext {
      entry = null;
      #path = "/resolved";
      resolveMedia(): Promise<null> {
        return Promise.resolve(null);
      }
      resolveEntryPath(): Promise<string> {
        return Promise.resolve(this.#path);
      }
    }
    const caller = defineBlock<Record<string, never>>({
      name: "test/path-caller",
      version: 1,
      description: "Calls a context method that reads a private field.",
      example: { props: {} },
      render: async ({ ctx, className }) => (
        <p className={className}>{await ctx.resolveEntryPath("posts", "1")}</p>
      ),
    });
    const html = await renderToHtml(
      <PageRenderer
        document={page(heading("Notes"), heading("Notes"), {
          id: "caller",
          type: "test/path-caller",
          version: 1,
          props: {},
        })}
        blocks={createBlockResolver([...coreBlocks, caller])}
        siteStyles={false}
        context={new HostContext()}
      />
    );
    expect(headingIds(html)).toEqual(["notes", "notes-2"]);
    expect(html).toContain("/resolved");
  });

  it("works on a frozen one, whose own fields a view may not report changed", async () => {
    class HostContext implements PageContext {
      entry = null;
      // An own field, and an own method field: frozen, both are read-only.
      outline = undefined;
      resolveMedia = (): Promise<null> => Promise.resolve(null);
      resolveEntryPath(): Promise<string> {
        return Promise.resolve("/resolved");
      }
    }
    const caller = defineBlock<Record<string, never>>({
      name: "test/frozen-caller",
      version: 1,
      description: "Calls the context's own method field.",
      example: { props: {} },
      render: async ({ ctx, className }) => (
        <p className={className}>
          {String(await ctx.resolveMedia("m"))}
          {await ctx.resolveEntryPath("posts", "1")}
        </p>
      ),
    });
    const html = await renderToHtml(
      <PageRenderer
        document={page(heading("Notes"), {
          id: "caller",
          type: "test/frozen-caller",
          version: 1,
          props: {},
        })}
        blocks={createBlockResolver([...coreBlocks, caller])}
        siteStyles={false}
        context={Object.freeze(new HostContext())}
      />
    );
    expect(headingIds(html)).toEqual(["notes"]);
    // Both methods answered: the own field and the one on the prototype.
    expect(html.replaceAll("<!-- -->", "")).toContain("null/resolved");
  });

  it("keeps the outline where a block copies the context for what it holds", async () => {
    // A Collection list draws each entry under a copy of its context, as an
    // object spread: the view must hand that copy the outline too.
    class HostContext implements PageContext {
      entry = null;
      data = {
        find: () => Promise.resolve({ items: [{ id: "a" }], total: 1 }),
      };
      resolveMedia(): Promise<null> {
        return Promise.resolve(null);
      }
      resolveEntryPath(): Promise<string> {
        return Promise.resolve("");
      }
    }
    const html = await renderToHtml(
      <PageRenderer
        document={page({
          id: "list",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts", limit: 10 },
          slots: { children: [heading("Title")] },
        })}
        blocks={resolver}
        siteStyles={false}
        context={new HostContext() as unknown as PageContext}
      />
    );
    expect(headingIds(html)).toEqual(["title--0"]);
  });
});

describe("a heading left out of the table of contents", () => {
  it("keeps its anchor, and the outline says it is left out", async () => {
    seen = undefined;
    const html = await drawn(
      page(
        heading("Kept in"),
        heading("Left out", { props: { tocExclude: true } }),
        probeNode()
      )
    );
    expect(headingIds(html)).toEqual(["kept-in", "left-out"]);
    expect(
      outlineSeen()?.headings.map(({ anchor, leftOut }) => [anchor, leftOut])
    ).toEqual([
      ["kept-in", false],
      ["left-out", true],
    ]);
  });
});

describe("the outline of a page drawn inside its Layout", () => {
  it("runs across the header, the page and the footer, in that order", async () => {
    const region = (area: "header" | "footer", nodes: BlockNode[]) => ({
      region: { area, componentId: `${area}-component` },
      document: page(...nodes),
      prepared: null,
    });
    const shared = {
      context: createStandaloneContext(),
      blocks: resolver,
    };
    seen = undefined;
    const html = await renderToHtml(
      <>
        {drawWithRegions({
          regions: [
            region("footer", [heading("Notes")]),
            region("header", [heading("Notes")]),
          ],
          page: {
            ...shared,
            document: page(heading("Notes"), probeNode()),
          },
          shared,
          siteStyles: undefined,
          definitions: new Map(),
        })}
      </>
    );
    expect(headingIds(html)).toEqual(["notes", "notes-2", "notes-3"]);
    expect(
      outlineSeen()?.headings.map(({ area, anchor }) => [area, anchor])
    ).toEqual([
      ["header", "notes"],
      ["content", "notes-2"],
      ["footer", "notes-3"],
    ]);
  });
});

describe("the outline of parts that reuse a node id", () => {
  it("anchors each part's block by its own heading, not the first part's", async () => {
    // Node ids are unique within one document; a header and a page are two.
    const shared = {
      context: createStandaloneContext(),
      blocks: resolver,
    };
    const html = await renderToHtml(
      <>
        {drawWithRegions({
          regions: [
            {
              region: { area: "header", componentId: "header-component" },
              document: page(heading("Notes", { id: "same" })),
              prepared: null,
            },
          ],
          page: { ...shared, document: page(heading("Notes", { id: "same" })) },
          shared,
          siteStyles: undefined,
          definitions: new Map(),
        })}
      </>
    );
    expect(headingIds(html)).toEqual(["notes", "notes-2"]);
  });
});

describe("a heading drawn once per entry of a Collection list", () => {
  it("carries the entry's place after its anchor, so no two entries share an id", async () => {
    const find = vi.fn(() =>
      Promise.resolve({ items: [{ id: "a" }, { id: "b" }], total: 2 })
    );
    const html = await drawn(
      page(heading("Title"), {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "posts", limit: 10 },
        slots: { children: [heading("Title")] },
      }),
      { context: createStandaloneContext({ data: { find } }) }
    );
    expect(headingIds(html)).toEqual(["title", "title-2--0", "title-2--1"]);
  });

  it("anchors a Rich text bound to each entry by the passage the entry gives it", async () => {
    // The template's own passage is empty: the entry's words are known only
    // once each entry is drawn.
    const empty: RichTextValue = {
      root: { type: "root", children: [{ type: "paragraph", children: [] }] },
    };
    const find = vi.fn(() =>
      Promise.resolve({
        items: [
          { id: "a", body: passage(["h2", "Notes"], ["h3", "More"]) },
          { id: "b", body: passage(["h2", "Notes"]) },
        ],
        total: 2,
      })
    );
    const html = await drawn(
      page(heading("Notes"), {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "posts", limit: 10 },
        slots: {
          children: [
            {
              ...richText(empty),
              bindings: { content: { $bind: "body", source: "item" } },
            },
          ],
        },
      }),
      { context: createStandaloneContext({ data: { find } }), bindings: {} }
    );
    // Never a made anchor of the page (`notes`), and each entry's own.
    expect(headingIds(html)).toEqual([
      "notes",
      "notes-2--0",
      "more--0",
      "notes-2--1",
    ]);
  });

  it("keeps the page's anchors for passages an entry draws as the template holds them", async () => {
    const find = vi.fn(() =>
      Promise.resolve({ items: [{ id: "a" }, { id: "b" }], total: 2 })
    );
    const html = await drawn(
      page({
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "posts", limit: 10 },
        slots: {
          children: [
            richText(passage(["h2", "Notes"])),
            richText(passage(["h2", "Notes"])),
          ],
        },
      }),
      { context: createStandaloneContext({ data: { find } }) }
    );
    expect(headingIds(html)).toEqual([
      "notes--0",
      "notes-2--0",
      "notes--1",
      "notes-2--1",
    ]);
  });

  it("tells apart two passages one entry gives two Rich text blocks", async () => {
    const empty: RichTextValue = {
      root: { type: "root", children: [{ type: "paragraph", children: [] }] },
    };
    const bound = (field: string): BlockNode => ({
      ...richText(empty),
      bindings: { content: { $bind: field, source: "item" } },
    });
    const find = vi.fn(() =>
      Promise.resolve({
        items: [
          {
            id: "a",
            first: passage(["h2", "Notes"]),
            second: passage(["h2", "Notes"]),
          },
        ],
        total: 1,
      })
    );
    const html = await drawn(
      page(heading("Notes"), {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "posts", limit: 10 },
        slots: { children: [bound("first"), bound("second")] },
      }),
      { context: createStandaloneContext({ data: { find } }), bindings: {} }
    );
    expect(headingIds(html)).toEqual(["notes", "notes-2--0", "notes-2--0--p2"]);
  });

  it("tells apart passages entries give Rich text blocks in two lists", async () => {
    const empty: RichTextValue = {
      root: { type: "root", children: [{ type: "paragraph", children: [] }] },
    };
    const list = (id: string): BlockNode => ({
      id,
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts", limit: 10 },
      slots: {
        children: [
          {
            ...richText(empty),
            bindings: { content: { $bind: "body", source: "item" } },
          },
        ],
      },
    });
    const find = vi.fn(() =>
      Promise.resolve({
        items: [{ id: "a", body: passage(["h2", "Notes"]) }],
        total: 1,
      })
    );
    const html = await drawn(page(heading("Notes"), list("one"), list("two")), {
      context: createStandaloneContext({ data: { find } }),
      bindings: {},
    });
    expect(headingIds(html)).toEqual(["notes", "notes-2--0", "notes-2--0--p2"]);
  });

  it("anchors a Heading bound to each entry, with no words of its own, by the entry's words", async () => {
    const find = vi.fn(() =>
      Promise.resolve({
        items: [
          { id: "a", title: "First post" },
          { id: "b", title: "Second post" },
        ],
        total: 2,
      })
    );
    const html = await drawn(
      page({
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "posts", limit: 10 },
        slots: {
          children: [
            heading("", {
              bindings: { text: { $bind: "title", source: "item" } },
            }),
          ],
        },
      }),
      { context: createStandaloneContext({ data: { find } }), bindings: {} }
    );
    expect(headingIds(html)).toEqual(["first-post--0", "second-post--1"]);
  });

  it("compares an entry passage with its own part's reading, not another part's block of the same id", async () => {
    const empty: RichTextValue = {
      root: { type: "root", children: [{ type: "paragraph", children: [] }] },
    };
    const find = vi.fn(() =>
      Promise.resolve({
        items: [{ id: "a", body: passage(["h2", "Notes"]) }],
        total: 1,
      })
    );
    const shared = {
      context: createStandaloneContext({ data: { find } }),
      blocks: resolver,
      bindings: {},
    };
    const html = await renderToHtml(
      <>
        {drawWithRegions({
          regions: [
            {
              region: { area: "header", componentId: "header-component" },
              document: page(heading("Notes", { id: "r" })),
              prepared: null,
            },
          ],
          page: {
            ...shared,
            document: page({
              id: "list",
              type: "core/collection-loop",
              version: 1,
              props: { collection: "posts", limit: 10 },
              slots: {
                children: [
                  {
                    ...richText(empty, "r"),
                    bindings: { content: { $bind: "body", source: "item" } },
                  },
                ],
              },
            }),
          },
          shared,
          siteStyles: undefined,
          definitions: new Map(),
        })}
      </>
    );
    expect(headingIds(html)).toEqual(["notes", "notes-2--0"]);
  });

  it("never draws an entry's id an author gave another block", async () => {
    const find = vi.fn(() =>
      Promise.resolve({ items: [{ id: "a" }, { id: "b" }], total: 2 })
    );
    const html = await drawn(
      page(heading("Elsewhere", { cssId: "title--0" }), {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "posts", limit: 10 },
        slots: { children: [heading("Title")] },
      }),
      { context: createStandaloneContext({ data: { find } }) }
    );
    expect(headingIds(html)).toEqual(["title--0", "title--0--2", "title--1"]);
  });
});

describe("pageOutline", () => {
  const parts = (
    ...list: [OutlinePart["area"], BlockNode[]][]
  ): OutlinePart[] => list.map(([area, nodes]) => ({ area, nodes }));

  it("walks the parts in the order given, and each part depth first", () => {
    const outline = pageOutline(
      parts(
        ["header", [heading("Site")]],
        [
          "content",
          [
            heading("First"),
            box([heading("Inside"), richText(passage(["h3", "Passage"]))]),
            heading("Last"),
          ],
        ],
        ["footer", [heading("Footer")]]
      )
    );
    expect(outline.headings.map(({ area, text }) => [area, text])).toEqual([
      ["header", "Site"],
      ["content", "First"],
      ["content", "Inside"],
      ["content", "Passage"],
      ["content", "Last"],
      ["footer", "Footer"],
    ]);
  });

  it("names the blocks each heading sits inside, outermost first", () => {
    const inner = heading("Inside");
    const outline = pageOutline(
      parts(["content", [box([box([inner])]), heading("Top")]])
    );
    expect(outline.headings.map(entry => entry.within)).toEqual([
      ["core/box", "core/box"],
      [],
    ]);
  });

  it("answers each block's anchors in the order the block draws its headings", () => {
    const passageNode = richText(
      passage(["h2", "A"], ["h2", "A"], ["h3", "B"])
    );
    const single = heading("A");
    const outline = pageOutline(parts(["content", [single, passageNode]]));
    expect(outline.anchorsOf(single.id)).toEqual(["a"]);
    expect(outline.anchorsOf(passageNode.id)).toEqual(["a-2", "a-3", "b"]);
    expect(outline.anchorsOf("no-such-block")).toEqual([]);
  });

  it("changes what an editor keeps a list's output by when a list put before it renumbers its passages", () => {
    // An entry's own passage is numbered among the Rich text blocks inside
    // lists on the page; the editor keeps a list's output by `anchorsWithin`.
    const list = (id: string): BlockNode => ({
      id,
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: { children: [richText(passage(), `${id}-text`)] },
    });
    const last = list("last");
    const within = (...nodes: BlockNode[]) =>
      anchorsWithin({ outline: pageOutline(parts(["content", nodes])) }, last);
    expect(within(list("first"), last)).not.toEqual(
      within(list("first"), list("middle"), last)
    );
  });

  it("changes what an editor keeps a list's output by when a heading outside it takes a slug its entry passages may need", () => {
    const list: BlockNode = {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: { children: [richText(passage(), "list-text")] },
    };
    const within = (words: string) =>
      anchorsWithin(
        { outline: pageOutline(parts(["content", [heading(words), list]])) },
        list
      );
    expect(within("Hello")).not.toEqual(within("Notes"));
  });

  it("changes what an editor keeps a list's output by when an author id it must step past appears", () => {
    const list: BlockNode = {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: { children: [heading("Title", { id: "t" })] },
    };
    const within = (cssId: string) =>
      anchorsWithin(
        {
          outline: pageOutline(
            parts(["content", [box([], { id: "b", cssId }), list]])
          ),
        },
        list
      );
    expect(within("other")).not.toEqual(within("title--0"));
  });

  it("keeps what an editor keeps a heading's output by while an unrelated heading changes", () => {
    // A Heading linked to an entry draws after a promise; its kept output
    // need not be drawn again (its entry's path read again) for a rename
    // that leaves its own anchor as it was.
    const linked = heading("Pricing", { id: "linked" });
    const within = (words: string) =>
      anchorsWithin(
        {
          outline: pageOutline(
            parts(["content", [heading(words, { id: "other" }), linked]])
          ),
        },
        linked
      );
    expect(within("Intro")).toEqual(within("Introduction"));
  });

  it("numbers entry passages per part, as node ids are only unique within one", () => {
    const list = (): BlockNode => ({
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: { children: [richText(passage(), "same")] },
    });
    const outline = pageOutline(
      parts(["header", [list()]], ["content", [list()]])
    );
    const header = outlineForPart(outline, "header");
    const content = outlineForPart(outline, "content");
    const key = (view: PageOutline) => anchorsWithin({ outline: view }, list());
    expect(key(header)).not.toEqual(key(content));
  });

  it("reads a heading's level as the block draws it", () => {
    const outline = pageOutline(
      parts([
        "content",
        [
          heading("Top", { props: { level: "h1" } }),
          heading("Odd", { props: { level: "h9" } }),
        ],
      ])
    );
    expect(outline.headings.map(entry => entry.level)).toEqual([1, 2]);
  });
});

describe("which headings a table of contents lists", () => {
  const listedOf = (...list: [OutlinePart["area"], BlockNode[]][]) =>
    pageOutline(list.map(([area, nodes]) => ({ area, nodes }))).headings.map(
      ({ text, listed }) => [text, listed]
    );

  const holding = (type: string, children: BlockNode[]): BlockNode => ({
    id: nextId("c"),
    type,
    version: 1,
    props: {},
    slots: { children },
  });

  /** Stored per-device visibility, as the Layers panel writes it. */
  const shownOn = (devices: Record<string, boolean>) => ({
    visibility: { devices },
  });

  it("lists the page's own headings, in the Heading blocks and in Rich text", () => {
    expect(
      listedOf([
        "content",
        [heading("Intro"), richText(passage(["h3", "Deeper"]))],
      ])
    ).toEqual([
      ["Intro", true],
      ["Deeper", true],
    ]);
  });

  it("leaves out the header's and the footer's headings", () => {
    expect(
      listedOf(
        ["header", [heading("Site")]],
        ["content", [heading("Page")]],
        ["footer", [heading("Footer")]]
      )
    ).toEqual([
      ["Site", false],
      ["Page", true],
      ["Footer", false],
    ]);
  });

  it("leaves out headings inside a Collection list or an accordion, however deep", () => {
    expect(
      listedOf([
        "content",
        [
          holding("core/collection-loop", [box([heading("In a list")])]),
          holding("core/accordion", [
            holding("core/accordion-item", [
              richText(passage(["h2", "In a question"])),
            ]),
          ]),
          box([heading("In a box")]),
        ],
      ])
    ).toEqual([
      ["In a list", false],
      ["In a question", false],
      ["In a box", true],
    ]);
  });

  it("leaves out a heading its author left out", () => {
    expect(
      listedOf([
        "content",
        [heading("Out", { props: { tocExclude: true } }), heading("In")],
      ])
    ).toEqual([
      ["Out", false],
      ["In", true],
    ]);
  });

  it("leaves out a heading hidden on every device, or inside a block that is", () => {
    expect(
      listedOf([
        "content",
        [
          heading("Hidden", shownOn({ base: false })),
          box([heading("Inside hidden")], shownOn({ base: false })),
          // Hidden from the widest device down, shown again on phones.
          heading("Phones only", shownOn({ base: false, mobile: true })),
          // Hidden on phones only: still read on every other device.
          heading("Not on phones", shownOn({ mobile: false })),
          heading("Shown", shownOn({ base: true })),
        ],
      ])
    ).toEqual([
      ["Hidden", false],
      ["Inside hidden", false],
      ["Phones only", true],
      ["Not on phones", true],
      ["Shown", true],
    ]);
  });
});
