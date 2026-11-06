/**
 * What the Pages panel's writes decide: which bodies and addresses they take,
 * which collections they write at all, what a new page holds, how its slug is
 * made unique, and that a refusal is core's, passed on.
 *
 * The writes are injected, so each assertion is about the decision. That the
 * routes bind them to the Direct API as the caller is
 * `pages-write-route.binding.test.ts`; that they mean that on a real database
 * is the integration suite.
 *
 * @module pages-write-route.test
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { PageCollection } from "./pages-search-route";
import { PAGE_TITLE_MAX } from "./pages-write-contract";
import {
  createPage,
  deletePage,
  duplicatePage,
  parsePageParams,
  readCreateBody,
  readRenameBody,
  renamePage,
  slugBaseOf,
  type PagesWrites,
} from "./pages-write-route";

/** The plugin's own page collection, as the shared selection reads it. */
const PAGES: PageCollection = {
  slug: "pages",
  label: "Page",
  field: "content",
  title: { name: "title", kind: "text" },
  lifecycle: true,
  slugField: { name: "slug", unique: true },
};

/** A page list read answering `items`. */
const page = (items: unknown[]) => ({
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

/** Writes over one page collection, each write echoing what it was given. */
function writesOver(
  sources: PageCollection[] = [PAGES],
  over: Partial<PagesWrites> = {}
) {
  const writes = {
    collection: vi.fn(async (slug: string) =>
      sources.find(source => source.slug === slug)
    ),
    find: vi.fn(async () => page([])),
    create: vi.fn(async (_c: string, data: Record<string, unknown>) => ({
      id: "new",
      ...data,
    })),
    duplicate: vi.fn(
      async (_c: string, _id: string, overrides: Record<string, unknown>) => ({
        id: "copy",
        ...overrides,
      })
    ),
    update: vi.fn(
      async (_c: string, id: string, data: Record<string, unknown>) => ({
        id,
        status: "published",
        ...data,
      })
    ),
    remove: vi.fn(async () => undefined),
    ...over,
  };
  return writes;
}

/** The validation error `run` throws, or a failure naming what was thrown instead. */
async function refused(run: () => Promise<unknown>): Promise<NextlyError> {
  try {
    await run();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

const json = (body: unknown) =>
  new Request("http://nextly.test/x", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("bodies and addresses, parsed at the boundary", () => {
  it("reads a create body, trimming its title", async () => {
    // The positive control for the refusals below.
    expect(
      await readCreateBody(json({ collection: "pages", title: "  About " }))
    ).toEqual({ collection: "pages", title: "About" });
  });

  it("refuses a title that is empty, too long, or not text, without echoing it", async () => {
    const long = "t".repeat(PAGE_TITLE_MAX + 1);
    for (const title of ["   ", long, 7]) {
      const error = await refused(() =>
        readCreateBody(json({ collection: "pages", title }))
      );
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(error.publicData)).toContain('"title"');
      expect(JSON.stringify(error.publicData)).not.toContain(long);
    }
    expect(
      (await readRenameBody(json({ title: "t".repeat(PAGE_TITLE_MAX) }))).title
    ).toHaveLength(PAGE_TITLE_MAX);
  });

  it("reads the version a rename was made from", async () => {
    expect(await readRenameBody(json({ title: "A", rev: "6" }))).toEqual({
      title: "A",
      rev: "6",
    });
  });

  it("refuses a rename that carries anything but the title and its version", async () => {
    const error = await refused(() =>
      readRenameBody(json({ title: "A", slug: "a" }))
    );
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses a body that is not JSON", async () => {
    const error = await refused(() => readCreateBody(json("{not json")));
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("reads a page address, and refuses one that names nothing, without echoing it", () => {
    expect(parsePageParams({ collection: "pages", id: "p1" })).toEqual({
      collection: "pages",
      id: "p1",
    });
    const long = "i".repeat(500);
    for (const params of [
      undefined,
      { collection: "pages" },
      { collection: " ", id: "p1" },
      { collection: "pages", id: long },
    ]) {
      let error: unknown;
      try {
        parsePageParams(params);
      } catch (caught) {
        error = caught;
      }
      expect(NextlyError.isValidation(error)).toBe(true);
      expect(JSON.stringify((error as NextlyError).publicData)).not.toContain(
        long
      );
    }
  });
});

describe("a collection that does not hold pages", () => {
  it("is refused by every write, with the one generic refusal, before anything is written", async () => {
    const writes = writesOver();
    const notPages = { collection: "notes", id: "n1" };
    const errors = [
      await refused(() =>
        createPage({ collection: "notes", title: "A" }, writes)
      ),
      await refused(() => duplicatePage(notPages, writes)),
      await refused(() => renamePage(notPages, "A", writes)),
      await refused(() => deletePage(notPages, writes)),
    ];

    for (const error of errors) {
      expect(error.code).toBe("FORBIDDEN");
      // Nothing about the collection travels.
      expect(
        JSON.stringify([error.publicMessage, error.publicData ?? null])
      ).not.toContain("notes");
    }
    expect(writes.find).not.toHaveBeenCalled();
    expect(writes.create).not.toHaveBeenCalled();
    expect(writes.duplicate).not.toHaveBeenCalled();
    expect(writes.update).not.toHaveBeenCalled();
    expect(writes.remove).not.toHaveBeenCalled();
  });
});

describe("creating a page", () => {
  it("creates a draft with its title, a slug from it and the field's empty document, and answers it as the search lists it", async () => {
    const writes = writesOver();

    const item = await createPage(
      { collection: "pages", title: "About Us" },
      writes
    );

    expect(writes.create).toHaveBeenCalledWith("pages", {
      title: "About Us",
      slug: "about-us",
      status: "draft",
      content: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [],
      },
    });
    expect(item).toEqual({
      id: "new",
      collection: "pages",
      collectionLabel: "Page",
      field: "content",
      title: "About Us",
      status: "draft",
    });
  });

  it("stores the empty document at a field's form path, of a kind the field accepts", async () => {
    const landing: PageCollection = {
      slug: "landing",
      label: "Landing",
      field: "hero.body",
      title: { name: "title", kind: "text" },
      lifecycle: false,
      kinds: ["template", "page"],
    };
    const writes = writesOver([landing]);

    await createPage({ collection: "landing", title: "Launch" }, writes);

    // No slug field, no lifecycle: neither is written.
    expect(writes.create).toHaveBeenCalledWith("landing", {
      title: "Launch",
      hero: {
        body: {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "page",
          nodes: [],
        },
      },
    });
  });

  it("takes the first slug no page holds, checking only the candidates, as one read", async () => {
    const writes = writesOver([PAGES], {
      find: vi.fn(async () =>
        page([
          { id: "1", slug: "about" },
          { id: "2", slug: "about-2" },
        ])
      ),
    });

    await createPage({ collection: "pages", title: "About" }, writes);

    expect(writes.find).toHaveBeenCalledTimes(1);
    const [args] = writes.find.mock.calls[0] as unknown as [
      { where: { slug: { in: string[] } }; select: unknown; limit: number },
    ];
    expect(args.where.slug.in.slice(0, 3)).toEqual([
      "about",
      "about-2",
      "about-3",
    ]);
    expect(args.select).toEqual({ id: true, slug: true });
    expect(args.limit).toBe(args.where.slug.in.length);
    expect(writes.create.mock.calls[0]?.[1]).toMatchObject({ slug: "about-3" });
  });

  it("moves to the next free slug when core refuses one as taken, a bounded number of times", async () => {
    const create = vi.fn(async () => {
      throw NextlyError.duplicate();
    });
    const writes = writesOver([PAGES], { create });

    const error = await refused(() =>
      createPage({ collection: "pages", title: "About" }, writes)
    );

    expect(
      create.mock.calls.map(call => (call[1] as { slug: string }).slug)
    ).toEqual(["about", "about-2", "about-3"]);
    expect(error.code).toBe("CONFLICT");
  });

  it("passes on any other refusal at once, writing nothing more", async () => {
    const create = vi.fn(async () => {
      throw NextlyError.forbidden();
    });
    const writes = writesOver([PAGES], { create });

    const error = await refused(() =>
      createPage({ collection: "pages", title: "About" }, writes)
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("makes a slug as core's slugify does, bounded, with a word for a title of no letters", () => {
    expect(slugBaseOf("Café & Restaurant!")).toBe("cafe-restaurant");
    expect(slugBaseOf("!!!")).toBe("page");
    const long = slugBaseOf(`${"word ".repeat(40)}`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });

  it("writes a slug that need not be unique without checking it", async () => {
    const writes = writesOver([
      { ...PAGES, slugField: { name: "slug", unique: false } },
    ]);

    await createPage({ collection: "pages", title: "About" }, writes);

    expect(writes.find).not.toHaveBeenCalled();
    expect(writes.create.mock.calls[0]?.[1]).toMatchObject({ slug: "about" });
  });
});

describe("duplicating a page", () => {
  it("duplicates through core with a Copy-of title, a fresh slug and the draft status", async () => {
    const find = vi.fn(async (args: { where?: unknown }) =>
      JSON.stringify(args.where).includes('"equals"')
        ? page([{ id: "p1", title: "About" }])
        : page([{ id: "x", slug: "copy-of-about" }])
    );
    const writes = writesOver([PAGES], { find });

    const item = await duplicatePage({ collection: "pages", id: "p1" }, writes);

    expect(writes.duplicate).toHaveBeenCalledWith("pages", "p1", {
      title: "Copy of About",
      slug: "copy-of-about-2",
      status: "draft",
    });
    expect(item).toMatchObject({
      id: "copy",
      title: "Copy of About",
      status: "draft",
    });
  });

  it("answers not found, duplicating nothing, for a page the caller cannot read", async () => {
    const writes = writesOver();

    const error = await refused(() =>
      duplicatePage({ collection: "pages", id: "gone" }, writes)
    );

    expect(error.code).toBe("NOT_FOUND");
    expect(writes.duplicate).not.toHaveBeenCalled();
  });
});

describe("renaming a page", () => {
  it("writes the title and nothing else", async () => {
    const writes = writesOver();

    const item = await renamePage(
      { collection: "pages", id: "p1" },
      "New name",
      writes
    );

    expect(writes.update).toHaveBeenCalledWith("pages", "p1", {
      title: "New name",
    });
    expect(item).toMatchObject({ id: "p1", title: "New name" });
  });

  it("sends the version of the page the rename was made from", async () => {
    // A save of the page since the author's list read it refuses the rename
    // rather than being lost under it.
    const writes = writesOver();
    await renamePage(
      { collection: "pages", id: "p1" },
      "New name",
      writes,
      "6"
    );
    expect(writes.update).toHaveBeenCalledWith("pages", "p1", {
      title: "New name",
      _rev: "6",
    });
  });

  it("refuses, writing nothing, a new page a title alone cannot make", async () => {
    // A required field with no default: only the entry's own form can fill it.
    const writes = writesOver([{ ...PAGES, needsMore: ["seoTitle"] }]);
    const error = await refused(() =>
      createPage({ collection: "pages", title: "About" }, writes)
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(error)).toContain("need more than a title");
    expect(writes.create).not.toHaveBeenCalled();
  });

  it("refuses, writing nothing, to copy a page that holds another unique value", async () => {
    // The page is there and readable: the refusal is the collection's.
    const find = vi.fn(async () => page([{ id: "p1", title: "About" }]));
    const writes = writesOver([{ ...PAGES, uncopyable: true }], { find });
    const error = await refused(() =>
      duplicatePage({ collection: "pages", id: "p1" }, writes)
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(writes.duplicate).not.toHaveBeenCalled();
  });

  it("leaves a constrained title alone: an email title takes no page title", async () => {
    // Searched as text, but "A" is no email address, and core would refuse it.
    const writes = writesOver([
      { ...PAGES, title: { name: "contact", kind: "text", type: "email" } },
    ]);

    const error = await refused(() =>
      renamePage({ collection: "pages", id: "p1" }, "A", writes)
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(writes.update).not.toHaveBeenCalled();

    await createPage({ collection: "pages", title: "About" }, writes);
    expect(writes.create.mock.calls[0]?.[1]).not.toHaveProperty("contact");
  });

  it("writes a free-text title of either kind", async () => {
    const writes = writesOver([
      { ...PAGES, title: { name: "title", kind: "text", type: "textarea" } },
    ]);
    await renamePage({ collection: "pages", id: "p1" }, "New name", writes);
    expect(writes.update).toHaveBeenCalledWith("pages", "p1", {
      title: "New name",
    });
  });

  it("is refused for a collection whose pages have no text title", async () => {
    const writes = writesOver([
      { ...PAGES, title: { name: "n", kind: "number" } },
    ]);

    const error = await refused(() =>
      renamePage({ collection: "pages", id: "p1" }, "A", writes)
    );

    expect(error.code).toBe("VALIDATION_ERROR");
    expect(writes.update).not.toHaveBeenCalled();
  });
});

describe("deleting a page", () => {
  it("deletes it, and answers which page it was", async () => {
    const writes = writesOver();

    expect(await deletePage({ collection: "pages", id: "p1" }, writes)).toEqual(
      {
        collection: "pages",
        id: "p1",
      }
    );
    expect(writes.remove).toHaveBeenCalledWith("pages", "p1");
  });

  it("passes core's refusal on, as core gave it", async () => {
    const refusal = NextlyError.forbidden();
    const writes = writesOver([PAGES], {
      remove: vi.fn(async () => {
        throw refusal;
      }),
    });

    await expect(
      deletePage({ collection: "pages", id: "p1" }, writes)
    ).rejects.toBe(refusal);
  });
});
