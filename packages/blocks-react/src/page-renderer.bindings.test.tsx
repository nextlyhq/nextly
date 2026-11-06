/**
 * A published page fills each bound prop from its source before blocks
 * render: the entry, a list item, a Single or the site settings, by its path,
 * following one relation at most, and shows the fallback, or the prop's own
 * value, when the value is empty.
 *
 * Every fixture keeps the prop's own value, the fallback and the source's
 * value distinct, so an assertion can only pass on the one that should show.
 */
import {
  defineBlock as defineEngineBlock,
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
  type Binding,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import {
  createStandaloneContext,
  defineBlock,
  type BlocksQuery,
  type PageBindings,
} from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";
import { resolvePageStyles } from "./styles";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

/** A block with a number and an on/off prop, drawn as data attributes. */
const stat = defineBlock<{ count?: number; shown?: boolean }>({
  name: "test/stat",
  version: 1,
  description: "Shows a count and a flag.",
  example: { props: {} },
  props: {
    count: { type: "number" },
    shown: { type: "checkbox" },
  },
  render: ({ props, className }) => (
    <p
      className={className}
      data-count={String(props.count)}
      data-shown={String(props.shown)}
    />
  ),
});

/** A contributed block, written against the engine alone, reading `bound`. */
const when = defineEngineBlock<{ label?: string }>({
  name: "test/when",
  version: 1,
  description: "Shows a date and its machine value.",
  example: { props: {} },
  props: { label: { type: "text" } },
  render: ({ props, bound }) => {
    const value = bound?.label;
    return (
      <span data-datetime={value?.kind === "date" ? value.datetime : "none"}>
        {props.label}
      </span>
    );
  },
});

/** A label that draws nothing while it is empty. */
const badge = defineBlock<{ label?: string }>({
  name: "test/badge",
  version: 1,
  description: "Shows a label, or nothing while it has none.",
  example: { props: {} },
  props: { label: { type: "text" } },
  rendersNothing: props =>
    typeof props.label !== "string" || props.label === "",
  render: ({ props, className }) => (
    <span className={className}>{props.label}</span>
  ),
});

const resolver = createBlockResolver([
  ...coreBlocks,
  stat as AnyBlockDefinition,
  when as AnyBlockDefinition,
  badge as AnyBlockDefinition,
]);

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

function heading(
  id: string,
  binding: Binding | undefined,
  own = "Own"
): BlockNode {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text: own, level: "h2" },
    ...(binding === undefined ? {} : { bindings: { text: binding } }),
  };
}

async function render(
  document: BlockDocument,
  bindings: PageBindings,
  extra: Partial<Parameters<typeof PageRenderer>[0]> = {}
): Promise<string> {
  return await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      bindings={bindings}
      {...extra}
    />
  );
}

/** The text of every `<h2>`, in order. */
function headings(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(match =>
    (match[1] ?? "").replace(/<[^>]+>/g, "")
  );
}

