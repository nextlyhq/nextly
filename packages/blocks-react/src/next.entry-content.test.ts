/**
 * A routed template drawing the entry's own blocks content: its metadata and
 * its list's later pages are asked of the page as it is drawn, with the
 * entry's content composed in, as its render is. A route asking them of the
 * template as stored would describe a page with no heading and serve no later
 * page of a list the entry's content splits into pages.
 *
 * Driven through the real route, with only the Direct API below it faked.
 * Each case is paired with the same entry holding no content, the control a
 * route reading the stored template alone would also pass.
 */
import {
  defineNamedQuery,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type NamedQueryRunArgs,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import type { NamedQueryLookup } from "./context";
import { createBlocksPage, type DerivedPageSeo } from "./next";
import type { PageRendererProps } from "./page-renderer";
import { createBlockResolver } from "./resolver";

/** What Next.js's `notFound()` throws, for the App Router to answer 404. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

/** The template: nothing of its own but the entry's Body. */
const template: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "template",
  nodes: [
    {
      id: "ec",
      type: "core/entry-content",
      version: 1,
      props: { field: "body" },
    },
  ],
};

function bodyOf(...nodes: BlockDocument["nodes"]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** A Direct API holding one row at `post`, with the fields given. */
function instance(row: Record<string, unknown>) {
  return {
    find: vi.fn(
      async (args: {
        collection: string;
        where?: { slug?: { equals?: unknown } };
      }) => {
        const found =
          args.collection === "posts" && args.where?.slug?.equals === "post";
        return {
          items: found ? [{ id: "p1", slug: "post", ...row }] : [],
          meta: { total: found ? 1 : 0 },
        };
      }
    ),
    findByID: vi.fn(async () => null),
    findSingle: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

describe("a template's metadata, from the entry's content it draws", () => {
  async function derivedFor(
    row: Record<string, unknown>
  ): Promise<DerivedPageSeo | undefined> {
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["posts"],
      field: "content",
      nextly: instance(row) as never,
      blocks: createBlockResolver(coreBlocks),
      metadata: (_entry, _ctx, derived) => {
        seen = derived;
        return {};
      },
    });
    await route.generateMetadata({ params: { slug: ["post"] } });
    return seen;
  }

  it("is titled and described by the entry's own heading and text", async () => {
    const seen = await derivedFor({
      content: template,
      body: bodyOf(
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: { text: "Writing alt text that helps", level: "h1" },
        },
        {
          id: "t",
          type: "core/text",
          version: 1,
          props: { text: "Describe what the picture says." },
        }
      ),
    });
    expect(seen).toMatchObject({
      title: "Writing alt text that helps",
      description: "Describe what the picture says.",
    });
  });

  it("has neither where the entry holds no content (the control)", async () => {
    const seen = await derivedFor({ content: template });
    expect(seen?.title).toBeUndefined();
    expect(seen?.description).toBeUndefined();
  });
});

describe("a list split into pages inside the entry's content", () => {
  /** A named query over 25 rows, with their total. */
  function query(): {
    lookup: NamedQueryLookup;
    windows: NamedQueryRunArgs["window"][];
  } {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `p${String(index + 1)}`,
    }));
    const windows: NamedQueryRunArgs["window"][] = [];
    const definition = defineNamedQuery({
      name: "posts.counted",
      label: "Counted posts",
      reads: { collections: ["posts"] },
      rows: { key: "id", fields: [{ name: "id", type: "text" }] },
      total: true,
      run: ({ window }) => {
        windows.push(window);
        return Promise.resolve({
          rows: rows.slice(window.offset, window.offset + window.limit),
          total: rows.length,
        });
      },
    });
    return {
      lookup: {
        definitionOf: name =>
          name === definition.name ? definition : undefined,
      },
      windows,
    };
  }

  /** The entry's Body: one list of the query, ten a page. */
  const paged = bodyOf({
    id: "list",
    type: "core/collection-loop",
    version: 1,
    props: {
      namedQuery: { name: "posts.counted", params: {} },
      limit: 10,
      paginate: true,
    },
    slots: { children: [], empty: [] },
  });

  async function served(row: Record<string, unknown>, slug: string[]) {
    const route = createBlocksPage({
      collections: ["posts"],
      field: "content",
      // The route presents only blocks it can resolve, and the entry's list
      // is what it counts.
      blocks: createBlockResolver(coreBlocks),
      // Today is read in the site's zone; none is readable in this process.
      timeZone: "Asia/Karachi",
      namedQueries: query().lookup,
      nextly: instance(row) as never,
    });
    const element = await throughBoundary<PageRendererProps>(
      route.ContentPage({ params: { slug } })
    );
    return element.props.context?.listPage;
  }

  it("counts its pages, and serves a later one", async () => {
    const listPage = await served({ content: template, body: paged }, [
      "post",
      "page",
      "2",
    ]);
    // The list as drawn inside the template, by its composed id.
    expect(listPage).toMatchObject({ page: 2, pages: 3 });
  });

  it("serves no later page where the entry holds no such list (the control)", async () => {
    await expect(
      served({ content: template }, ["post", "page", "2"])
    ).rejects.toMatchObject(NOT_FOUND);
  });
});
