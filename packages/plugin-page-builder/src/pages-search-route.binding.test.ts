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
const nextly = vi.hoisted(() => ({ find: vi.fn() }));

// The handle is replaced and nothing else is: the identity the route hands it
// is the caller's own answer (`caller.identity()`), modelled below.
vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireNextly: () => nextly,
}));

import { PAGES_SEARCH_ROUTE_PATH } from "./pages-search-contract";
import { pagesSearchRoute } from "./pages-search-route";
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
    nextly.find.mockResolvedValue({
      items: [{ id: "p1", title: "About", status: "published" }],
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

  it("says overrideAccess: false, with the identity the caller resolved, for every status", async () => {
    const identity = { user: { id: "u1", roles: ["editor"] } };

    await pagesSearchRoute().handler(request("q=abo"), contextAs(identity));

    // One read: the renamed component store is left out though it holds a
    // blocks field, because the route resolves the plugin's own slug.
    expect(nextly.find).toHaveBeenCalledTimes(1);
    const args = nextly.find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      collection: "pages",
      overrideAccess: false,
      status: "all",
      where: { title: { contains: "abo" } },
      select: { id: true, title: true, status: true },
      sort: "title",
      limit: 5,
    });
    expect(args.user).toBe(identity.user);
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
