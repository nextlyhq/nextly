/**
 * What the loop collections route BINDS its sorted read to.
 *
 * `loop-collections-route.test.ts` exercises the decisions over injected
 * reads, so every one of its assertions passes whatever the declaration hands
 * the Direct API, and the Direct API is the trusted server handle, which
 * defaults every call to `overrideAccess: true`. Under that default core skips
 * the field rules a sort is judged by, and every field would be offered to
 * every author. So this file reads the arguments.
 *
 * @module loop-collections-route.binding.test
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Direct API handle the route reaches, with its list read recorded. */
const nextly = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireNextly: () => nextly,
}));

import { LOOP_COLLECTIONS_ROUTE_PATH } from "./loop-collections-contract";
import { loopCollectionsRoute } from "./loop-collections-route";

/** A route context: who is asking, and a registry holding one collection. */
function contextAs(identity: {
  user: Record<string, unknown>;
}): PluginRouteContext {
  return {
    self: { collections: {} },
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
            {
              slug: "posts",
              label: "Post",
              fields: [{ name: "title", type: "text" }],
            },
          ],
          pagination: { hasMore: false, total: 1 },
        }),
      },
    },
  } as unknown as PluginRouteContext;
}

describe("the loop collections route asks core AS THE CALLER", () => {
  beforeEach(() => {
    nextly.find.mockReset();
    nextly.find.mockResolvedValue({
      items: [],
      meta: {
        total: 0,
        page: 1,
        limit: 1,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    });
  });

  it("sorts one row by every candidate, overrideAccess: false, refusing unknown keys", async () => {
    const identity = { user: { id: "u1", roles: ["editor"] } };
    const response = await loopCollectionsRoute().handler(
      new Request(`http://nextly.test/plugins/x${LOOP_COLLECTIONS_ROUTE_PATH}`),
      contextAs(identity)
    );

    expect(nextly.find).toHaveBeenCalledTimes(1);
    const args = nextly.find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      collection: "posts",
      overrideAccess: false,
      select: { id: true },
      sort: ["title", "createdAt", "updatedAt"],
      limit: 1,
      unknownSort: "refuse",
    });
    expect(args.user).toBe(identity.user);
    expect(response.status).toBe(200);
  });
});