describe("filling bound props on a published page", () => {
  it("fills a bound prop from the entry, a Single and the site settings by its path", async () => {
    const html = await render(
      page(
        heading("a", { $bind: "title" }),
        heading("b", { $bind: "tagline", source: "single", sourceKey: "home" }),
        heading("c", { $bind: "applicationName", source: "site" })
      ),
      {
        entry: { title: "From entry" },
        singles: new Map([["home", { tagline: "From single" }]]),
        site: {
          applicationName: "From site",
          siteUrl: null,
          logoUrl: null,
          timezone: null,
        },
      }
    );
    expect(headings(html)).toEqual(["From entry", "From single", "From site"]);
  });

  it("never reads a value from the context's entry, which a route may have read with more access", async () => {
    const html = await render(
      page(heading("a", { $bind: "title" })),
      {
        entry: { title: "Public" },
      },
      {
        context: createStandaloneContext({ entry: { title: "Trusted" } }),
      }
    );
    expect(headings(html)).toEqual(["Public"]);
  });

  it("fills a bound prop inside a collection loop from each item", async () => {
    const asked: BlocksQuery[] = [];
    const loop: BlockNode = {
      id: "loop",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts", limit: 2 },
      slots: {
        children: [heading("item", { $bind: "title", source: "item" })],
      },
    };
    const html = await render(
      page(loop),
      {},
      {
        context: createStandaloneContext({
          data: {
            find: query => {
              asked.push(query);
              return Promise.resolve({
                items: [
                  { id: "1", title: "First post" },
                  { id: "2", title: "Second post" },
                ],
              });
            },
          },
        }),
      }
    );
    expect(asked).toHaveLength(1);
    expect(headings(html)).toEqual(["First post", "Second post"]);
  });

  it("follows one to-one relation (author.name), and falls back when the relation is missing", async () => {
    const document = page(
      heading("a", { $bind: "author.name", fallback: "No author" })
    );
    expect(
      headings(await render(document, { entry: { author: { name: "Ada" } } }))
    ).toEqual(["Ada"]);
    expect(
      headings(await render(document, { entry: { author: null } }))
    ).toEqual(["No author"]);
    // A relation the read left as its id was not followed, so it falls back.
    expect(
      headings(await render(document, { entry: { author: "a1" } }))
    ).toEqual(["No author"]);
  });

  it("renders the fallback for an absent field, null, an empty string, an empty rich text and an empty list, and the prop's own value when there is no fallback", async () => {
    const emptyRichText = {
      root: { type: "root", children: [{ type: "paragraph", children: [] }] },
    };
    const html = await render(
      page(
        heading("absent", { $bind: "missing", fallback: "Fallback" }),
        heading("null", { $bind: "nothing", fallback: "Fallback" }),
        heading("blank", { $bind: "blank", fallback: "Fallback" }),
        heading("rich", { $bind: "body", fallback: "Fallback" }),
        heading("list", { $bind: "tags", fallback: "Fallback" }),
        heading("own", { $bind: "blank" })
      ),
      {
        entry: { nothing: null, blank: "", body: emptyRichText, tags: [] },
      }
    );
    expect(headings(html)).toEqual([
      "Fallback",
      "Fallback",
      "Fallback",
      "Fallback",
      "Fallback",
      "Own",
    ]);
  });

  it("renders false and 0 as values", async () => {
    const html = await render(
      page({
        id: "s",
        type: "test/stat",
        version: 1,
        props: { count: 5, shown: true },
        bindings: {
          count: { $bind: "count", fallback: 9 },
          shown: { $bind: "shown" },
        },
      }),
      { entry: { count: 0, shown: false } }
    );
    expect(html).toContain('data-count="0"');
    expect(html).toContain('data-shown="false"');
  });

  it("a core heading bound to a date renders <time datetime>", async () => {
    const html = await render(
      page(
        heading("a", {
          $bind: "publishedAt",
          format: { type: "date", options: { dateStyle: "long" } },
        })
      ),
      { entry: { publishedAt: "2026-03-29T00:00:00.000Z" } }
    );
    expect(html).toContain('<time dateTime="2026-03-29">March 29, 2026</time>');
  });

  it("a contributed block receives the machine value of its bound date as `bound`", async () => {
    const html = await render(
      page({
        id: "w",
        type: "test/when",
        version: 1,
        props: { label: "Own" },
        bindings: {
          label: {
            $bind: "startsAt",
            format: { type: "date", options: { dateStyle: "medium" } },
          },
        },
      }),
      { entry: { startsAt: "2026-03-29T18:30:00.000Z" } }
    );
    expect(html).toContain('data-datetime="2026-03-29T18:30:00.000Z"');
    expect(html).toContain("Mar 29, 2026");
  });

  it("keeps the styles of a block bound to its list item, which draws once the item fills it", async () => {
    // Empty as stored, so a save holds its rules back as drawless; the list
    // fills its label per item.
    const document = page({
      id: "loop",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts", limit: 1 },
      slots: {
        children: [
          {
            id: "badge",
            type: "test/badge",
            version: 1,
            props: { label: "" },
            bindings: { label: { $bind: "title", source: "item" } },
            styles: { base: { base: { color: "teal" } } },
          },
        ],
      },
    });
    // A sheet stored while the block was not yet bound: its rules are held
    // apart, as the rules of a node that draws nothing. Same ids, same styles.
    const unbound = JSON.parse(
      JSON.stringify(document).replace(
        /"bindings":\{"label":\{"\$bind":"title","source":"item"\}\},/,
        ""
      )
    ) as BlockDocument;
    expect(JSON.stringify(unbound)).not.toContain("bindings");
    const styles = resolvePageStyles(
      unbound,
      undefined,
      { breakpoints: { viewport: [], container: [] } },
      resolver
    );
    // The control: that sheet holds the node's rules apart.
    expect(JSON.stringify(styles.gated ?? {})).toContain("teal");
    expect(styles.css).not.toContain("teal");
    const html = await render(
      document,
      {},
      {
        styles,
        context: createStandaloneContext({
          data: {
            find: () => Promise.resolve({ items: [{ id: "1", title: "New" }] }),
          },
        }),
      }
    );
    expect(html).toContain(">New</span>");
    expect(html).toContain("teal");
  });

  it("binding does not withhold a stored stylesheet", async () => {
    const document = page({
      ...heading("a", { $bind: "title" }),
      styles: { base: { base: { color: "rebeccapurple" } } },
    });
    // Compiled as a save compiles it: from the stored props, before any
    // binding is filled.
    const styles = resolvePageStyles(
      document,
      undefined,
      { breakpoints: { viewport: [], container: [] } },
      resolver
    );
    expect(styles.css).toContain("rebeccapurple");
    const html = await render(
      document,
      { entry: { title: "From entry" } },
      {
        styles,
      }
    );
    expect(headings(html)).toEqual(["From entry"]);
    expect(html).toContain("rebeccapurple");
  });
});
