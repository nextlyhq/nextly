/**
 * What the New page dialog's create and read decide: the body keys it adds,
 * the address rule the dialog shares with the route, a typed address refused
 * when taken and a made one moved on, the header & footer choice, a starter,
 * extra fields, whether the author may change what they made, and what the
 * read tells the dialog before anything is created.
 *
 * The writes are injected, as in `pages-write-route.test.ts`; what they mean
 * on a real database is `new-page.integration.test.ts`.
 *
 * @module __tests__/new-page-route.test
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { slugify } from "nextly";
import { describe, expect, it, vi } from "vitest";

import type { PageCollection } from "../pages-search-route";
import {
  pageSlugOfTitle,
  pageSlugOfTyped,
  PAGE_SLUG_MAX,
} from "../pages-write-contract";
import {
  createPage,
  parseNewPageQuery,
  readCreateBody,
  readNewPageFacts,
  slugBaseOf,
  typedSlugOf,
  type NewPageReads,
} from "../pages-write-route";

/** The plugin's own page collection, as the shared selection reads it. */
const PAGES: PageCollection = {
  slug: "pages",
  label: "Page",
  field: "content",
  title: { name: "title", kind: "text" },
  lifecycle: true,
  slugField: { name: "slug", unique: true },
};

/** A second collection whose pages open in the builder, with no lifecycle. */
const LANDING: PageCollection = {
  slug: "landing",
  label: "Landing page",
  field: "body",
  title: { name: "title", kind: "text" },
  lifecycle: false,
  slugField: { name: "slug", unique: true },
};

