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
import type { ContentEntry, NextlyContentReader } from "../resolve-content";

function stubReader(
  row: Record<string, unknown> | null = { id: "1", slug: "a" }
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
      const items = row ? [row] : [];
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
