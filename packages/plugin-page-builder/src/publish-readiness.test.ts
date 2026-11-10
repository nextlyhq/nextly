/**
 * Which components and Layout a publish would leave unpublished.
 *
 * Asserted through `planPublishReadiness` over an in-memory store, so each
 * case names exactly which definitions are live, which exist only as drafts
 * and which are gone.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  MAX_COMPOSED_DEPTH,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  documentsWithin,
  planPublishReadiness,
  publishDependenciesRoute,
  systemReads,
  titlesAsCaller,
  type ReadinessReads,
} from "./publish-readiness";

const LIMITS = { maxDepth: 12, maxNodes: 5000, maxBytes: 2_097_152 };

const placements = (ids: readonly string[]) =>
  ids.map((componentId, i) => ({
    id: `i-${componentId}-${String(i)}`,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  }));

const page = (ids: readonly string[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: placements(ids),
});

/** A component definition placing `ids`, or plain content when none. */
const component = (ids: readonly string[] = []): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes:
    ids.length === 0
      ? [{ id: "text", type: "core/text", version: 1, props: {} }]
      : placements(ids),
});

/**
 * A store: each component's definition, and whether it is live. A component
 * absent from `components` does not exist.
 */
function reads(store: {
  components: Record<string, { live: boolean; places?: string[] }>;
  layouts?: Record<string, { live: boolean; areas: string[] }>;
}): ReadinessReads & { storedAsked: string[][] } {
  const storedAsked: string[][] = [];
  return {
    storedAsked,
    published: async ids => {
      const found = new Map<string, BlockDocument>();
      for (const id of ids) {
        const entry = store.components[id];
        if (entry?.live === true) found.set(id, component(entry.places));
      }
      return found;
    },
    stored: async ids => {
      storedAsked.push([...ids]);
      const found = new Map<string, unknown>();
      for (const id of ids) {
        const entry = store.components[id];
        if (entry !== undefined) found.set(id, component(entry.places));
      }
      return found;
    },
    layout: async id => {
      const entry = store.layouts?.[id];
      return entry === undefined
        ? null
        : { published: entry.live, components: entry.areas };
    },
    limits: LIMITS,
  };
}

