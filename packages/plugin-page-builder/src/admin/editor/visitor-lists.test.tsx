// @vitest-environment jsdom
/**
 * The blocks the canvas is drawn with while a list's items are judged, as
 * the renderer prepares them: the lists found there are named by the very
 * ids the renderer's lists report what they drew under, a list inside a
 * placed component among them, so a visitor-read list's tag finds its count.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  createStandaloneContext,
  PageRenderer,
  prepareDocumentAsDrawn,
  registeredBlocks,
} from "@nextlyhq/blocks-react";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The admin surface as it is, but for whose document the editor holds.
vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDocumentIdentity: () => null,
}));

const { drawnListsOf } = await import("./canvas-page-context");
const { canvasConditionsFor, drawnNodesOf } = await import("./visitor-lists");

/** A component holding a list of posts. */
const PROMO: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "promo-list",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts", limit: 10 },
      slots: {
        children: [
          { id: "t", type: "core/text", version: 1, props: { text: "Post" } },
        ],
      },
    },
  ],
};

/** A page placing the component twice, and a list of its own. */
const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "first",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "promo" },
    },
    {
      id: "second",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "promo" },
    },
    {
      id: "own-list",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts", limit: 10 },
      slots: { children: [] },
    },
  ],
};

const DEFINITIONS = new Map([["promo", PROMO]]);

describe("the lists the canvas finds in what it draws", () => {
  it("are named by the ids the renderer's lists report, a placed component's among them", async () => {
    const reported: string[] = [];
    const stream = await renderToReadableStream(
      createElement(PageRenderer, {
        document: PAGE,
        blocks: registeredBlocks(),
        definitions: DEFINITIONS,
        siteStyles: false,
        context: createStandaloneContext({
          data: {
            find: () => Promise.resolve({ items: [{ id: "a" }], total: 1 }),
          },
          diagnostics: true,
          listShown: id => {
            reported.push(id);
          },
        }),
      })
    );
    await stream.allReady;
    await new Response(stream).text();
    const found = drawnListsOf(drawnNodesOf(PAGE, {}, DEFINITIONS)).map(
      list => list.id
    );
    // CONTROL: the stored page names only its own list.
    expect(drawnListsOf(PAGE.nodes).map(list => list.id)).toEqual(["own-list"]);
    // Two placements, two lists, each by the id it is drawn under.
    expect(found).toHaveLength(3);
    expect(new Set(found)).toEqual(new Set(reported));
  });
});

describe("a list beneath a component's conditioned block", () => {
  it("is found, as the canvas draws the component with its conditions lifted", () => {
    const gated: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "members-only",
          type: "core/box",
          version: 1,
          props: {},
          visibility: {
            conditions: [
              [{ field: "title", op: "contains", value: "Members" }],
            ],
          },
          slots: {
            children: [PROMO.nodes[0] as BlockDocument["nodes"][number]],
          },
        },
      ],
    };
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "placed",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "gated" },
        },
      ],
    };
    const definitions = new Map([["gated", gated]]);
    // CONTROL: prepared from the stored definitions, the condition holds the
    // list back, as no canvas draws it.
    const stored = prepareDocumentAsDrawn(page, {
      resolver: registeredBlocks(),
      definitions,
      itemsDecided: true,
    });
    expect(drawnListsOf(stored?.nodes ?? [])).toHaveLength(0);
    expect(drawnListsOf(drawnNodesOf(page, {}, definitions))).toHaveLength(1);
  });
});

describe("what the canvas's reads are asked for a page's conditions", () => {
  /** A list whose entry block orders a date. */
  const datedList = {
    id: "dated-list",
    type: "core/collection-loop",
    version: 1,
    props: { collection: "posts", limit: 10 },
    slots: {
      children: [
        {
          id: "soon",
          type: "core/text",
          version: 1,
          props: { text: "Soon" },
          visibility: {
            conditions: [
              [
                {
                  field: "publishedAt",
                  op: "greater_than",
                  value: "2026-03-02",
                },
              ],
            ],
          },
        },
      ],
    },
  };
  const page = (nodes: unknown[]): BlockDocument =>
    ({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes,
    }) as BlockDocument;
  const plain = page([
    { id: "h", type: "core/text", version: 1, props: { text: "Hi" } },
  ]);

  it("asks for the site's zone for a dated list a Layout region draws", () => {
    // CONTROL: a page and region with no condition ask nothing.
    expect(
      canvasConditionsFor(plain, [{ document: plain }], undefined)
    ).toBeUndefined();
    expect(
      canvasConditionsFor(plain, [{ document: page([datedList]) }], undefined)
        ?.ordersValues
    ).toBe(true);
  });

  it("asks for the zone for a dated condition inside a component the page places, which the canvas judges", () => {
    const placing = page([
      {
        id: "dated",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "dated" },
      },
    ]);
    const dated: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [datedList],
    } as BlockDocument;
    // CONTROL: without the component's definition, the page asks nothing.
    expect(
      canvasConditionsFor(placing, [{ document: plain }], undefined)
    ).toBeUndefined();
    expect(
      canvasConditionsFor(
        placing,
        [{ document: plain }],
        new Map([["dated", dated]])
      )?.ordersValues
    ).toBe(true);
    // Read as the renderer reads the definition: a block it drops, one with
    // no type, asks for nothing, whatever its stored conditions order.
    const malformed = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "no-type",
          version: 1,
          props: {},
          visibility: (datedList.slots.children[0] as { visibility: unknown })
            .visibility,
        },
      ],
    } as unknown as BlockDocument;
    expect(
      canvasConditionsFor(
        placing,
        [{ document: plain }],
        new Map([["dated", malformed]])
      )?.ordersValues
    ).not.toBe(true);
    // Read under the canvas's own limits: a cap the page passes reads no
    // component, as the canvas would compose none.
    expect(
      canvasConditionsFor(
        placing,
        [{ document: plain }],
        new Map([["dated", dated]]),
        { maxDepth: 64, maxNodes: 1, maxBytes: 1_000_000 }
      )
    ).toBeUndefined();
  });
});
