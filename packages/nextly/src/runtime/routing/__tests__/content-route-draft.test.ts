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

  it("discards a draft the grant did not name", async () => {
    // A slug need not be unique — the resolver supports duplicates and settles
    // them by sorting on `id` — so a grant scoped to one entry could otherwise
    // open another that happens to share its slug. The grant names the
    // document, and a resolve that lands on a different one falls back to
    // published rather than serving what was never granted.
    const { reader, byIdCalls } = stubReader();

    const wrongEntry = await createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry) => entry,
      buildMetadata: (entry: ContentEntry) => ({ title: String(entry.id) }),
      draft: () => ({ entryId: "some-other-entry" }),
    }).ContentPage(params);

    expect((wrongEntry as ContentEntry)._isWorkingDraft).toBeUndefined();

    byIdCalls.length = 0;
    const rightEntry = await createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry) => entry,
      buildMetadata: (entry: ContentEntry) => ({ title: String(entry.id) }),
      draft: () => ({ entryId: "1" }),
    }).ContentPage(params);

    expect((rightEntry as ContentEntry)._isWorkingDraft).toBe(true);
    expect(byIdCalls).toHaveLength(1);
  });

  it("refuses a grant when the resolved document has no comparable id", async () => {
    // An `afterRead` hook's return value REPLACES the document, so a collection
    // that reshapes its public read can hand back a row whose id is absent or
    // structured. Stringifying those yields `"undefined"` and
    // `"[object Object]"` — values a grant can carry literally.
    //
    // What that would cost is a disclosure, not a degraded preview: a grant the
    // route honours is read with the lifecycle scope widened to `"all"`, so the
    // row it matches by accident can be one that was NEVER published.
    for (const id of [undefined, { nested: "1" }]) {
      const { reader, calls } = stubReader(
        { id, slug: "a", status: "draft" },
        { enforceStatus: true }
      );

      const route = createContentRoute({
        collections: ["pages"],
        nextly: reader,
        render: (row: ContentEntry) => row,
        buildMetadata: (row: ContentEntry) => ({ title: String(row.slug) }),
        draft: () => ({ entryId: String(id) }),
      });

      // The never-published row is the only one there is, so refusing the grant
      // leaves nothing to serve. Asserting the REFUSAL rather than the throw:
      // the route re-read published-only, which is what a rejected grant does
      // and what returning the row instead would have skipped.
      await expect(route.ContentPage(params)).rejects.toThrow();
      expect(calls.map(call => call.status)).toEqual(["all", "published"]);
    }
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
