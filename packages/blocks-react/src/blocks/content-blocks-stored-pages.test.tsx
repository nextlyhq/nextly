/**
 * The content blocks' settings moved between the panel's tabs and gained
 * plain words; what a page stores, and what it renders, did not change.
 *
 * - A page stored before the move renders byte for byte as it did. Each
 *   expected markup below was rendered by the blocks as they were before it
 *   (a Heading linking by address only, a Button's type and label in
 *   Content), and is held here as written, never read back from the blocks
 *   now. React's streaming scripts are set aside: they are React's, not the
 *   page's.
 * - The settings added beside them do what they say: a Heading links to an
 *   entry, and the style groups added to a block reach the panel, while a
 *   Divider, with no text, offers no text colour.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  stylePropertiesForSupports,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext, type PageContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";

const blocks = createBlockResolver(coreBlocks as AnyBlockDefinition[]);

const node = (
  id: string,
  type: string,
  props: Record<string, unknown>
): BlockNode => ({ id, type, version: 1, props });

/** The page's markup, without React's streaming scripts. */
async function markup(
  nodes: BlockNode[],
  context: PageContext = createStandaloneContext({})
): Promise<string> {
  const document: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  };
  const stream = await renderToReadableStream(
    <PageRenderer document={document} blocks={blocks} context={context} />
  );
  const html = await new Response(stream).text();
  return html.replace(/<script>[\s\S]*?<\/script>/g, "");
}

/**
 * Each block with the settings a page could store before the move, and the
 * markup the blocks rendered for it then.
 */
const STORED: readonly (readonly [string, BlockNode[], string])[] = [
  [
    "heading",
    [
      node("h", "core/heading", { text: "Plain", level: "h1" }),
      node("h2", "core/heading", {
        text: "Linked",
        level: "h3",
        href: "/pricing",
        target: "_blank",
        rel: "nofollow",
      }),
    ],
    '<div class="nx-pb-page"><h1 class="nx-pb-2a4ezges7s8 nx-bt-core--heading">Plain</h1><h3 class="nx-pb-1dmcr9nzihr nx-bt-core--heading"><a href="/pricing" target="_blank" rel="nofollow noopener noreferrer">Linked</a></h3></div>',
  ],
  [
    "button",
    [
      node("b", "core/button", {
        label: "Send",
        type: "submit",
        ariaLabel: "Send the form",
      }),
      node("b2", "core/button", {
        label: "Read",
        href: "/docs",
        target: "_blank",
        rel: "sponsored",
      }),
    ],
    '<div class="nx-pb-page"><!--$?--><template id="B:0"></template><!--/$--><!--$?--><template id="B:1"></template><!--/$--></div><div hidden id="S:0"><button class="nx-pb-281l09f9qxc nx-bt-core--button" aria-label="Send the form" type="submit">Send</button></div><div hidden id="S:1"><a class="nx-pb-1dlmdl9upku nx-bt-core--button" href="/docs" target="_blank" rel="sponsored noopener noreferrer">Read</a></div>',
  ],
  [
    "quote",
    [
      node("q", "core/quote", {
        text: "Simplicity is the soul of efficiency.",
        attribution: "R. Austin Freeman",
        source: "The Eye of Osiris",
        citeUrl: "https://example.com/osiris",
      }),
    ],
    '<div class="nx-pb-page"><figure class="nx-pb-2cjpyijwyvj nx-bt-core--quote"><blockquote class="nx-bp-core--quote--quotation" cite="https://example.com/osiris"><p>Simplicity is the soul of efficiency.</p></blockquote><figcaption class="nx-bp-core--quote--attribution">R. Austin Freeman<!-- -->, <cite>The Eye of Osiris</cite></figcaption></figure></div>',
  ],
  [
    "embed",
    [
      node("e", "core/embed", {
        src: "https://example.com/player",
        title: "A product demo",
        allowFullscreen: true,
      }),
    ],
    '<div class="nx-pb-page"><iframe class="nx-pb-25ma17agocf nx-bt-core--embed" src="https://example.com/player" title="A product demo" sandbox="allow-scripts allow-popups allow-forms allow-presentation" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen=""></iframe></div>',
  ],
  [
    "list",
    [
      node("l", "core/list", { kind: "ordered", start: 3, items: ["c", "d"] }),
      // A start stored on a bulleted list, which the panel no longer offers
      // there: kept, and still drawn as nothing.
      node("l2", "core/list", { kind: "unordered", start: 4, items: ["a"] }),
    ],
    '<div class="nx-pb-page"><ol class="nx-pb-28qizzr3wjn nx-bt-core--list" start="3"><li>c</li><li>d</li></ol><ul class="nx-pb-819gj8pguf nx-bt-core--list"><li>a</li></ul></div>',
  ],
  [
    "divider",
    [node("d", "core/divider", {})],
    '<div class="nx-pb-page"><hr class="nx-pb-25yr12fra2g nx-bt-core--divider"/></div>',
  ],
];

describe("a page stored before the content blocks' settings moved", () => {
  it.each(STORED)("renders its %s as it did", async (_name, nodes, before) => {
    expect(await markup(nodes)).toBe(before);
  });
});

describe("the settings added beside them", () => {
  it("link a Heading to an entry, opened in a new tab", async () => {
    const html = await markup(
      [
        node("h", "core/heading", {
          text: "Our prices",
          entryCollection: "pages",
          entryId: "p-1",
          href: "/typed",
          target: "_blank",
        }),
      ],
      createStandaloneContext({
        resolveEntryPath: async (collection, id) =>
          collection === "pages" && id === "p-1" ? "/pricing" : null,
      })
    );
    // The entry beats the typed address, as on a button.
    expect(html).toContain(
      '<a href="/pricing" target="_blank" rel="noopener noreferrer">Our prices</a>'
    );
    expect(html).not.toContain("/typed");
  });

  /** The style properties the panel offers a core block. */
  const offered = (name: string): string[] =>
    stylePropertiesForSupports(
      coreBlocks.find(block => block.name === name)?.supports as never
    ).map(entry => entry.property);

  it.each([
    "core/section",
    "core/box",
    "core/columns",
    "core/column",
    "core/card",
    "core/button",
  ])("offer %s a shadow", name => {
    expect(offered(name)).toContain("boxShadow");
  });

  it.each(["core/heading", "core/list"])("offer %s a background", name => {
    expect(offered(name)).toContain("backgroundColor");
  });

  it("offer a Divider its line, and no text colour", () => {
    expect(offered("core/divider")).toContain("border");
    expect(offered("core/divider")).not.toContain("color");
  });
});
