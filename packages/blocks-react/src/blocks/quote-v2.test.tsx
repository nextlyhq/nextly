// @vitest-environment jsdom
/**
 * A Quote's source as the shared link, its three block styles, and a Quote
 * saved before either: read as version 2 with its source link kept, on a page
 * and inside a component the page places.
 */
import {
  blockLooks,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  migrateDocument,
  type BlockDocument,
  type DefinitionsById,
  type NamedClass,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext, type PageContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { migrationSourceFor, type BlockResolver } from "../resolver";

import { coreBlocks } from "./index";

const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};

/** A Quote as version 1 stored it: its source a loose address. */
const v1 = {
  id: "q",
  type: "core/quote",
  version: 1,
  props: {
    text: "Simplicity is the soul of efficiency.",
    attribution: "R. Austin Freeman",
    source: "The Eye of Osiris",
    citeUrl: "https://example.com/osiris",
  },
};

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

/** The page's markup, settled: React's streamed parts put back in place. */
async function markup(
  document: BlockDocument,
  options: {
    context?: PageContext;
    definitions?: DefinitionsById;
    classes?: readonly NamedClass[];
    via?: "styleContext" | "siteStyles";
  } = {}
): Promise<string> {
  const classes = options.classes ?? [];
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={resolver}
      context={options.context ?? createStandaloneContext({})}
      {...(options.definitions === undefined
        ? {}
        : { definitions: options.definitions })}
      {...(options.via === "siteStyles"
        ? { siteStyles: { breakpoints: BREAKPOINTS, classes } }
        : {
            styleContext: { breakpoints: BREAKPOINTS, namedClasses: classes },
          })}
    />
  );
  await stream.allReady;
  return new Response(stream).text();
}

const page = (nodes: unknown[]): BlockDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  }) as BlockDocument;

describe("a Quote saved before its source was the shared link", () => {
  it("is read as version 2, its source address the link's, nothing else set", () => {
    const { doc } = migrateDocument(page([v1]), migrationSourceFor(resolver));
    const [node] = doc.nodes;
    expect(node?.version).toBe(2);
    expect(node?.props).toEqual({
      text: v1.props.text,
      attribution: v1.props.attribution,
      source: v1.props.source,
      href: "https://example.com/osiris",
    });
  });

  it("keeps a source address bound to a field, as the link's binding", () => {
    const binding = { source: "entry", field: "website" };
    const { doc } = migrateDocument(
      page([{ ...v1, bindings: { citeUrl: binding } }]),
      migrationSourceFor(resolver)
    );
    expect(doc.nodes[0]?.bindings).toEqual({ href: binding });
    expect(doc.nodes[0]?.props.href).toBe("https://example.com/osiris");
  });

  it("keeps what it stored when it had no source address", () => {
    const { citeUrl: _none, ...bare } = v1.props;
    const { doc } = migrateDocument(
      page([{ ...v1, props: bare }]),
      migrationSourceFor(resolver)
    );
    expect(doc.nodes[0]?.props).toEqual(bare);
  });

  it("keeps its source link on the page, as cite and on the source's title", async () => {
    const html = await markup(page([v1]));
    expect(html).toContain('cite="https://example.com/osiris"');
    expect(html).toContain(
      '<cite><a href="https://example.com/osiris">The Eye of Osiris</a></cite>'
    );
  });

  it("keeps it inside a component the page places", async () => {
    const definitions: DefinitionsById = new Map([
      [
        "c1",
        {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "component",
          nodes: [v1],
        } as unknown as BlockDocument,
      ],
    ]);
    const html = await markup(
      page([
        {
          id: "p1",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "c1" },
        },
      ]),
      { definitions }
    );
    expect(html).toContain('cite="https://example.com/osiris"');
    expect(html).toContain('<a href="https://example.com/osiris">');
  });
});

