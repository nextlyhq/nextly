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
import { createContentRoute } from "../content-route";
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
    const route = createContentRoute({
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

  it("never pre-renders draft paths", async () => {
    // `generateStaticParams` runs at build time, where there is no visitor and
    // no preview. Baking a draft into a static path would publish it to
    // everyone, permanently, with no request to gate it.
    const { reader, calls, byIdCalls } = stubReader();

    await routeWith(reader, true).generateStaticParams();

    expect(byIdCalls).toHaveLength(0);
    expect(calls.every(call => call.status === "published")).toBe(true);
    expect(calls.every(call => call.overrideAccess === false)).toBe(true);
  });
});

describe("the reader handed to callbacks", () => {
  /**
   * A stub whose by-id read answers with a NEVER-PUBLISHED row, which is what
   * the real one does: `findByID` takes no `status` and the read beneath it
   * applies none, so the scope has to be enforced above it or not at all.
   */
  function draftAnsweringReader(): {
    reader: NextlyContentReader;
    calls: FindArgs[];
  } {
    const calls: FindArgs[] = [];
    const page = { id: "1", slug: "a", _status: "published" };
    const related = { id: "related", _status: "draft" };
    const listMeta = (total: number) => ({
      total,
      page: 1,
      limit: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
    return {
      calls,
      reader: {
        find: async (args): Promise<ListResult<Record<string, unknown>>> => {
          calls.push(args);
          // A lookup BY ID is the scoped by-id path. The scope is applied by
          // the QUERY here, exactly as the real reader applies it — before any
          // `afterRead` runs — so a draft row is withheld from a published
          // read rather than returned and judged afterwards.
          const wantedId = (
            args.where as { id?: { equals?: unknown } } | undefined
          )?.id?.equals;
          if (wantedId !== undefined) {
            const inScope = args.status === "all" || args.status === "draft";
            const items = inScope ? [related] : [];
            return { items, meta: listMeta(items.length) };
          }
          return { items: [page], meta: listMeta(1) };
        },
        // Answers regardless of scope, which is what the real one does: it
        // takes no `status` and the read beneath it applies none.
        findByID: async (): Promise<Record<string, unknown> | null> => related,
      },
    };
  }

  /** Capture the reader a render callback receives. */
  async function readerGivenTo(
    stub: NextlyContentReader,
    config: Partial<Parameters<typeof createContentRoute>[0]> = {}
  ): Promise<NextlyContentReader> {
    let seen: NextlyContentReader | undefined;
    const route = createContentRoute({
      collections: ["pages"],
      nextly: stub,
      render: (entry: ContentEntry, context) => {
        seen = context.reader;
        return entry;
      },
      ...config,
    });
    await route.ContentPage(params).catch(() => undefined);
    if (!seen) throw new Error("render never ran");
    return seen;
  }

  it("filters a by-id read against the route's lifecycle scope", async () => {
    // Otherwise `findByID` returns a never-published row while `find` on the
    // SAME reader is published-only: two answers about one collection, and the
    // asymmetry is invisible to the caller.
    const { reader } = draftAnsweringReader();
    const given = await readerGivenTo(reader);

    await expect(
      given.findByID({ collection: "authors", id: "x" })
    ).resolves.toBeNull();
  });

  it("keeps a by-id read that IS in scope", async () => {
    // The positive control. Without it the test above passes for a reader that
    // rejects everything, which would be a different bug wearing the same green.
    const { reader } = draftAnsweringReader();
    const given = await readerGivenTo(reader, { status: "all" });

    await expect(
      given.findByID({ collection: "authors", id: "x" })
    ).resolves.toMatchObject({ id: "related" });
  });

  it("stays published when a stale grant fell back to a published read", async () => {
    // `resolveContent` falls back to a published-only lookup when a grant names
    // an entry it cannot confirm, and `draft` stays true through that fallback.
    // Widening on the REQUEST handed a callback `"all"` at a path the grant
    // authorized nothing for; the resolved entry is the evidence instead.
    const { reader, calls } = draftAnsweringReader();
    const given = await readerGivenTo(reader, {
      draft: () => ({ entryId: "gone" }),
    });
    calls.length = 0;

    await given.find({ collection: "authors" });

    expect(calls[0]?.status).toBe("published");
  });

  it("binds the route's locale, so a callback need not repeat it", async () => {
    const { reader, calls } = draftAnsweringReader();
    const given = await readerGivenTo(reader, { locale: "fr" });
    calls.length = 0;

    await given.find({ collection: "authors" });

    expect(calls[0]?.locale).toBe("fr");
    expect(calls[0]?.overrideAccess).toBe(false);
  });
});

describe("the scoped reader's defaults", () => {
  it("survives an argument the caller left explicitly undefined", async () => {
    // `exactOptionalPropertyTypes` is off, so `find({ collection, status })`
    // with an undefined `status` typechecks — and spread over the bound
    // defaults it ERASED them, handing back exactly the unscoped reader this
    // facade exists to prevent. An absent key and a key holding `undefined`
    // mean the same thing to a caller and opposite things to a spread.
    const calls: FindArgs[] = [];
    const reader: NextlyContentReader = {
      find: async (args): Promise<ListResult<Record<string, unknown>>> => {
        calls.push(args);
        const items = [{ id: "1", slug: "a", _status: "published" }];
        return {
          items,
          meta: {
            total: 1,
            page: 1,
            limit: 1,
            totalPages: 1,
            hasNext: false,
            hasPrev: false,
          },
        };
      },
      findByID: async (): Promise<Record<string, unknown> | null> => null,
    };

    let seen: NextlyContentReader | undefined;
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry, context) => {
        seen = context.reader;
        return entry;
      },
    });
    await route.ContentPage(params).catch(() => undefined);
    calls.length = 0;

    await seen?.find({
      collection: "authors",
      status: undefined,
      overrideAccess: undefined,
    });

    expect(calls[0]?.status).toBe("published");
    expect(calls[0]?.overrideAccess).toBe(false);
  });
});

describe("a status-less collection's ordinary fields", () => {
  it("does not widen the callback reader on a field merely NAMED status", async () => {
    // Nextly supports an ordinary string field called `status`. Judging it as
    // the lifecycle column made a public route conclude its own published
    // filter had been widened — on the strength of a value that filter ignored
    // — and hand a callback an `all`-scoped, access-overriding reader.
    const calls: FindArgs[] = [];
    const reader: NextlyContentReader = {
      find: async (args): Promise<ListResult<Record<string, unknown>>> => {
        calls.push(args);
        // No `_status`: this collection has no lifecycle at all.
        const items = [{ id: "1", slug: "a", status: "archived" }];
        return {
          items,
          meta: {
            total: 1,
            page: 1,
            limit: 1,
            totalPages: 1,
            hasNext: false,
            hasPrev: false,
          },
        };
      },
      findByID: async (): Promise<Record<string, unknown> | null> => null,
    };

    let seen: NextlyContentReader | undefined;
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry, context) => {
        seen = context.reader;
        return entry;
      },
    });
    await route.ContentPage(params).catch(() => undefined);
    calls.length = 0;

    await seen?.find({ collection: "authors" });

    expect(calls[0]?.status).toBe("published");
    expect(calls[0]?.overrideAccess).toBe(false);
  });
});
