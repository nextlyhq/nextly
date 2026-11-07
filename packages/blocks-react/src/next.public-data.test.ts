/**
 * What a routed page's lists read through: the route's public reader, bound
 * per render, and a provider built from it, the default one when the route
 * names none.
 *
 * Driven through the real route and the real reader, with only the Direct API
 * below them faked, so what is asserted is what reaches the database layer.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type {
  BlockDocument,
  NamedQueryDeclaration,
} from "@nextlyhq/blocks-engine";
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
  type NamedQueryHost,
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

describe("a routed page's named queries", () => {
  /** A declaration reading `count` collections. */
  function declaration(count = 1): NamedQueryDeclaration {
    return {
      name: "events.upcoming",
      label: "Upcoming events",
      reads: {
        collections: Array.from({ length: count }, (_, i) => `c${String(i)}`),
      },
      rows: { collection: "c0" },
    };
  }

  /** The named-query host the route built for one render. */
  async function hostOf(
    nextly: ReturnType<typeof instance>
  ): Promise<NamedQueryHost> {
    const context = await renderContext(
      { collections: ["pages"], field: "content", revalidate: 60 },
      nextly
    );
    if (context.namedQueries === undefined) {
      throw new Error("the page has no named-query host");
    }
    return context.namedQueries;
  }

  /** The run as a list stores it, which a published page's cache ignores. */
  const ASKED = { params: {}, window: { limit: 1, offset: 0 } } as const;

  /** The key parts a kept result was cached under, for one deployment. */
  async function keyPartsIn(deployment: string): Promise<unknown> {
    vi.stubEnv("NEXT_DEPLOYMENT_ID", deployment);
    try {
      const host = await hostOf(instance());
      cached.calls.length = 0;
      await host.cache?.({
        declaration: declaration(),
        key: ["events.upcoming", "same-run-source"],
        read: () => Promise.resolve({ rows: [], reads: 0 }),
        asked: ASKED,
      });
      return (cached.calls[0] as { keyParts?: unknown } | undefined)?.keyParts;
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it("keeps a result per deployment, whatever the run's source", async () => {
    const first = await keyPartsIn("dep-1");
    const second = await keyPartsIn("dep-2");
    expect(first).toContain("deployment:dep-1");
    expect(second).toContain("deployment:dep-2");
    expect(first).not.toEqual(second);
  });

  it("keeps no result whose declared reads the cache could not all tag", async () => {
    const host = await hostOf(instance());
    const read = vi.fn(() => Promise.resolve({ rows: [], reads: 0 }));
    cached.calls.length = 0;
    await host.cache?.({
      declaration: declaration(129),
      key: ["k"],
      read,
      asked: ASKED,
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(cached.calls).toEqual([]);
    // Within the bound, every declared read tags it.
    await host.cache?.({
      declaration: declaration(3),
      key: ["k"],
      read,
      asked: ASKED,
    });
    expect((cached.calls[0] as { tags: string[] }).tags).toHaveLength(3);
  });

  it("resolves a query from the queries the route was handed, and from no other", async () => {
    const definition = {
      ...declaration(),
      run: () => Promise.resolve({ rows: [] }),
    };
    const handed = await renderContext(
      {
        collections: ["pages"],
        field: "content",
        namedQueries: {
          definitionOf: name =>
            name === "events.upcoming" ? definition : undefined,
        },
      },
      instance()
    );
    expect(handed.namedQueries?.definitionOf("events.upcoming")).toBe(
      definition
    );
    // A route handed none knows of none, whatever another site registered.
    expect(
      (await hostOf(instance())).definitionOf("events.upcoming")
    ).toBeUndefined();
  });

  it("refuses the render's day when the site's time zone cannot be read, rather than use UTC", async () => {
    // No zone on the route, and no site settings this process can read.
    await expect((await hostOf(instance())).today()).rejects.toThrow(
      /time zone/
    );
    const zoned = await renderContext(
      {
        collections: ["pages"],
        field: "content",
        timeZone: "Asia/Karachi",
      },
      instance()
    );
    await expect(zoned.namedQueries?.today()).resolves.toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });
});
