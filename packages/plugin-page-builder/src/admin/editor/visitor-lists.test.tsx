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

describe("what the canvas's reads are asked for a page's conditions", () => {
  /** A component whose list's entry block orders a value. */
  const DATED: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      {
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
      },
    ],
  };
  const placing: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "dated",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "dated" },
      },
    ],
  };
  const plainPage: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [{ id: "h", type: "core/text", version: 1, props: { text: "Hi" } }],
  };

  it("asks for the site's zone for a dated list inside a component a Layout region places", () => {
    const definitions = new Map([["dated", DATED]]);
    // CONTROL: read as stored, the region holds only the placement.
    expect(
      canvasConditionsFor(plainPage, [{ document: placing }], {
        definitions: new Map(),
      })
    ).toBeUndefined();
    // The page composes nothing; the region does.
    const demand = canvasConditionsFor(
      plainPage,
      [{ document: placing, definitions }],
      { definitions: new Map() }
    );
    expect(demand?.ordersValues).toBe(true);
  });
});