/** A page list read answering `items`. */
const listed = (items: unknown[]) => ({
  items,
  meta: {
    total: items.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
});

/** A find answering, of the slugs it asks for, those `held` names. */
function holding(held: Record<string, string>) {
  return vi.fn(async (args: { where: Record<string, unknown> }) => {
    const filter = args.where.slug as { in?: string[]; equals?: string };
    const asked =
      filter.in ?? (filter.equals === undefined ? [] : [filter.equals]);
    return listed(
      asked
        .filter(slug => held[slug] !== undefined)
        .map(slug => ({ id: `id-${slug}`, slug, title: held[slug] }))
    );
  });
}

/** Writes and reads over the given collections, each write echoing its data. */
function readsOver(
  over: Record<string, unknown> = {},
  sources: PageCollection[] = [PAGES]
) {
  return {
    collection: vi.fn(async (slug: string) =>
      sources.find(source => source.slug === slug)
    ),
    find: vi.fn(async () => listed([])),
    create: vi.fn(async (_c: string, data: Record<string, unknown>) => ({
      id: "new",
      ...data,
    })),
    duplicate: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    may: vi.fn(async () => true),
    // Every collection here stores paths, as the plugin's own Pages do.
    storedSlug: (_collection: string, slug: string) => slug,
    starter: vi.fn(async () => undefined),
    pageCollections: vi.fn(async () => sources),
    pagesCollection: () => "pages",
    pagePath: () => "/{slug}",
    site: vi.fn(async () => "https://ridgeline.example/"),
    starters: vi.fn(async () => []),
    ...over,
  } as unknown as NewPageReads & {
    create: ReturnType<typeof vi.fn>;
  };
}

/** The refusal `run` throws, or a failure naming what was thrown instead. */
async function refused(run: () => Promise<unknown>): Promise<NextlyError> {
  try {
    await run();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

/** The issues a validation refusal names, as the dialog reads them. */
function issuesOf(error: NextlyError): { path: string; message: string }[] {
  const data = error.publicData as {
    errors?: { path: string; message: string }[];
  };
  return data.errors ?? [];
}

const json = (body: unknown) =>
  new Request("http://nextly.test/x", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("the address rule the dialog shares with the route", () => {
  const titles = [
    "Pricing",
    "  About   us  ",
    "Café & Restaurant",
    "Ünïcödé — dashes – and “quotes”",
    "!!!",
    "",
    "100% Off: Summer/Winter",
    "a".repeat(120),
    `${"word ".repeat(15)}tail`,
    `${"Ends with a dash at the cut-".padEnd(79, "x")}-y`,
  ];

  it("makes the same address from a title as the route, by core's slugify and the route's bounds", () => {
    for (const title of titles) {
      expect(pageSlugOfTitle(title), title).toBe(slugBaseOf(title));
    }
    // The route's rule is core's, the bound and the neutral word aside.
    expect(slugBaseOf("Café & Restaurant")).toBe(slugify("Café & Restaurant"));
  });

  it("keeps a typed address as the route stores it, `/` making a page beneath another", () => {
    const typed = [
      "Docs / Install",
      "/pricing/",
      "Pricing Plans",
      "a//b///c",
      "---",
      "x".repeat(300),
      "über/straße",
    ];
    for (const text of typed) {
      expect(pageSlugOfTyped(text), text).toBe(typedSlugOf(text));
    }
    expect(pageSlugOfTyped("Docs / Install")).toBe("docs/install");
    expect(pageSlugOfTyped("x".repeat(300)).length).toBeLessThanOrEqual(
      PAGE_SLUG_MAX
    );
  });
});

describe("the create body's added keys", () => {
  it("reads a typed address, the header & footer choice, a starter and other fields", async () => {
    expect(
      await readCreateBody(
        json({
          collection: "pages",
          title: "Pricing",
          slug: "plans",
          layout: null,
          noHeaderFooter: false,
          starter: "landing",
          fields: { category: "c1" },
        })
      )
    ).toEqual({
      collection: "pages",
      title: "Pricing",
      slug: "plans",
      layout: null,
      noHeaderFooter: false,
      starter: "landing",
      fields: { category: "c1" },
    });
  });

  it("refuses other fields named as anything but a field name, or too many of them", async () => {
    for (const fields of [
      { "a.b": 1 },
      { "": 1 },
      Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, i])),
    ]) {
      const error = await refused(() =>
        readCreateBody(json({ collection: "pages", title: "A", fields }))
      );
      expect(error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("creating from the New page dialog", () => {
  it("stores a typed address as typed, without moving it on", async () => {
    const reads = readsOver();
    const item = await createPage(
      { collection: "pages", title: "Pricing", slug: "Plans / Monthly" },
      reads
    );
    expect(reads.create).toHaveBeenCalledWith(
      "pages",
      expect.objectContaining({ slug: "plans/monthly", title: "Pricing" })
    );
    expect(item.id).toBe("new");
  });

  it("refuses a typed address another page holds, naming that page, and writes nothing", async () => {
    const reads = readsOver({ find: holding({ pricing: "Our prices" }) });
    const error = await refused(() =>
      createPage(
        { collection: "pages", title: "Pricing", slug: "pricing" },
        reads
      )
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(issuesOf(error)).toEqual([
      expect.objectContaining({
        path: "slug",
        message: "That address is used by Our prices",
      }),
    ]);
    expect(reads.create).not.toHaveBeenCalled();
  });

  it("refuses a typed address held by a page the author can't read as used by another page", async () => {
    // The author's read finds nothing; core's unique rule refuses the write.
    const create = vi.fn(async () => {
      throw NextlyError.duplicate({ logContext: { field: "slug" } });
    });
    const reads = readsOver({ create });
    const error = await refused(() =>
      createPage(
        { collection: "pages", title: "Pricing", slug: "pricing" },
        reads
      )
    );
    expect(issuesOf(error)).toEqual([
      expect.objectContaining({
        path: "slug",
        message: "That address is used by another page",
      }),
    ]);
    // Once: a typed address is never moved on to another.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("stores and checks a typed address as the collection stores it, without a `/` where it keeps none", async () => {
    // Core's rule for a collection without `db.slugPaths`: one part, no `/`.
    const storedSlug = (collection: string, slug: string) =>
      collection === "landing" ? slug.replace(/\//g, "") : slug;
    const find = holding({ docsinstall: "Docs index" });
    const error = await refused(() =>
      createPage(
        { collection: "landing", title: "Install", slug: "Docs / Install" },
        readsOver({ find, storedSlug }, [PAGES, LANDING])
      )
    );
    expect(issuesOf(error)).toEqual([
      expect.objectContaining({
        path: "slug",
        message: "That address is used by Docs index",
      }),
    ]);

    const reads = readsOver({ storedSlug }, [PAGES, LANDING]);
    await createPage(
      { collection: "landing", title: "Install", slug: "Docs / Install" },
      reads
    );
    expect(reads.create).toHaveBeenCalledWith(
      "landing",
      expect.objectContaining({ slug: "docsinstall" })
    );
  });

  it("keeps the other fields beside a Page Builder field inside a group", async () => {
    const nested: PageCollection = { ...LANDING, field: "hero.body" };
    const reads = readsOver({}, [nested]);
    await createPage(
      {
        collection: "landing",
        title: "Launch",
        fields: { hero: { eyebrow: "News" }, category: "c1" },
      },
      reads
    );
    expect(reads.create).toHaveBeenCalledWith(
      "landing",
      expect.objectContaining({
        category: "c1",
        hero: {
          eyebrow: "News",
          body: expect.objectContaining({ nodes: [] }),
        },
      })
    );
  });

  it("moves an address made from the title on to the first free one", async () => {
    const reads = readsOver({ find: holding({ pricing: "Pricing" }) });
    await createPage({ collection: "pages", title: "Pricing" }, reads);
    expect(reads.create).toHaveBeenCalledWith(
      "pages",
      expect.objectContaining({ slug: "pricing-2" })
    );
  });

  it("writes the header & footer choice as the menu writes it", async () => {
    const reads = readsOver();
    await createPage(
      {
        collection: "pages",
        title: "A",
        layout: "set-2",
        noHeaderFooter: false,
      },
      reads
    );
    expect(reads.create).toHaveBeenCalledWith(
      "pages",
      expect.objectContaining({ layout: "set-2", noHeaderFooter: false })
    );
  });

  it("writes other fields, the route's own values winning over them", async () => {
    const reads = readsOver();
    await createPage(
      {
        collection: "pages",
        title: "A",
        fields: { category: "c1", status: "published", title: "B" },
      },
      reads
    );
    expect(reads.create).toHaveBeenCalledWith(
      "pages",
      expect.objectContaining({ category: "c1", status: "draft", title: "A" })
    );
  });

  it("leaves a required field it wasn't given to core, passing on the paths core names", async () => {
    // No refusal of its own: core judges the field and names it.
    const create = vi.fn(async () => {
      throw NextlyError.validation({
        errors: [
          {
            path: "category",
            code: "REQUIRED",
            message: "Category is required",
          },
        ],
      });
    });
    const reads = readsOver({ create }, [
      { ...PAGES, needsMore: ["category"] },
    ]);
    const error = await refused(() =>
      createPage({ collection: "pages", title: "A" }, reads)
    );
    expect(issuesOf(error)).toEqual([
      expect.objectContaining({
        path: "category",
        message: "Category is required",
      }),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("starts from a starter the collection offers, and refuses one it doesn't", async () => {
    const document = { formatVersion: 1, kind: "page", nodes: [{ id: "n1" }] };
    const starter = vi.fn(async (_source: PageCollection, id: string) =>
      id === "landing" ? { document } : undefined
    );
    const reads = readsOver({ starter });
    await createPage(
      { collection: "pages", title: "A", starter: "landing" },
      reads
    );
    expect(reads.create).toHaveBeenCalledWith(
      "pages",
      expect.objectContaining({ content: document })
    );

    const offered = readsOver({ starter });
    const error = await refused(() =>
      createPage({ collection: "pages", title: "A", starter: "gone" }, offered)
    );
    expect(issuesOf(error)).toEqual([
      expect.objectContaining({ path: "starter" }),
    ]);
    expect(offered.create).not.toHaveBeenCalled();
  });

  it("answers whether the author may change the page they made", async () => {
    const may = vi.fn(async (action: string) => action !== "update");
    const item = await createPage(
      { collection: "pages", title: "A" },
      readsOver({ may })
    );
    expect(item.mayUpdate).toBe(false);
    expect(may).toHaveBeenCalledWith("update", "pages");
    expect(
      (await createPage({ collection: "pages", title: "A" }, readsOver()))
        .mayUpdate
    ).toBe(true);
  });
});

describe("what the New page read tells the dialog", () => {
  it("reads its query, a title and a typed address both optional", () => {
    expect(
      parseNewPageQuery(
        "http://x/pages/new?collection=pages&title=Pricing&slug=plans"
      )
    ).toEqual({ collection: "pages", title: "Pricing", slug: "plans" });
    expect(parseNewPageQuery("http://x/pages/new?collection=pages")).toEqual({
      collection: "pages",
    });
  });

  it("says the address made from the title, moved on where it is held, with the site's address around it", async () => {
    const facts = await readNewPageFacts(
      { collection: "pages", title: "Pricing" },
      readsOver({ find: holding({ pricing: "Pricing" }) })
    );
    expect(facts.address).toEqual({
      site: "https://ridgeline.example/",
      before: "/",
      after: "",
      slug: "pricing-2",
      wanted: "pricing",
    });
    expect(facts).toMatchObject({
      collection: { slug: "pages", label: "Page" },
      drafts: true,
      headerFooter: true,
      mayUpdate: true,
      starters: [],
    });
  });

  it("says who holds a typed address the author may read", async () => {
    const facts = await readNewPageFacts(
      { collection: "pages", title: "Pricing", slug: "pricing" },
      readsOver({ find: holding({ pricing: "Our prices" }) })
    );
    expect(facts.address).toMatchObject({
      slug: "pricing",
      takenBy: "Our prices",
    });
    expect(facts.address?.wanted).toBeUndefined();
  });

  it("says a typed address as the collection stores it, and who holds that", async () => {
    const storedSlug = (collection: string, slug: string) =>
      collection === "landing" ? slug.replace(/\//g, "") : slug;
    const facts = await readNewPageFacts(
      { collection: "landing", title: "Install", slug: "docs/install" },
      readsOver({ find: holding({ docsinstall: "Docs index" }), storedSlug }, [
        PAGES,
        LANDING,
      ])
    );
    expect(facts.address).toMatchObject({
      slug: "docsinstall",
      takenBy: "Docs index",
    });
  });

  it("shows a collection without the lifecycle or the header & footer choice as it is", async () => {
    const may = vi.fn(
      async (action: string, slug: string) =>
        !(action === "update" && slug === "landing")
    );
    const facts = await readNewPageFacts(
      { collection: "landing", title: "Spring" },
      readsOver({ may }, [PAGES, LANDING])
    );
    expect(facts).toMatchObject({
      collection: { slug: "landing", label: "Landing page" },
      drafts: false,
      headerFooter: false,
      mayUpdate: false,
    });
    // Its pages' path is the host's own code: the address alone.
    expect(facts.address).toMatchObject({
      before: "",
      after: "",
      slug: "spring",
    });
    expect(facts.collections).toEqual([
      { slug: "pages", label: "Page" },
      { slug: "landing", label: "Landing page" },
    ]);
  });

  it("lists for Type only the collections the author may make a page in", async () => {
    const may = vi.fn(
      async (action: string, slug: string) =>
        !(action === "create" && slug === "landing")
    );
    const facts = await readNewPageFacts(
      { collection: "pages" },
      readsOver({ may }, [PAGES, LANDING])
    );
    expect(facts.collections).toEqual([{ slug: "pages", label: "Page" }]);
    expect(facts.address?.slug).toBe("");
  });

  it("has no address where the collection stores none", async () => {
    const { slugField: _none, ...plain } = PAGES;
    const facts = await readNewPageFacts(
      { collection: "pages", title: "A" },
      readsOver({}, [plain])
    );
    expect(facts.address).toBeNull();
  });

  it("refuses a collection that holds no pages, as the writes do", async () => {
    const error = await refused(() =>
      readNewPageFacts({ collection: "notes" }, readsOver())
    );
    expect(error.code).toBe("FORBIDDEN");
  });
});
