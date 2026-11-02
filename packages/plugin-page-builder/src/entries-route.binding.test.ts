/**
 * What the entries route BINDS its read to, and that installing the plugin
 * serves it.
 *
 * `entries-route.test.ts` exercises the decisions over injected reads, so every
 * one of its assertions passes whatever the declaration hands the Direct API —
 * and the Direct API is the trusted server handle, which defaults every call to
 * `overrideAccess: true`. Under that default naming a `user` narrows nothing:
 * the collection's read rule and every field-level read rule are skipped, and
 * an author would be handed every entry and every title of any collection a
 * block names. So this file reads the arguments.
 *
 * @module entries-route.binding.test
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { clearBlocks } from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The Direct API handle the route reaches, with its list read recorded. */
const nextly = vi.hoisted(() => ({ find: vi.fn() }));

// The handle is replaced and nothing else is: the identity the route hands it
// is the caller's own answer (`caller.identity()`), modelled below.
vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireNextly: () => nextly,
}));

import * as registration from "./blocks/registration-service";
import { ENTRIES_ROUTE_PATH } from "./entries-contract";
import { entriesRoute } from "./entries-route";
import { pageBuilder } from "./plugin";

/** A registered block whose prop points at `posts`, as a plugin declares one. */
const teaser = {
  name: "test/teaser",
  version: 1,
  description: "A teaser of one post.",
  example: { props: {} },
  props: { post: { type: "relation", relationTo: "posts" } },
  render: () => null,
};

/**
 * A route context: who is asking, as the dispatcher's caller resolves them,
 * and the collection service the title field is read from.
 */
function contextAs(identity: {
  user: Record<string, unknown>;
  authenticatedScope?: PluginRouteContext["authenticatedScope"];
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
        getCollection: async () => ({
          fields: [{ name: "title" }, { name: "body" }],
          admin: { useAsTitle: "title" },
        }),
      },
    },
  } as unknown as PluginRouteContext;
}

/**
 * Register the teaser as a plugin declares a block for the editor, with an
 * editor entry: the route reads only for blocks the editor can draw.
 */
function declareTeaser(): void {
  const backend = registration.createBlockRegistrationService();
  const ctx = {
    self: { name: "@acme/teaser" },
    logger: { warn() {}, info() {}, error() {}, debug() {} },
    config: {
      plugins: [
        {
          name: "@acme/teaser",
          contributes: {
            declarations: {
              [registration.PAGE_BUILDER_PLUGIN]: {
                blocks: [teaser],
                editorEntry: "@acme/teaser/editor#blocks",
              },
            },
          },
        },
      ],
    },
    services: {
      plugins: {
        [registration.PAGE_BUILDER_PLUGIN]: {
          [registration.BLOCK_SERVICE]: backend,
        },
      },
    },
  } as unknown as Parameters<typeof registration.registerDeclaredBlocks>[0];
  registration.registerDeclaredBlocks(ctx);
}

const request = (query: string) =>
  new Request(`http://nextly.test/plugins/x${ENTRIES_ROUTE_PATH}?${query}`);

describe("the entries route reads AS THE CALLER", () => {
  beforeEach(() => {
    declareTeaser();
    nextly.find.mockReset();
    nextly.find.mockResolvedValue({
      items: [{ id: "p1", title: "First post", body: "not sent" }],
      meta: {
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
  });

  afterEach(() => {
    clearBlocks();
  });

  it("says overrideAccess: false, with the identity the caller resolved", async () => {
    const identity = {
      user: { id: "u1", roles: ["editor"], claims: { tenant: "t1" } },
    };

    await entriesRoute().handler(
      request("collection=posts&search=fir"),
      contextAs(identity)
    );

    expect(nextly.find).toHaveBeenCalledTimes(1);
    const args = nextly.find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      collection: "posts",
      overrideAccess: false,
      where: { title: { contains: "fir" } },
      select: { id: true, title: true },
      limit: 10,
    });
    // The CALLER's identity, roles and claims included — not the account on
    // `ctx.user`, which carries nothing a rule can decide on.
    expect(args.user).toBe(identity.user);
    expect(args).not.toHaveProperty("actor");
  });

  it("asks for every status, so an author can choose a draft as in the admin's own picker", async () => {
    await entriesRoute().handler(
      request("collection=posts"),
      contextAs({ user: { id: "u1", roles: ["editor"] } })
    );
    const args = nextly.find.mock.calls[0]?.[0] as Record<string, unknown>;
    // Which rows each caller sees is still core's, through overrideAccess.
    expect(args).toMatchObject({ status: "all", overrideAccess: false });
  });

  it("forwards an API key's own scope as the actor, so the key is judged on its grants", async () => {
    const scope = { actorType: "apiKey", permissions: ["read-posts"] };

    await entriesRoute().handler(
      request("collection=posts"),
      contextAs({ user: { id: "owner" }, authenticatedScope: scope as never })
    );

    expect(nextly.find.mock.calls[0]?.[0]).toMatchObject({
      overrideAccess: false,
      actor: scope,
    });
  });

  it("answers the canonical list envelope of { id, title } items", async () => {
    const response = await entriesRoute().handler(
      request("collection=posts"),
      contextAs({ user: { id: "u1" } })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{ id: "p1", title: "First post" }],
      meta: {
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
  });

  it("reads nothing for a collection no registered block names", async () => {
    await expect(
      entriesRoute().handler(
        request("collection=users"),
        contextAs({ user: { id: "u1" } })
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(nextly.find).not.toHaveBeenCalled();
  });
});

describe("the entries route is contributed, not merely written", () => {
  const routes = pageBuilder().contributes?.routes ?? [];
  const entries = routes.find(route => route.path === ENTRIES_ROUTE_PATH);

  it("is mounted at the path the client asks for, as a GET", () => {
    expect(entries).toBeDefined();
    expect(entries?.method).toBe("GET");
  });

  it("is NOT public", () => {
    // A plugin route is authenticated unless it opts out, so this asserts the
    // opt-out is absent. An anonymous read here would hand any visitor the
    // titles of every collection a block names.
    expect(entries?.public).not.toBe(true);
  });
});