describe("a Quote's source", () => {
  const sourced = (props: Record<string, unknown>) =>
    page([
      {
        id: "q",
        type: "core/quote",
        version: 2,
        props: {
          text: "Words",
          attribution: "Ada",
          source: "A Book",
          ...props,
        },
      },
    ]);

  it("links to an entry, opened in a new tab, with its relationship", async () => {
    const html = await markup(
      sourced({
        entryCollection: "pages",
        entryId: "p-1",
        target: "_blank",
        rel: "nofollow",
      }),
      {
        context: createStandaloneContext({
          resolveEntryPath: async (collection, id) =>
            collection === "pages" && id === "p-1" ? "/books" : null,
        }),
      }
    );
    expect(html).toContain('cite="/books"');
    expect(html).toContain(
      '<a href="/books" target="_blank" rel="nofollow noopener noreferrer">A Book</a>'
    );
  });

  it("draws the dash before the person's name in CSS, never in the words", async () => {
    const html = await markup(sourced({}));
    // The words hold no dash: it is the generated content of an empty
    // element before the name, hidden from screen readers.
    expect(html).toContain(
      '<span data-nx-quote-dash="" aria-hidden="true"></span>Ada'
    );
    expect(html).not.toMatch(/[—–]\s*Ada/);
    expect(html).toContain(
      '[data-nx-quote-dash]::before{content:"\\2014\\00a0"}'
    );
  });

  it("is plain text with no link set, and no cite", async () => {
    const html = await markup(sourced({}));
    expect(html).toContain("<cite>A Book</cite>");
    expect(html).not.toContain("cite=");
  });
});

describe("a Quote's block styles", () => {
  const looks = blockLooks(coreBlocks).filter(look =>
    look.id.startsWith("look:core/quote:")
  );
  const styled = (look: NamedClass | undefined) =>
    page([
      {
        id: "q",
        type: "core/quote",
        version: 2,
        props: { text: "Words" },
        ...(look === undefined ? {} : { classes: [look.id] }),
      },
    ]);

  it("are Line, its own, then Plain and Large", () => {
    expect(looks.map(look => look.id)).toEqual([
      "look:core/quote:plain",
      "look:core/quote:large",
    ]);
  });

  /** The declarations a page's sheets write, joined, for a match. */
  async function sheet(
    look: NamedClass | undefined,
    via: "styleContext" | "siteStyles"
  ): Promise<string> {
    const html = await markup(styled(look), { classes: looks, via });
    return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map(match => match[1])
      .join("\n");
  }

  it("draws Line, its own, as a line in the site's accent colour", async () => {
    const css = await sheet(undefined, "siteStyles");
    expect(css).toMatch(/border-inline-start-width:\s*4px/);
    expect(css).toMatch(/border-color:\s*var\(--site-color-primary/);
  });

  it.each(["plain", "large"])(
    "draws %s the same on the canvas and the published page",
    async name => {
      const look = looks.find(each => each.id === `look:core/quote:${name}`);
      const canvas = await sheet(look, "styleContext");
      const published = await sheet(look, "siteStyles");
      // This look's own rule, by its own class, reaches both, with the
      // same declarations.
      const rule = (css: string) =>
        new RegExp(`\\.nx-l-quote-${name}[^{]*\\{([^}]*)\\}`).exec(css)?.[1];
      expect(rule(published)).toBeDefined();
      expect(rule(canvas)).toBe(rule(published));
      expect(rule(published)).toMatch(/border-style:\s*none/);
      // Large's own declarations reach Large's rule, not Plain's.
      if (name === "large") {
        expect(rule(published)).toMatch(/font-size:\s*1\.5em/);
      } else {
        expect(rule(published)).not.toMatch(/font-size/);
      }
    }
  );

  it("makes Large bigger and centred", async () => {
    const look = looks.find(each => each.id === "look:core/quote:large");
    const css = await sheet(look, "siteStyles");
    expect(css).toMatch(/font-size:\s*1\.5em/);
    expect(css).toMatch(/text-align:\s*center/);
  });
});
