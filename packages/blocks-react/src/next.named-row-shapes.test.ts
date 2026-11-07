/**
 * A routed page whose list's source is a named query with a collection's
 * entries as rows: the route reads that collection's field shapes with the
 * page's other shapes, so the list's item bindings are checked against the
 * collection's fields rather than judged by their values alone.
 *
 * Driven through the real route, with the Direct API faked and the public
 * field shapes answered for `posts` only, so the page's bindings say
 * whether the route asked for them.
 */
import {
  defineNamedQuery,
  DOCUMENT_FORMAT_VERSION,
  type BindingFieldShape,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

// The public's field shapes of `posts`, and none of anything else, recording
// each source the route asks about. Hoisted with the mock that reads them.
const shapes = vi.hoisted(() => ({
  asked: [] as unknown[],
  posts: [{ name: "title", type: "text" }] as readonly BindingFieldShape[],
}));
vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  return {
    ...actual,
    bindingFieldShapes: (ref: { collection?: string }) => {
      shapes.asked.push(ref);
      return Promise.resolve(
        ref.collection === "posts" ? shapes.posts : undefined
      );
    },
  };
});

import { throughBoundary } from "./__tests__/through-boundary";
import type { NamedQueryLookup } from "./context";
import { createBlocksPage } from "./next";
import type { PageRendererProps } from "./page-renderer";

/** The page `news`: one list of a custom source, its title bound per item. */
const news: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { namedQuery: { name: "posts.all", params: {} } },
      slots: {
        children: [
          {
            id: "title",
            type: "core/heading",
            version: 1,
            props: { text: "-", level: "h3" },
            bindings: { text: { $bind: "title", source: "item" } },
          },
        ],
        empty: [],
      },
    },
  ],
} as BlockDocument;

/** A Direct API holding the page `news` and nothing else. */
function instance() {
  return {
    find: vi.fn(
      async (args: {
        collection: string;
        where?: { slug?: { equals?: unknown } };
      }) => {
        const found =
          args.collection === "pages" && args.where?.slug?.equals === "news";
        return {
          items: found ? [{ id: "p1", slug: "news", content: news }] : [],
          meta: { total: found ? 1 : 0 },
        };
      }
    ),
    findByID: vi.fn(async () => null),
    findSingle: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

/** Every post, as the collection's own entries. */
const allPosts = defineNamedQuery({
  name: "posts.all",
  label: "All posts",
  reads: { collections: ["posts"] },
  rows: { collection: "posts" },
  run: () => Promise.resolve({ rows: [] }),
});

/** The bindings the route hands the page's renderer. */
async function pageBindings(lookup: NamedQueryLookup) {
  const route = createBlocksPage({
    collections: ["pages"],
    field: "content",
    timeZone: "Asia/Karachi",
    namedQueries: lookup,
    nextly: instance() as never,
  });
  const element = await throughBoundary<PageRendererProps>(
    route.ContentPage({ params: { slug: ["news"] } })
  );
  return element.props.bindings;
}

describe("a routed custom source whose rows are a collection's entries", () => {
  it("reads that collection's field shapes for its items' bindings", async () => {
    shapes.asked.length = 0;
    const bindings = await pageBindings({
      definitionOf: name => (name === allPosts.name ? allPosts : undefined),
    });
    expect(bindings?.fieldShapes?.fieldsOf({ collection: "posts" })).toEqual(
      shapes.posts
    );
    expect(shapes.asked).toContainEqual({ collection: "posts" });
  });

  it("reads nothing more for a query the route was not handed", async () => {
    // The control: the shapes above come from the query's declaration, not
    // from the page alone.
    shapes.asked.length = 0;
    const bindings = await pageBindings({ definitionOf: () => undefined });
    expect(bindings?.fieldShapes?.fieldsOf({ collection: "posts" })).toBe(
      undefined
    );
    expect(shapes.asked).not.toContainEqual({ collection: "posts" });
  });
});

describe("a routed custom source whose rows are a schema of their own", () => {
  /** A page whose one list's items hide by `condition`, on `events.soon`. */
  const eventsPage = (condition: Record<string, unknown>): BlockDocument =>
    // Through JSON, as stored: a condition is read from what a page holds.
    JSON.parse(
      JSON.stringify({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "list",
          type: "core/collection-loop",
          version: 1,
          props: { namedQuery: { name: "events.soon", params: {} } },
          slots: {
            children: [
              {
                id: "badge",
                type: "core/heading",
                version: 1,
                props: { text: "Soon", level: "h3" },
                visibility: { conditions: [[condition]] },
              },
            ],
            empty: [],
          },
        },
      ],
      })
    ) as BlockDocument;

  /** Events as rows of the query's own fields, one of them a date. */
  const soon = defineNamedQuery({
    name: "events.soon",
    label: "Events soon",
    reads: {},
    rows: {
      key: "id",
      fields: [
        { name: "id", type: "text" },
        { name: "startsAt", type: "date" },
      ],
    },
    run: () => Promise.resolve({ rows: [] }),
  });

  /** The zone the route renders `content` in. */
  async function zoneFor(content: BlockDocument) {
    const nextly = instance();
    nextly.find.mockImplementation(async () => ({
      items: [{ id: "p1", slug: "news", content }],
      meta: { total: 1 },
    }));
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      timeZone: "Asia/Karachi",
      namedQueries: {
        definitionOf: name => (name === soon.name ? soon : undefined),
      },
      nextly: nextly as never,
    });
    const element = await throughBoundary<PageRendererProps>(
      route.ContentPage({ params: { slug: ["news"] } })
    );
    return element.props.context?.timeZone;
  }

  it("compares its rows' dates in the route's zone", async () => {
    // The list draws no collection, so only the query's own fields say
    // its condition orders a date.
    await expect(
      zoneFor(
        eventsPage({ field: "startsAt", op: "greater_than", value: "2026-11-01" })
      )
    ).resolves.toBe("Asia/Karachi");
  });

  it("needs no zone where its conditions order no date", async () => {
    // The control: the same list, its condition matching text.
    await expect(
      zoneFor(eventsPage({ field: "id", op: "equals", value: "e1" }))
    ).resolves.toBeUndefined();
  });
});
