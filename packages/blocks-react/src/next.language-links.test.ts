/**
 * A link a Page Builder block draws to another entry is formed in the
 * request's language: the target's slug is read in that language, and the
 * path is the address the route serves it at in that language, by the same
 * rule the route forms its own addresses with. A route the site mounts for
 * one language serves its paths as they are, so its links are left so too.
 *
 * Driven through the render `createBlocksPage` hands the content route,
 * called as the route calls it with the language it read the request in,
 * over a fake reader whose slugs differ by language. The runtime's served
 * address is answered as a site whose rule prefixes every language, so the
 * address is told apart without a booted site.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { ContentRouteConfig } from "nextly/runtime";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handed: ContentRouteConfig<ReactElement>[] = [];

vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  return {
    ...actual,
    createContentRoute: (config: ContentRouteConfig<ReactElement>) => {
      handed.push(config);
      return actual.createContentRoute(config);
    },
    readPublicSiteSettings: async () => {
      throw new Error("no site settings");
    },
    servedAddress: async (...args: Parameters<typeof actual.servedAddress>) => {
      const [path, language] = args;
      if (!language.fromSegment) return path;
      return `/${String(language.locale)}${path === "/" ? "" : path}`;
    },
  };
});

const { createBlocksPage } = await import("./next");
type PageRendererProps = import("./page-renderer").PageRendererProps;

const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [],
};

/** The slug each row holds in each language; English where none is given. */
const ROWS: Record<string, { en: string; de?: string; fr?: string }> = {
  p1: { en: "about", de: "ueber", fr: "a-propos" },
  c1: { en: "contact", de: "kontakt", fr: "contact-fr" },
};

/** A reader over `pages` whose slugs are read per language. */
function reader() {
  const slugIn = (id: string, locale: unknown) => {
    const row = ROWS[id];
    if (row === undefined) return undefined;
    return (
      (locale === "de" ? row.de : locale === "fr" ? row.fr : undefined) ??
      row.en
    );
  };
  return {
    find: vi.fn(
      async ({
        where,
        locale,
      }: {
        where?: Record<string, Record<string, unknown>>;
        locale?: string;
      }) => {
        const rows = Object.keys(ROWS).map(id => ({
          id,
          slug: slugIn(id, locale),
          content: document,
        }));
        const items = rows.filter(row =>
          Object.entries(where ?? {}).every(([field, test]) => {
            const value = (row as Record<string, unknown>)[field];
            if ("equals" in test) return value === test.equals;
            if ("less_than" in test) {
              return String(value) < String(test.less_than);
            }
            return false;
          })
        );
        return { items, meta: { total: items.length, hasNext: false } };
      }
    ),
    findByID: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

/** The page `p1` drawn as the route draws it in `locale`. */
async function drawn(locale: string | undefined) {
  const config = handed.at(-1);
  const element = (await config!.render(
    { id: "p1", slug: "about", content: document },
    {
      collection: "pages",
      slug: "about",
      ...(locale === undefined ? {} : { locale }),
    }
  )) as ReactElement<PageRendererProps>;
  return element.props;
}

beforeEach(() => {
  handed.length = 0;
});

/**
 * A link to `c1` from a page of a route given `options`, drawn in `locale`,
 * and the reads made to settle it.
 */
async function linksOn(options: { locale?: string }, locale: string) {
  const nextly = reader();
  createBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: nextly as never,
    ...options,
  });
  const element = { props: await drawn(locale) };
  const link = await element.props.context?.resolveEntryPath("pages", "c1");
  const linkReads = nextly.find.mock.calls
    .map(([args]) => args)
    .filter(args => JSON.stringify(args.where ?? {}).includes("c1"));
  return { link, linkReads };
}

describe("a Page Builder block's link to another entry", () => {
  it("is read and formed in the language a [locale] segment names", async () => {
    const { link, linkReads } = await linksOn({}, "de");
    expect(link).toBe("/de/kontakt");
    expect(linkReads.length).toBeGreaterThan(0);
    expect(linkReads.every(args => args.locale === "de")).toBe(true);
  });

  it("is read in the route's own language and left as the route serves it, where the site mounts the route for one language", async () => {
    const { link, linkReads } = await linksOn({ locale: "fr" }, "fr");
    expect(link).toBe("/contact-fr");
    expect(linkReads.every(args => args.locale === "fr")).toBe(true);
  });

  it("is handed the request's language when the site resolves links itself", async () => {
    const asked: [string, string, string | undefined][] = [];
    createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader() as never,
      resolveEntryPath: async (collection, id, locale) => {
        asked.push([collection, id, locale]);
        return `/${String(locale)}/${id}`;
      },
    });
    const props = await drawn("de");
    expect(await props.context?.resolveEntryPath("pages", "c1")).toBe("/de/c1");
    expect(asked).toEqual([["pages", "c1", "de"]]);
  });
});
