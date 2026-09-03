/**
 * What a dynamic block reads, and the one place the two pagination models meet.
 *
 * `BlocksQuery` carries an OFFSET and Nextly reads by PAGE. Translating between
 * them is the only decision this adapter makes, and it is the kind that fails
 * quietly: serving entries 4 to 6 for a request that asked for 6 to 8 produces a
 * page that renders, looks plausible, and is wrong.
 */
import { describe, expect, it } from "vitest";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSiteDataProvider } from "../../src/lib/site-content";

/** The app directory every page route is found under. */
const APP_DIR = fileURLToPath(new URL("../../src/app", import.meta.url));

/**
 * Source with its comments removed.
 *
 * The assertion below reads text, so without this it is satisfied by a property
 * that is commented out — and by prose in a docblock that merely mentions the
 * option. Both describe a route whose `createBlocksPage` receives no provider,
 * which is exactly the state being guarded against.
 *
 * Stripping is deliberately blunt: a `//` inside a string literal would take
 * the rest of that line with it. That direction is safe here — it can only
 * remove the text the assertion looks for, failing the test — whereas leaving
 * comments in place is what lets a broken route pass.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every `page.tsx` beneath the app directory, path and source together. */
function pageRoutes(): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx")
        found.push({
          path: full,
          source: withoutComments(readFileSync(full, "utf-8")),
        });
    }
  };
  walk(APP_DIR);
  return found;
}

/** A reader that records what it was asked and answers with one row. */
function stubReader() {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    reader: {
      find: (args: Record<string, unknown>) => {
        calls.push(args);
        return Promise.resolve({
          items: [{ id: "a" }],
          meta: { total: 7 },
        });
      },
    } as never,
  };
}

describe("every route that renders stored blocks", () => {
  /*
   * DERIVED from the app directory rather than named, so a route added later
   * inherits this without anyone remembering to extend the list. The previous
   * version checked one path by hand and stayed green while the authored route
   * — the one real authors publish to — shipped without a provider.
   *
   * Read from SOURCE, which is the honest limit here: a Next page module
   * exports what the framework expects and nothing this file could import to
   * inspect. The repository already checks a configuration file this way, in
   * `ci-steps-report-independently.test.mjs`.
   */
  const routes = pageRoutes().filter(route =>
    route.source.includes("createBlocksPage(")
  );

  it("finds the routes it is meant to judge", () => {
    // Must-be-found, and by IDENTITY rather than count: a walk that reached the
    // wrong directory, or a filter that matched nothing, would leave the case
    // below asserting over an empty list and passing for that reason alone.
    const paths = routes.map(route => route.path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some(p => p.includes("blocks"))).toBe(true);
    expect(paths.some(p => p.includes("(frontend)"))).toBe(true);
  });

  it.each(routes.map(route => [route.path, route] as const))(
    "%s hands its dynamic blocks a provider",
    (_path, route) => {
      /*
       * Everything else in this file tests the provider in isolation, so all of
       * it stays green when a route stops passing one — and a route with no
       * `data` gets `emptyDataProvider`, which answers every
       * `core/collection-loop` with nothing. The page then renders a section
       * that lists posts and shows an empty box.
       *
       * `\bdata:` rather than `data:`, because the latter is a substring of
       * `metadata:`, which every one of these routes declares — an assertion
       * satisfied by the wrong option would pass on exactly the defect this
       * exists to catch.
       */
      expect(
        route.source,
        "this route passes no `data` provider, so every core/collection-loop " +
          "on a stored page renders an empty container"
      ).toMatch(/\bdata:\s*siteDataProvider\b/);
    }
  );
});

describe("the site's data provider", () => {
  it("passes the collection through and reshapes the result", () => {
    /*
     * Nextly answers `{ items, meta: { total } }` and a block reads
     * `{ items, total }`. The counts live at different depths, so a provider
     * that forwarded the envelope unchanged would leave every block reading
     * `undefined` for its total.
     */
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3 })
      .then(result => {
        expect(calls[0]).toMatchObject({ collection: "posts", limit: 3 });
        expect(result.items).toEqual([{ id: "a" }]);
        expect(result.total).toBe(7);
      });
  });

  it("reads as an ANONYMOUS visitor, never as the process", () => {
    /*
     * The precondition, and the reason it is asserted rather than trusted to a
     * comment: a stored block document names the collection it loops, and this
     * route answers anyone with a URL. `Nextly.find` defaults to a TRUSTED read
     * that evaluates no access rule and applies no lifecycle filter, so the
     * bare call hands a public page rows nobody was allowed to see.
     *
     * Both flags, because they answer different questions — access decides who
     * may see a row, the lifecycle decides whether it is public yet — so a test
     * asserting only one would pass on a provider that leaked the other.
     */
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3 })
      .then(() => {
        expect(calls[0]).toMatchObject({
          overrideAccess: false,
          status: "published",
        });
      });
  });

  it("asks for no page at all when the query has no offset", () => {
    // The ordinary case, and the only one `core/collection-loop` produces: a
    // `page` sent unasked would pin every loop to the first page whatever the
    // reader's own default is.
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3 })
      .then(() => {
        expect(Object.hasOwn(calls[0] ?? {}, "page")).toBe(false);
      });
  });

  it("turns an offset that IS a whole number of pages into that page", () => {
    // Offset 6 with limit 3 is the third page, counting from one.
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3, offset: 6 })
      .then(() => {
        expect(calls[0]).toMatchObject({ limit: 3, page: 3 });
      });
  });

  it("REFUSES an offset that names no page, rather than serving the nearest", () => {
    /*
     * The decision this file exists for. Flooring offset 5 with limit 3 to page
     * 2 serves entries 4 to 6 for a request that asked for 6 to 8 — a wrong
     * answer that renders perfectly and that nobody reports, which is worse than
     * a failure.
     *
     * Unreachable today, because `core/collection-loop` sends no offset at all.
     * That is what makes the guard cheap rather than what makes it unnecessary:
     * the next block that reads a page of entries gets a loud failure instead of
     * a plausible one.
     */
    const { reader } = stubReader();

    return expect(
      createSiteDataProvider(reader).find({
        collection: "posts",
        limit: 3,
        offset: 5,
      })
    ).rejects.toThrow(/names no page/);
  });

  it("treats offset zero as the first page, not as a refusal", () => {
    // Must-differ: zero is a legal offset and divides every limit, so a guard
    // that refused it would reject the commonest explicit query there is.
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3, offset: 0 })
      .then(() => {
        expect(Object.hasOwn(calls[0] ?? {}, "page")).toBe(false);
      });
  });
});
