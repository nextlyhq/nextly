/**
 * `createContentRoute`'s draft decision, against a stubbed reader (no DB).
 *
 * Route config is captured once at module scope while "is this visitor
 * previewing" is a per-request fact, so the decision has to be a function the
 * route asks on every resolve. These cover that it is asked, that its answer
 * reaches the read, and that a build-time scan ignores it entirely.
 */
import { describe, expect, it } from "vitest";

import type {
  FindArgs,
  FindByIDArgs,
} from "../../../direct-api/types/collections";
import type { ListResult } from "../../../direct-api/types/shared";
import { createContentRoute, createPublicContentRoute } from "../content-route";
import type { ResolvedContext } from "../content-route";
import type { ContentEntry, NextlyContentReader } from "../resolve-content";

function stubReader(
  row: Record<string, unknown> | null = {
    id: "1",
    slug: "a",
    status: "published",
  },
  /**
   * Apply the lifecycle scope the way the query service does, so a
   * never-published row is only returned to a read that widened `status`.
   * Off by default: most cases here are about which arguments the route sends,
   * and a stub that answers regardless keeps them independent of the filter.
   */
  options: { enforceStatus?: boolean } = {}
): {
  reader: NextlyContentReader;
  calls: FindArgs[];
  byIdCalls: FindByIDArgs[];
} {
  const calls: FindArgs[] = [];
  const byIdCalls: FindByIDArgs[] = [];
  const reader: NextlyContentReader = {
    find: async (args): Promise<ListResult<Record<string, unknown>>> => {
      calls.push(args);
      const withheld =
        options.enforceStatus === true &&
        args.status !== "all" &&
        row?.status !== "published";
      const items = row && !withheld ? [row] : [];
      return {
        items,
        meta: {
          total: items.length,
          page: 1,
          limit: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
    findByID: async (args): Promise<Record<string, unknown> | null> => {
      byIdCalls.push(args);
      return { ...row, _isWorkingDraft: true };
    },
  };
  return { reader, calls, byIdCalls };
}

function routeWith(
  reader: NextlyContentReader,
  draft?: boolean | (() => boolean | Promise<boolean>)
) {
  return createContentRoute({
    collections: ["pages"],
    nextly: reader,
    render: (entry: ContentEntry) => entry,
    buildMetadata: (entry: ContentEntry) => ({ title: String(entry.id) }),
    ...(draft === undefined ? {} : { draft }),
  });
}

/**
 * The same route, declared public — the only shape that pre-renders.
 *
 * Separate from `routeWith` because the two postures differ in what they read
 * with, not only in what they return: a public route reads TRUSTED. Tests about
 * resolution keep the enforced default; tests about pre-rendering must use this
 * one, because an enforced route has no `generateStaticParams` to call.
 */
function publicRouteWith(
  reader: NextlyContentReader,
  draft?: boolean | (() => boolean | Promise<boolean>)
) {
  return createPublicContentRoute({
    collections: ["pages"],
    nextly: reader,
    render: (entry: ContentEntry) => entry,
    buildMetadata: (entry: ContentEntry) => ({ title: String(entry.id) }),
    ...(draft === undefined ? {} : { draft }),
  });
}

const params = { params: { slug: ["a"] } };

describe("the content route's draft decision", () => {
  it("reads published content when nothing asks for a draft", async () => {
    const { reader, calls, byIdCalls } = stubReader();

    await routeWith(reader).generateMetadata(params);

    expect(calls[0].status).toBe("published");
    expect(calls[0].overrideAccess).toBe(false);
    expect(byIdCalls).toHaveLength(0);
  });

  it("asks its decision function on every resolve", async () => {
    // Config is captured once; the answer is not. A decision read at factory
    // time would freeze the first visitor's answer for every later one.
    const { reader } = stubReader();
    let asked = 0;
    const route = routeWith(reader, () => {
      asked += 1;
      return false;
    });

    await route.generateMetadata(params);
    await route.generateMetadata(params);

    expect(asked).toBe(2);
  });

  it("honours an answer that changes between requests", async () => {
    const { reader, byIdCalls } = stubReader();
    let previewing = false;
    const route = routeWith(reader, () => previewing);

    await route.generateMetadata(params);
    expect(byIdCalls).toHaveLength(0);

    previewing = true;
    await route.generateMetadata(params);
    expect(byIdCalls).toHaveLength(1);
  });

  it("accepts an async decision, as reading Next's draft mode requires", async () => {
    // `draftMode()` is async from Next 15, so the natural wiring returns a
    // promise; a synchronous-only signature would make it unusable.
    const { reader, byIdCalls } = stubReader();

    await routeWith(reader, async () => Promise.resolve(true)).generateMetadata(
      params
    );

    expect(byIdCalls).toHaveLength(1);
  });

  it("reads trusted when the answer is yes", async () => {
    // The route resolves anonymously and the overlay is gated on an
    // update-capability probe, so an enforced draft read could only ever return
    // the published row — preview would silently do nothing.
    const { reader, calls, byIdCalls } = stubReader();

    await routeWith(reader, true).generateMetadata(params);

    expect(calls[0].overrideAccess).toBe(true);
    expect(byIdCalls[0].overrideAccess).toBe(true);
    expect(byIdCalls[0].draft).toBe(true);
  });

  it("widens the lifecycle scope with it, so both draft layers move together", async () => {
    const { reader, calls } = stubReader();

    await routeWith(reader, true).generateMetadata(params);

    expect(calls[0].status).toBe("all");
  });

  it("leaves an explicitly configured lifecycle scope alone", async () => {
    const { reader, calls } = stubReader();

    await createContentRoute({
      collections: ["pages"],
      nextly: reader,
      status: "published",
      draft: true,
      render: (entry: ContentEntry) => entry,
      buildMetadata: (entry: ContentEntry) => ({ title: String(entry.id) }),
    }).generateMetadata(params);

    expect(calls[0].status).toBe("published");
  });

  it("scopes the decision to the path being resolved", async () => {
    // Next's draft mode is one boolean for the whole host: `isEnabled` says a
    // visitor opened A valid preview link, never WHICH document it was for.
    // Answering from that alone would turn a link scoped to one unpublished
    // page into a key to every unpublished page in the configured collections.
    // The collection and slug are handed in so the answer can be compared
    // against what the token actually granted.
    const { reader, byIdCalls } = stubReader();
    const seen: ResolvedContext[] = [];
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry) => entry,
      buildMetadata: (entry: ContentEntry) => ({ title: String(entry.id) }),
      draft: context => {
        seen.push(context);
        return context.slug === "granted";
      },
    });

    await route.generateMetadata({ params: { slug: ["denied"] } });
    expect(seen).toEqual([{ collection: "pages", slug: "denied" }]);
    expect(byIdCalls).toHaveLength(0);

    await route.generateMetadata({ params: { slug: ["granted"] } });
    expect(seen[1]).toEqual({ collection: "pages", slug: "granted" });
    expect(byIdCalls).toHaveLength(1);
  });

  it("asks per collection, since one slug can name a different document in each", async () => {
    const { reader } = stubReader(null);
    const seen: ResolvedContext[] = [];

    await createContentRoute({
      collections: ["pages", "docs"],
      nextly: reader,
      render: (entry: ContentEntry) => entry,
      buildMetadata: (entry: ContentEntry) => ({ title: String(entry.id) }),
      draft: context => {
        seen.push(context);
        return false;
      },
    }).generateMetadata(params);

    expect(seen).toEqual([
      { collection: "pages", slug: "a" },
      { collection: "docs", slug: "a" },
    ]);
  });

  it("refuses a draft for an object grant that names no entry", async () => {
    // The decision is app-supplied code, so the type is not a runtime
    // guarantee. An object carrying no usable id must authorize nothing: the
    // one combination that must not exist is a widened lifecycle scope with no
    // entry named to bound it.
    for (const grant of [{}, { entryId: "" }, { entryId: 42 }]) {
      const { reader, calls } = stubReader(
        { id: "1", slug: "a", status: "draft" },
        { enforceStatus: true }
      );

      const route = createContentRoute({
        collections: ["pages"],
        nextly: reader,
        render: (row: ContentEntry) => row,
        buildMetadata: (row: ContentEntry) => ({ title: String(row.slug) }),
        draft: () => grant as never,
      });

      // Nothing published lives at this path, so refusing the grant leaves
      // nothing to serve. The read that happened is the assertion: published,
      // not widened.
      await expect(route.ContentPage(params)).rejects.toThrow();
      expect(calls.map(call => call.status)).toEqual(["published"]);
    }
  });

  it("scans and resolves in the SAME locale", async () => {
    // A localized route that pre-rendered default-locale slugs would bake paths
    // its own resolver answers with `notFound()`, while the slugs it does serve
    // stayed absent from the scan and fell back to rendering on demand.
    const { reader, calls } = stubReader();
    const route = createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      locale: "fr",
      render: (entry: ContentEntry) => entry,
    });

    await route.generateStaticParams();
    const scanned = calls.length;
    await route.ContentPage(params).catch(() => undefined);

    // The two paths are asserted SEPARATELY. `generateStaticParams` alone
    // populates `calls`, so a single "every call carried the locale" check
    // passes even when `ContentPage` throws before reading anything — the page
    // resolution would be uncovered while the test reported it green.
    expect(scanned).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(scanned);
    expect(calls.every(call => call.locale === "fr")).toBe(true);
  });

  it("cannot be asked to pre-render a route that also serves drafts", () => {
    // The guarantee used to be behavioural — `generateStaticParams` scanned
    // published only, so a draft never reached a built path. It is now
    // structural: a draft read is never cacheable and marks the render dynamic,
    // while a public route's `generateStaticParams` tells Next it is static, so
    // the pair is refused where it is written. Stronger than the old assertion,
    // because it removes the combination rather than relying on the scan to
    // behave correctly inside it.
    const { reader } = stubReader();

    expect(() => publicRouteWith(reader, true)).toThrow(/cannot serve drafts/i);
  });

  it("does not expand relations unless the site asks it to", async () => {
    // A trusted read propagates its trust AND `status: "all"` into relationship
    // expansion, so a populated target is read with access rules bypassed and
    // drafts included. On a public route that page is then pre-rendered into a
    // static artifact. Defaulting to no expansion makes that exposure something
    // a site opts into rather than inherits.
    const { reader, calls } = stubReader();

    await publicRouteWith(reader).ContentPage({ params: { slug: ["a"] } });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(call => call.depth === 0)).toBe(true);
  });

  it("keeps the safe default when depth is explicitly undefined", async () => {
    // An optional property permits an explicit `undefined`, and forwarding a
    // config object produces one routinely. A spread overwrites with it, so a
    // default placed BEFORE the spread is silently discarded — restoring
    // trusted relation expansion for the caller least likely to have chosen it.
    const { reader, calls } = stubReader();

    await createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      depth: undefined,
      render: (entry: ContentEntry) => entry,
    }).ContentPage({ params: { slug: ["a"] } });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(call => call.depth === 0)).toBe(true);
  });

  it("still expands relations when the site sets depth explicitly", async () => {
    // The default is a safe starting point, not a ceiling. A site that
    // populates relations says so, and by saying so states that those
    // collections are public too.
    const { reader, calls } = stubReader();

    await createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      depth: 2,
      render: (entry: ContentEntry) => entry,
    }).ContentPage({ params: { slug: ["a"] } });

    expect(calls.every(call => call.depth === 2)).toBe(true);
  });

  it("cannot be asked to pre-render a route that builds no paths", () => {
    // `staticParamsLimit: 0` asks for a static route with nothing to build. The
    // generator returns `[]` — accepted by standard App Router builds, rejected
    // outright by Next 16 Cache Components — so the contradiction is refused
    // where it is written rather than at build time.
    const { reader } = stubReader();

    expect(() =>
      createPublicContentRoute({
        collections: ["pages"],
        nextly: reader,
        render: (entry: ContentEntry) => entry,
        staticParamsLimit: 0,
      })
    ).toThrow(/pre-render nothing/i);
  });

  it("pre-renders published paths only, and reads them trusted", async () => {
    // What survives of the old test: the scan itself. A public route has no
    // draft to widen with, so `status` is the only thing keeping an unpublished
    // entry out of a built path.
    const { reader, calls, byIdCalls } = stubReader();

    await publicRouteWith(reader).generateStaticParams();

    expect(byIdCalls).toHaveLength(0);
    expect(calls.every(call => call.status === "published")).toBe(true);
    // Trusted, and that is the posture the ROUTE declared rather than a default
    // it inherited: only a public route pre-renders, and public means the
    // collections' read rules are not consulted. The draft guarantee does not
    // rest on access enforcement — it rests on `status`, asserted above, which
    // is what keeps an unpublished entry out of a built path.
    expect(calls.every(call => call.overrideAccess === true)).toBe(true);
  });
});