describe("what a publish would leave unpublished", () => {
  it("names nothing when everything the page places is live", async () => {
    const plan = await planPublishReadiness(
      { documents: [page(["hero"])], layout: null },
      reads({ components: { hero: { live: true } } })
    );
    expect(plan).toEqual({ components: [], layout: null, missing: 0 });
  });

  it("names a placed component that is not published", async () => {
    const plan = await planPublishReadiness(
      { documents: [page(["hero", "card"])], layout: null },
      reads({
        components: { hero: { live: true }, card: { live: false } },
      })
    );
    expect(plan.components).toEqual(["card"]);
  });

  it("names a component that a live component places", async () => {
    const plan = await planPublishReadiness(
      { documents: [page(["hero"])], layout: null },
      reads({
        components: {
          hero: { live: true, places: ["badge"] },
          badge: { live: false },
        },
      })
    );
    expect(plan.components).toEqual(["badge"]);
  });

  it("names what an unpublished component places, deepest first", async () => {
    // The first round can only see `card`: an unpublished definition is never
    // read by the render, so what it places shows only once it is supplied.
    const store = reads({
      components: {
        card: { live: false, places: ["badge"] },
        badge: { live: false, places: ["icon"] },
        icon: { live: false },
      },
    });
    const plan = await planPublishReadiness(
      { documents: [page(["card"])], layout: null },
      store
    );
    expect(plan.components).toEqual(["icon", "badge", "card"]);
    // One read of each level's stored form, never a component twice.
    expect(store.storedAsked).toEqual([["card"], ["badge"], ["icon"]]);
  });

  it("counts a placed component that no longer exists, and offers nothing for it", async () => {
    const plan = await planPublishReadiness(
      { documents: [page(["gone", "card"])], layout: null },
      reads({ components: { card: { live: false } } })
    );
    expect(plan).toEqual({ components: ["card"], layout: null, missing: 1 });
  });

  it("names an unpublished Layout and the components its areas place", async () => {
    const plan = await planPublishReadiness(
      { documents: [page([])], layout: "landing" },
      reads({
        components: { header: { live: false }, footer: { live: true } },
        layouts: { landing: { live: false, areas: ["header", "footer"] } },
      })
    );
    expect(plan).toEqual({
      components: ["header"],
      layout: "landing",
      missing: 0,
    });
  });

  it("names the components a live Layout's areas place, and not the Layout", async () => {
    const plan = await planPublishReadiness(
      { documents: [], layout: "landing" },
      reads({
        components: { header: { live: false } },
        layouts: { landing: { live: true, areas: ["header"] } },
      })
    );
    expect(plan).toEqual({ components: ["header"], layout: null, missing: 0 });
  });

  it("says nothing about a Layout that no longer exists", async () => {
    const plan = await planPublishReadiness(
      { documents: [page([])], layout: "gone" },
      reads({ components: {} })
    );
    expect(plan).toEqual({ components: [], layout: null, missing: 0 });
  });

  it("puts a component after one it places, when both are found together", async () => {
    // The page places `child` then `parent`, and `parent` places `child`
    // too: discovery meets them in one round, in the page's order, and only
    // the placements say which must go live first.
    const plan = await planPublishReadiness(
      { documents: [page(["child", "parent"])], layout: null },
      reads({
        components: {
          child: { live: false },
          parent: { live: false, places: ["child"] },
        },
      })
    );
    expect(plan.components).toEqual(["child", "parent"]);

    const reversed = await planPublishReadiness(
      { documents: [page(["parent", "child"])], layout: null },
      reads({
        components: {
          child: { live: false },
          parent: { live: false, places: ["child"] },
        },
      })
    );
    expect(reversed.components).toEqual(["child", "parent"]);
  });

  it("still answers the Layout when components are not judged", async () => {
    // A localized component store: no component is named, but the page's
    // unpublished Layout still is.
    const plan = await planPublishReadiness(
      {
        documents: [page(["card"])],
        layout: "landing",
        judgeComponents: false,
      },
      reads({
        components: { card: { live: false }, header: { live: false } },
        layouts: { landing: { live: false, areas: ["header"] } },
      })
    );
    expect(plan).toEqual({ components: [], layout: "landing", missing: 0 });
  });

  it("names a chain as deep as the render composes, and nothing past it", async () => {
    // Twenty unpublished components, each placing the next, under a host
    // that allows deep node trees: the render composes components only
    // MAX_COMPOSED_DEPTH levels deep, so the rest are never a hole publishing
    // could fill, and are not named.
    const chain = Array.from({ length: 20 }, (_, i) => `c${String(i)}`);
    const store = reads({
      components: Object.fromEntries(
        chain.map((id, i) => [
          id,
          { live: false, places: chain.slice(i + 1, i + 2) },
        ])
      ),
    });
    const plan = await planPublishReadiness(
      { documents: [page(chain.slice(0, 1))], layout: null },
      { ...store, limits: { ...LIMITS, maxDepth: 40 } }
    );
    expect(plan.components).toEqual(
      chain.slice(0, MAX_COMPOSED_DEPTH).reverse()
    );
  });

  it("names a component placed in two documents once", async () => {
    const plan = await planPublishReadiness(
      { documents: [page(["card"]), page(["card"])], layout: null },
      reads({ components: { card: { live: false } } })
    );
    expect(plan.components).toEqual(["card"]);
  });
});

