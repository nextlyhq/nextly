/**
 * What the pages search BINDS its reads to, and that installing the plugin
 * serves it authenticated.
 *
 * `pages-search-route.test.ts` exercises the decisions over injected reads, so
 * every one of its assertions passes whatever the declaration hands the Direct
 * API — and the Direct API is the trusted server handle, which defaults every
 * call to `overrideAccess: true`. Under that default every page of every page
 * collection would be listed to any signed-in author. So this file reads the
 * arguments.
 *
 * @module pages-search-route.binding.test
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Direct API handle the route reaches, with its list read recorded. */
const nextly = vi.hoisted(() => ({ find: vi.fn(), findByID: vi.fn() }));

// The handle is replaced and nothing else is: the identity the route hands it
// is the caller's own answer (`caller.identity()`), modelled below.
vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireNextly: () => nextly,
}));

import {
  pageAddressPath,
  PAGES_SEARCH_ROUTE_PATH,
} from "./pages-search-contract";
import { pageAddressRoute, pagesSearchRoute } from "./pages-search-route";
import { pageBuilder } from "./plugin";

/**
 * A route context: who is asking, the plugin's own renamed slugs, and a
 * registry holding one page collection and the plugin's component store.
 */
function contextAs(identity: {
  user: Record<string, unknown>;
}): PluginRouteContext {
  const blocksCollection = (slug: string) => ({
    slug,
    label: slug,
    status: true,
    fields: [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "content", type: "blocks" },
    ],
  });
  return {
    self: { collections: { components: "site_components" } },
    user: { id: "account-only" },
    caller: {
      authMethod: "session",
      can: async () => true,
      identity: async () => identity,
    },
    services: {
      collections: {
        listCollections: async () => ({
          data: [
            blocksCollection("pages"),
            blocksCollection("site_components"),
          ],
          pagination: { hasMore: false, total: 2 },
        }),
      },
    },
  } as unknown as PluginRouteContext;
}

const request = (query: string) =>
  new Request(
    `http://nextly.test/plugins/x${PAGES_SEARCH_ROUTE_PATH}?${query}`
  );

describe("the pages search reads AS THE CALLER", () => {
  beforeEach(() => {
    nextly.find.mockReset();
    const meta = {
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    };
    // The search read answers the page; the publishing-state reads (by core's
    // reserved workflow keys) find nothing waiting on it.
    nextly.find.mockImplementation(async (args: { where?: object }) =>
      Object.hasOwn(args.where ?? {}, "_pendingChange") ||
      Object.hasOwn(args.where ?? {}, "_inRelease")
        ? { items: [], meta: { ...meta, total: 0 } }
        : {
            // `content` comes back (empty), as for a caller who may read the field.
            items: [
              { id: "p1", title: "About", status: "published", content: null },
            ],
            meta,
          }
    );
  });

  it("says overrideAccess: false, with the identity the caller resolved, for every status", async () => {
    const identity = { user: { id: "u1", roles: ["editor"] } };

    await pagesSearchRoute().handler(request("q=abo"), contextAs(identity));

    // One search read: the renamed component store is left out though it
    // holds a blocks field, because the route resolves the plugin's own slug.
    // Then the two publishing-state reads of the page it found.
    expect(nextly.find).toHaveBeenCalledTimes(3);
    const args = nextly.find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      collection: "pages",
      overrideAccess: false,
      status: "all",
      where: { title: { contains: "abo" } },
      select: { id: true, title: true, status: true, content: true },
      sort: ["title", "id"],
      limit: 5,
    });
    expect(args.user).toBe(identity.user);
    // The state reads are the caller's too: which pages hold a working draft
    // or wait on a release is core's to answer for this caller.
    for (const call of nextly.find.mock.calls.slice(1)) {
      const state = call[0] as Record<string, unknown>;
      expect(state).toMatchObject({
        collection: "pages",
        overrideAccess: false,
        select: { id: true },
      });
      expect(state.user).toBe(identity.user);
    }
  });

  it("answers the canonical list envelope", async () => {
    const response = await pagesSearchRoute().handler(
      request(""),
      contextAs({ user: { id: "u1" } })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: "p1",
          collection: "pages",
          collectionLabel: "pages",
          field: "content",
          title: "About",
          status: "published",
        },
      ],
      meta: {
        total: 1,
        page: 1,
        limit: 5,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
  });
});

describe("a page's address reads the page AS SAVED, as the caller", () => {
  it("reads its working draft by id, with the caller's identity", async () => {
    // A Save that does not publish stores a working draft: the address is
    // the draft's, not the live row's a list read would answer with.
    nextly.findByID.mockReset();
    nextly.findByID.mockResolvedValue({ id: "p-1", slug: "pricing-v2" });
    const identity = { user: { id: "u1", roles: ["editor"] } };

    const response = await pageAddressRoute(undefined, "/{slug}").handler(
      new Request(
        `http://nextly.test/plugins/x${pageAddressPath({ collection: "pages", id: "p-1" })}`
      ),
      contextAs(identity)
    );

    expect(await response.json()).toEqual({ path: "/pricing-v2" });
    const args = nextly.findByID.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      collection: "pages",
      id: "p-1",
      overrideAccess: false,
      status: "all",
      draft: true,
      select: { id: true, slug: true },
    });
    expect(args.user).toBe(identity.user);
  });
});

describe("installing the plugin", () => {
  it("serves the route, authenticated", () => {
    const route = (pageBuilder().contributes?.routes ?? []).find(
      candidate => candidate.path === PAGES_SEARCH_ROUTE_PATH
    );
    expect(route?.method).toBe("GET");
    // Absent `public`, the dispatcher refuses a caller who is not signed in.
    expect(route).not.toHaveProperty("public");
  });
});
