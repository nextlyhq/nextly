/**
 * What the loop collections route BINDS its reads to.
 *
 * `loop-collections-route.test.ts` exercises the decisions over injected
 * reads, so every one of its assertions passes whatever the declaration hands
 * them. Two bindings decide what an author is offered, and this file reads
 * both: which collections are listed is asked of the CALLER, and which fields
 * of each is asked of the PUBLIC (`bindingFieldShapes`), since a list's
 * filters and sort may name only fields a visitor can see. A field read with
 * the caller's access, or the trusted server handle's, would offer a field
 * the save then refuses.
 *
 * @module loop-collections-route.binding.test
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The public's shapes, as the route reads them, with each read recorded. */
const runtime = vi.hoisted(() => ({ bindingFieldShapes: vi.fn() }));

vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bindingFieldShapes: runtime.bindingFieldShapes,
}));

import { LOOP_COLLECTIONS_ROUTE_PATH } from "./loop-collections-contract";
import { loopCollectionsRoute } from "./loop-collections-route";

/** A route context: who is asking, and a registry holding two collections. */
function contextAs(can: (action: string, slug: string) => Promise<boolean>) {
  return {
    self: { collections: {} },
    user: { id: "account-only" },
    caller: {
      authMethod: "session",
      can: vi.fn(can),
      identity: async () => ({ user: { id: "u1" } }),
    },
    services: {
      collections: {
        listCollections: async () => ({
          data: [
            {
              slug: "posts",
              label: "Post",
              fields: [
                { name: "title", type: "text", label: "Title" },
                { name: "internalNote", type: "text" },
              ],
            },
            { slug: "orders", label: "Order", fields: [] },
          ],
          pagination: { hasMore: false, total: 2 },
        }),
      },
    },
  };
}

describe("the loop collections route", () => {
  beforeEach(() => {
    runtime.bindingFieldShapes.mockReset();
    // The public may read the title and not the note.
    runtime.bindingFieldShapes.mockResolvedValue([
      { name: "title", type: "text" },
    ]);
  });

  it("lists the collections the caller may read, with the fields the public may read", async () => {
    const ctx = contextAs(async (_action, slug) => slug === "posts");
    const response = await loopCollectionsRoute().handler(
      new Request(`http://nextly.test/plugins/x${LOOP_COLLECTIONS_ROUTE_PATH}`),
      ctx as unknown as PluginRouteContext
    );

    expect(response.status).toBe(200);
    expect(ctx.caller.can.mock.calls).toEqual([
      ["read", "posts"],
      ["read", "orders"],
    ]);
    // Asked of the public for the listed collection only, by its slug, in
    // every language when none is asked.
    expect(runtime.bindingFieldShapes.mock.calls).toEqual([
      [{ collection: "posts" }, {}],
    ]);
    const body = (await response.json()) as {
      items: { slug: string; fields: { name: string }[] }[];
    };
    expect(body.items.map(item => item.slug)).toEqual(["posts"]);
    expect(body.items[0]?.fields.map(field => field.name)).toEqual([
      "title",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("asks the public in the language the editor asks in, as a save in it judges", async () => {
    const ctx = contextAs(async (_action, slug) => slug === "posts");
    const response = await loopCollectionsRoute().handler(
      new Request(
        `http://nextly.test/plugins/x${LOOP_COLLECTIONS_ROUTE_PATH}?locale=fr`
      ),
      ctx as unknown as PluginRouteContext
    );
    expect(response.status).toBe(200);
    expect(runtime.bindingFieldShapes.mock.calls).toEqual([
      [{ collection: "posts" }, { locale: "fr" }],
    ]);
  });
});
