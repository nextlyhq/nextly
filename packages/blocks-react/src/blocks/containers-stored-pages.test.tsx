/**
 * The containers' settings moved between the panel's tabs, gained plain
 * labels and new settings beside them; what a page stores, and what it
 * renders, did not change.
 *
 * - A page stored before the move renders byte for byte as it did. Each
 *   expected markup below was rendered by the containers as they were
 *   before it (Box and Card linking by address only, a Collection list with
 *   no HTML tag of its own), and is held here as written, never read back
 *   from the blocks now. React's streaming scripts are set aside: they are
 *   React's, not the page's.
 * - The settings added beside them render what they say: a Box or a Card
 *   links to an entry and opens in a new tab, and a Collection list renders
 *   the tag it is given.
 */
import {
  DOCUMENT_FORMAT_VERSION,
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
  props: Record<string, unknown>,
  children: BlockNode[] = []
): BlockNode => ({
  id,
  type,
  version: 1,
  props,
  ...(children.length === 0 ? {} : { slots: { children } }),
});

const words = (id: string, text: string): BlockNode =>
  node(id, "core/text", { text });

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
 * Each container with the settings a page could store before the move, and
 * the markup the containers rendered for it then.
 */
const STORED: readonly (readonly [string, BlockNode[], string])[] = [
  [
    "section",
    [
      node("s", "core/section", { as: "header", contained: true }, [
        words("s1", "A header band"),
      ]),
    ],
    '<div class="nx-pb-page"><header class="nx-pb-2d8ny8vr4hu nx-bt-core--section nx-pb-contained"><p class="nx-pb-2vr7maqhmj nx-bt-core--text">A header band</p></header></div>',
  ],
  [
    "box",
    [
      node("b", "core/box", { as: "aside", link: "/pricing" }, [
        words("b1", "A linked box"),
      ]),
      node("b2", "core/box", { link: "javascript:alert(1)" }, [
        words("b3", "An unusable link draws none"),
      ]),
    ],
    '<div class="nx-pb-page"><a class="nx-pb-281l09f9qxc nx-bt-core--box" href="/pricing"><p class="nx-pb-1ck7dzrh02a nx-bt-core--text">A linked box</p></a><div class="nx-pb-1dlmdl9upku nx-bt-core--box"><p class="nx-pb-1d95dq3b5ok nx-bt-core--text">An unusable link draws none</p></div></div>',
  ],
  [
    "columns",
    [
      node("c", "core/columns", { as: "section" }, [
        node("c1", "core/column", { as: "div" }, [words("c2", "Left")]),
        node("c3", "core/column", { contained: true }, [words("c4", "Right")]),
      ]),
    ],
    '<div class="nx-pb-page"><section class="nx-pb-27p40e8q713 nx-bt-core--columns"><div class="nx-pb-1b67gtepm4w nx-bt-core--column"><p class="nx-pb-1a4sh7xkusk nx-bt-core--text">Left</p></div><div class="nx-pb-1ah9h32vgil nx-bt-core--column nx-pb-contained"><p class="nx-pb-1c7mgex3bng nx-bt-core--text">Right</p></div></section></div>',
  ],
  [
    "card",
    [
      node("k", "core/card", { as: "article", link: "https://example.com" }, [
        words("k1", "A linked card"),
      ]),
    ],
    '<div class="nx-pb-page"><a class="nx-pb-2agvzbk2ti9 nx-bt-core--card" href="https://example.com"><p class="nx-pb-1gqpnrvag2e nx-bt-core--text">A linked card</p></a></div>',
  ],
  [
    // Its summary carries the toggle's part (its 44px height and focus
    // ring); it opens each question alone, as before the One at a time
    // setting, with no shared name and none opened for it.
    "accordion",
    [
      node("a", "core/accordion", { titlesAs: "h3" }, [
        node("a1", "core/accordion-item", { title: "A question" }, [
          words("a2", "Its answer"),
        ]),
      ]),
    ],
    '<div class="nx-pb-page"><div class="nx-pb-27060nww1es nx-bt-core--accordion"><details class="nx-pb-9qzzwcmnkx nx-bt-core--accordion-item"><summary class="nx-bp-core--accordion-item--toggle"><span class="nx-pb-disclosure-icon" aria-hidden="true"></span><h3 class="nx-pb-disclosure-title nx-bp-core--accordion-item--title">A question</h3></summary><p class="nx-pb-a3gzrhx9ay nx-bt-core--text">Its answer</p></details></div></div>',
  ],
  [
    "gallery",
    [node("g", "core/gallery", { as: "section", contained: true })],
    '<div class="nx-pb-page"><section class="nx-pb-26b80xmatyq nx-bt-core--gallery nx-pb-contained"></section></div>',
  ],
  [
    "collection list",
    [
      node("l", "core/collection-loop", { limit: 3, contained: true }, [
        words("l1", "Each entry"),
      ]),
    ],
    // The list is the same markup it was; it is now drawn in place, where it
    // was once sent in a hidden part React's script moved into place.
    '<div class="nx-pb-page"><div class="nx-pb-28qizzr3wjn nx-bt-core--collection-loop nx-pb-contained"><p class="nx-pb-8dqgee02kg nx-bt-core--text">Each entry</p></div></div>',
  ],
  [
    "entry content",
    [node("e", "core/entry-content", { field: "body" })],
    '<div class="nx-pb-page"></div>',
  ],
];

describe("a page stored before the containers' settings moved", () => {
  it.each(STORED)("renders its %s as it did", async (_, nodes, before) => {
    expect(await markup(nodes)).toBe(before);
  });
});

describe("the settings added beside them", () => {
  it("link a Box to an entry, at the entry's address", async () => {
    const html = await markup(
      [
        node(
          "b",
          "core/box",
          { link: "/typed", entryCollection: "pages", entryId: "p-1" },
          [words("b1", "To an entry")]
        ),
      ],
      createStandaloneContext({
        resolveEntryPath: async (collection, id) =>
          collection === "pages" && id === "p-1" ? "/pricing" : null,
      })
    );
    // The entry beats the typed address, as on a button.
    expect(html).toContain('href="/pricing"');
    expect(html).not.toContain("/typed");
  });

  it("open a Card's link in a new tab, with its relationship", async () => {
    const html = await markup([
      node(
        "k",
        "core/card",
        { link: "https://example.com", target: "_blank", rel: "sponsored" },
        [words("k1", "Elsewhere")]
      ),
    ]);
    expect(html).toMatch(
      /<a class="[^"]*nx-bt-core--card" href="https:\/\/example.com" target="_blank" rel="sponsored noopener noreferrer">/
    );
  });

  it("render a Collection list as the tag it is given", async () => {
    const html = await markup([
      node("l", "core/collection-loop", { as: "section" }, [
        words("l1", "Each entry"),
      ]),
    ]);
    expect(html).toMatch(/<section class="[^"]*nx-bt-core--collection-loop">/);
  });

  it("render a Collection list given an unknown tag as a generic box", async () => {
    const html = await markup([
      node("l", "core/collection-loop", { as: "img" }, [
        words("l1", "Each entry"),
      ]),
    ]);
    expect(html).toMatch(/<div class="[^"]*nx-bt-core--collection-loop">/);
  });
});