describe("the reads behind the answer", () => {
  const ids = Array.from({ length: 600 }, (_, i) => `c${String(i)}`);
  const stores = {
    components: "components",
    componentField: "content",
    layouts: "layouts",
  };

  /**
   * A store of every id in `ids` that answers as core's collection query
   * does: at most 500 rows a query, whatever the limit asked.
   */
  function clampedStore() {
    const asked: Record<string, unknown>[] = [];
    return {
      asked,
      find: async (args: Record<string, unknown>) => {
        asked.push(args);
        const where = args.where as { id: { in: string[] } };
        const limit = Math.min(Number(args.limit), 500);
        return {
          items: where.id.in.slice(0, limit).map(id => ({
            id,
            title: `Title ${id}`,
            content: component(),
          })),
        };
      },
    };
  }

  it("reads every stored component asked for, past one query's clamp", async () => {
    const store = clampedStore();
    const reads = systemReads(
      store as unknown as Parameters<typeof systemReads>[0],
      stores,
      LIMITS
    );
    const stored = await reads.stored(ids);
    expect([...stored.keys()]).toEqual(ids);
  });

  it("reads every title the caller may read, past one query's clamp, as the caller", async () => {
    const store = clampedStore();
    const user = { id: "author" };
    const titles = await titlesAsCaller(
      {
        caller: {
          identity: async () => ({ user }),
        } as unknown as Parameters<typeof titlesAsCaller>[0]["caller"],
      },
      store as unknown as Parameters<typeof titlesAsCaller>[1],
      "components",
      ids
    );
    expect([...titles.keys()]).toEqual(ids);
    expect(store.asked.length).toBeGreaterThan(1);
    for (const read of store.asked) {
      expect(read).toMatchObject({ overrideAccess: false, user });
    }
  });
});

describe("a page drawn inside the site's default Layout", () => {
  it("names the components a live default's areas place, and not the default", async () => {
    const plan = await planPublishReadiness(
      { documents: [page([])], layout: "site", siteDefault: true },
      reads({
        components: { crest: { live: false } },
        layouts: { site: { live: true, areas: ["crest"] } },
      })
    );
    expect(plan).toEqual({ components: ["crest"], layout: null, missing: 0 });
  });

  it("names nothing for an unpublished default, which draws no regions", async () => {
    const plan = await planPublishReadiness(
      { documents: [page([])], layout: "site", siteDefault: true },
      reads({
        components: { crest: { live: false } },
        layouts: { site: { live: false, areas: ["crest"] } },
      })
    );
    expect(plan).toEqual({ components: [], layout: null, missing: 0 });
  });
});

describe("the work one request may ask for", () => {
  const limits = { maxDepth: 12, maxNodes: 10, maxBytes: 1000 };
  const props = (text: string) => ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [{ id: "t", type: "core/text", version: 1, props: { text } }],
  });

  it("takes documents within eight times the largest size allowed", () => {
    expect(documentsWithin([props("x".repeat(900))], limits)).toHaveLength(1);
  });

  it("refuses a document of few nodes past the bytes allowed", () => {
    // One node, so within the node budget: only its bytes are too many.
    expect(() =>
      documentsWithin([props("x".repeat(8 * 1000))], limits)
    ).toThrow();
  });
});

// The route reads nothing it publishes, so it has no version to send: each
// write chooses to publish whatever the document holds, and says so.
describe("publishing what a page needs", () => {
  it("publishes each chosen document as an overwrite, as the caller", async () => {
    const updateEntry = vi.fn(async () => ({}));
    const route = publishDependenciesRoute({
      store: { field: "content" },
      enabled: true,
      limits: () => LIMITS,
    });
    const res = await route.handler(
      new Request("http://localhost/publish-dependencies", {
        method: "POST",
        body: JSON.stringify({
          dependencies: [
            { kind: "component", id: "c1" },
            { kind: "layout", id: "l1" },
          ],
        }),
      }),
      {
        self: { collections: {}, singles: {} },
        user: { id: "u1" },
        services: { collections: { updateEntry } },
      } as never
    );

    expect(res.status).toBe(200);
    expect(updateEntry.mock.calls.map(call => call.slice(1, 3))).toEqual([
      ["c1", { status: "published", _overwrite: true }],
      ["l1", { status: "published", _overwrite: true }],
    ]);
  });
});
