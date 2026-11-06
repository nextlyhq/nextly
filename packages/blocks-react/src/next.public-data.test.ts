/**
 * What a routed page's lists read through: the route's public reader, bound
 * per render, and a provider built from it, the default one when the route
 * names none.
 *
 * Driven through the real route and the real reader, with only the Direct API
 * below them faked, so what is asserted is what reaches the database layer.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { PublicReader, PublicReadQuery } from "nextly/runtime";
import type { ReactElement } from "react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

// The real cache helper, watched, so a test can read what each list read is
// cached under. Outside a Next request it runs the read directly.
//
// The real reader, told the faked instance's declarations: no Nextly services
// are registered in this process, so the reader cannot read a schema and would
// refuse every read. The fake declares no hidden field, which is what its rows
// hold; the reader's own stripping and refusals still run.
const cached = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  return {
    ...actual,
    createPublicReader: (
      ...[source, binding]: Parameters<typeof actual.createPublicReader>
    ) =>
      actual.createPublicReader(source, {
        ...binding,
        declarations: { hiddenFields: () => [] },
      }),
    cachedFind: (
      read: () => Promise<unknown>,
      options: Parameters<typeof actual.cachedFind>[1]
    ) => {
      cached.calls.push(options);
      return actual.cachedFind(read, options);
    },
  };
});

import { throughBoundary } from "./__tests__/through-boundary";
import {
  createDefaultDataProvider,
  type BlocksPublicReader,
  type BlocksQuery,
} from "./context";
import {
  createBlocksPage,
  createPublicBlocksPage,
  createPublicSinglePage,
  createSinglePage,
} from "./next";
import type { PageRendererProps } from "./page-renderer";

const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [],
};

/** A Direct API answering the route's page, and `posts` for any list. */
function instance() {
  const find = vi.fn(async (args: { collection: string; where?: unknown }) => ({
    items:
      args.collection === "pages"
        ? [{ id: "p1", slug: "about", content: document }]
        : [{ id: "post-1", title: "Hello" }],
    meta: { total: args.collection === "pages" ? 1 : 1 },
  }));
  return {
    find,
    findByID: vi.fn(async () => null),
    findSingle: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

async function renderContext(
  config: Omit<Parameters<typeof createBlocksPage>[0], "nextly">,
  nextly: ReturnType<typeof instance>
): Promise<NonNullable<PageRendererProps["context"]>> {
  const route = createBlocksPage({
    ...config,
    nextly: nextly as never,
  });
  const element = (await throughBoundary(
    route.ContentPage({ params: { slug: ["about"] } })
  )) as ReactElement<PageRendererProps>;
  const context = element.props.context;
  if (context === undefined) throw new Error("the page has no context");
  return context;
}

/** The arguments the Direct API was given for the list read. */
function listRead(nextly: ReturnType<typeof instance>) {
  const call = nextly.find.mock.calls.find(
    ([args]) => args.collection === "posts"
  );
  if (call === undefined) throw new Error("no list read reached the instance");
  return call[0] as unknown as Record<string, unknown>;
}

describe("a routed page's lists", () => {
  it("read through the public reader by default, as an anonymous visitor in the route's language", async () => {
    const nextly = instance();
    const context = await renderContext(
      { collections: ["pages"], field: "content", locale: "fr" },
      nextly
    );
    await expect(
      context.data?.find({ collection: "posts", limit: 5, sort: [] })
    ).resolves.toEqual({ items: [{ id: "post-1", title: "Hello" }], total: 1 });
    const args = listRead(nextly);
    expect(args).toMatchObject({
      collection: "posts",
      limit: 5,
      offset: 0,
      sort: [],
      locale: "fr",
      status: "published",
      overrideAccess: false,
      unknownSort: "refuse",
    });
    expect("user" in args && args.user === undefined).toBe(true);
  });

  it("are cached under the route's scope and the whole read, tagged by collection, within the route's window", async () => {
    cached.calls.length = 0;
    const nextly = instance();
    const context = await renderContext(
      {
        collections: ["pages"],
        field: "content",
        revalidate: 60,
        cacheScope: "tenant-a",
      },
      nextly
    );
    await context.data?.find({ collection: "posts", limit: 5 });
    const options = cached.calls.at(-1) as {
      tags: string[];
      keyParts: string[];
      revalidate: number | false;
    };
    expect(options.revalidate).toBe(60);
    expect(options.tags.some(tag => tag.includes("posts"))).toBe(true);
    // The scope, the page's language (none here) and the public query: the
    // public reader's whole answer is what is cached.
    expect(options.keyParts.slice(0, 3)).toEqual([
      "nextly-public-list",
      "tenant-a",
      "",
    ]);
    expect(JSON.parse(options.keyParts[3] ?? "{}")).toMatchObject({
      collection: "posts",
      limit: 5,
    });
  });

  it("on a Single page are cached within the Single's own window", async () => {
    cached.calls.length = 0;
    const nextly = {
      ...instance(),
      findSingle: vi.fn(async () => ({ title: "Home", content: document })),
    };
    const route = createSinglePage({
      slug: "home",
      field: "content",
      revalidate: 90,
      nextly: nextly as never,
    });
    const element = (await throughBoundary(
      route.SinglePage()
    )) as ReactElement<PageRendererProps>;
    await element.props.context?.data?.find({ collection: "posts" });
    const options = cached.calls.at(-1) as { revalidate: number | false };
    expect(options.revalidate).toBe(90);
  });

  it("refuse a query that tries to widen the read, whatever the provider passes on", async () => {
    const nextly = instance();
    const context = await renderContext(
      { collections: ["pages"], field: "content" },
      nextly
    );
    await expect(
      context.data?.find({
        collection: "posts",
        status: "all",
      } as BlocksQuery)
    ).rejects.toThrow(/cannot set "status"/);
    expect(
      nextly.find.mock.calls.some(([args]) => args.collection === "posts")
    ).toBe(false);
  });

  it("read through the provider a route's factory builds from the reader", async () => {
    const nextly = instance();
    const factory = vi.fn((reader: BlocksPublicReader) =>
      createDefaultDataProvider(reader, { collections: ["events"] })
    );
    const context = await renderContext(
      { collections: ["pages"], field: "content", data: factory },
      nextly
    );
    expect(factory).toHaveBeenCalledTimes(1);
    // Outside the factory's allowlist: nothing is read.
    await expect(context.data?.find({ collection: "posts" })).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(
      nextly.find.mock.calls.some(([args]) => args.collection === "posts")
    ).toBe(false);
  });

  it("are refused a provider object when any route is built", () => {
    const provider = {
      find: async () => ({ items: [], total: 0 }),
    };
    const base = { field: "content", data: provider as never };
    for (const build of [
      () => createBlocksPage({ ...base, collections: ["pages"] }),
      () => createPublicBlocksPage({ ...base, collections: ["pages"] }),
      () => createSinglePage({ ...base, slug: "home" }),
      () => createPublicSinglePage({ ...base, slug: "home" }),
    ]) {
      expect(build).toThrow(/`data` takes a function/);
    }
  });
});

describe("the public reader's shape, written out in this package", () => {
  it("takes nextly/runtime's query and accepts its reader", () => {
    expectTypeOf<BlocksQuery>().toEqualTypeOf<PublicReadQuery>();
    // The route hands nextly's reader to a provider factory written against
    // this package's, so nextly's must be usable wherever this one is asked.
    expectTypeOf<PublicReader>().toExtend<BlocksPublicReader>();
  });
});
