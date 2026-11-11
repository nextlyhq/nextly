/**
 * Which pages are listed, decided from each page's answer: a page is listed at
 * its canonical as the answer gives it, a page whose answer has no canonical
 * although its type declares an address has lost that address and is a
 * problem, and a page that is hidden or names another canonical is neither.
 *
 * The answer and core's address answers are stood in for; the record is a
 * list of rows.
 */
import type { PluginContext, PublicAddressType } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { SeoAnswer } from "../../resolver/order";
import { listPages } from "../listing";

const answers = new Map<string, SeoAnswer>();

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: async (
    _type: PublicAddressType,
    entry?: Readonly<Record<string, unknown>>
  ) =>
    entry === undefined
      ? { status: "unavailable" }
      : { status: "resolved", path: `/${String(entry.slug)}` },
}));

vi.mock("../../resolver/provider", () => ({
  resolveSeo: async (
    _ctx: unknown,
    input: { source: { entry: { id: string } } }
  ) => answers.get(input.source.entry.id),
}));

const SITE = "https://acme.example";
const listed: SeoAnswer["robots"] = {
  value: { index: true, follow: true },
  from: "site",
};

interface Row {
  kind: string;
  locale: string;
  path: string;
  holderCollection: string;
  holderId: string;
}

/** Whether `row` meets one condition of a record read. */
function meets(row: Row, condition: Record<string, unknown>): boolean {
  return Object.entries(condition).every(([field, test]) => {
    const value = row[field as keyof Row];
    const { equals, in: within } = test as { equals?: string; in?: string[] };
    if (equals !== undefined) return value === equals;
    return within?.includes(value) ?? true;
  });
}

/** A plugin context over one collection of `documents` and a record of `rows`. */
function context(documents: Record<string, unknown>[], rows: Row[]) {
  return {
    self: { collections: {} },
    config: {},
    publicAddresses: {
      types: async () => [{ kind: "collection", slug: "pages" }],
    },
    services: {
      collections: {
        getCollection: async () => ({ status: true }),
        listEntries: async () => ({
          data: documents,
          pagination: { hasMore: false },
        }),
      },
      ownCollections: {
        listEntries: async (
          _slug: string,
          query: { where: { and: Record<string, unknown>[] } }
        ) => ({
          data: rows.filter(row =>
            query.where.and.every(condition => meets(row, condition))
          ),
        }),
      },
    },
  } as unknown as PluginContext;
}

const holds = (id: string, path: string): Row => ({
  kind: "address",
  locale: "en",
  path,
  holderCollection: "pages",
  holderId: id,
});

describe("the pages the site lists", () => {
  it("lists a page at its canonical as its answer gives it", async () => {
    answers.set("1", {
      robots: listed,
      canonical: { value: "https://de.acme.example/ueber", from: "address" },
    });
    const { pages, problems } = await listPages(
      context([{ id: "1", slug: "ueber" }], [holds("1", "/ueber")]),
      { origin: SITE }
    );
    expect(pages.map(page => page.loc)).toEqual([
      "https://de.acme.example/ueber",
    ]);
    expect(problems).toEqual([]);
  });

  it("leaves out a page whose answer has no canonical, and lists it as a problem naming the page holding its address", async () => {
    answers.set("1", { robots: listed });
    answers.set("2", {
      robots: listed,
      canonical: { value: "/about", from: "address" },
    });
    const { pages, problems } = await listPages(
      context(
        [
          { id: "1", slug: "about" },
          { id: "2", slug: "about" },
        ],
        [holds("2", "/about")]
      ),
      { origin: SITE }
    );
    expect(pages.map(page => page.loc)).toEqual([`${SITE}/about`]);
    expect(problems).toEqual([
      {
        kind: "held-by-another",
        holder: { collection: "pages", id: "1" },
        path: "/about",
        heldBy: { collection: "pages", id: "2" },
      },
    ]);
  });

  it("lists a page with no canonical whose address no page holds as not recorded", async () => {
    answers.set("1", { robots: listed });
    const { pages, problems } = await listPages(
      context([{ id: "1", slug: "about" }], []),
      { origin: SITE }
    );
    expect(pages).toEqual([]);
    expect(problems).toEqual([
      {
        kind: "not-recorded",
        holder: { collection: "pages", id: "1" },
        path: "/about",
      },
    ]);
  });

  it("lists neither a hidden page nor one whose canonical names another page", async () => {
    answers.set("1", {
      robots: { value: { index: false, follow: true }, from: "page" },
    });
    answers.set("2", {
      robots: listed,
      canonical: { value: "/about", from: "page" },
    });
    const { pages, problems } = await listPages(
      context(
        [
          { id: "1", slug: "hidden" },
          { id: "2", slug: "copy" },
        ],
        [holds("1", "/hidden"), holds("2", "/copy")]
      ),
      { origin: SITE }
    );
    expect(pages).toEqual([]);
    expect(problems).toEqual([]);
  });
});
