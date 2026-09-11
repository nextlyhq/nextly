/**
 * What the component route BINDS its reads to.
 *
 * `library-route.test.ts` exercises the walk over injected reads, so every one
 * of its assertions passes whatever the route declaration hands the Direct API
 * — and the Direct API is the trusted server handle. It defaults every call to
 * `overrideAccess: true`, under which naming a `user` narrows nothing: the
 * service skips the access rules, skips every field-level read rule, and hands
 * over the working draft without asking whether this caller may edit the row.
 * Measured before this file existed: an author who could only READ a component
 * was served its pending draft. Nothing in the walk's tests could see that,
 * because the walk never sees the arguments.
 *
 * So this file reads the arguments. The service's own suite pins what they
 * mean — a read-only caller under `overrideAccess: false` gets the LIVE row
 * even when it opts into the draft — and this pins that the route asks for
 * exactly that.
 *
 * @module library-route.binding.test
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Direct API handle the route reaches, with both reads recorded. */
const nextly = vi.hoisted(() => ({
  find: vi.fn(),
  findByID: vi.fn(),
}));

// The handle is replaced and nothing else is: the identity the route hands it
// is the caller's own answer (`caller.identity()`), modelled by `contextAs`
// below, not one this file restates.
vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireNextly: () => nextly,
}));

import {
  COMPLETION_CONCURRENCY,
  COMPONENT_LIST_PAGE_SIZE,
  componentLibraryRoute,
} from "./library-route";

/** A listed row, as the Direct API's canonical list envelope carries one. */
function listed(...ids: string[]) {
  return {
    items: ids.map(id => ({ id, title: `Component ${id}` })),
    meta: {
      total: ids.length,
      page: 1,
      limit: 100,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  };
}

/**
 * A route context: who is asking, as the dispatcher's caller resolves them,
 * and which collections the host has.
 *
 * The identity is the CALLER's answer — the user context with the roles a
 * stored rule reads, and the key's scope when there is one — because that is
 * what the route reads; `user` on the context names the account and nothing
 * a rule can decide on.
 */
function contextAs(
  user: PluginRouteContext["user"],
  identity: {
    user: Record<string, unknown>;
    authenticatedScope?: PluginRouteContext["authenticatedScope"];
  } = { user: { id: "u1", email: "u1@example.test" } }
): PluginRouteContext {
  return {
    self: { collections: {} },
    user,
    caller: {
      authMethod: "session",
      can: async () => true,
      identity: async () => identity,
    },
  } as unknown as PluginRouteContext;
}

const request = new Request("http://nextly.test/library/components");

describe("the component route reads AS THE USER", () => {
  beforeEach(() => {
    nextly.find.mockReset();
    nextly.findByID.mockReset();
    nextly.find.mockResolvedValue(listed("header"));
    nextly.findByID.mockResolvedValue({
      id: "header",
      title: "Component header",
      content: { formatVersion: 1, kind: "component", nodes: [] },
    });
  });

  it("says overrideAccess: false on the by-id read, beside the draft opt-in", async () => {
    // The Direct API defaults to `true`, and `true` is what hands a read-only
    // caller the working draft: the service grants the opt-in outright to an
    // overriding caller and probes update capability only for the rest. The
    // `false` has to be SAID, and it has to travel with `draft: true` rather
    // than instead of it — an editor who may update the row still wants the
    // draft they are editing.
    await componentLibraryRoute().handler(
      request,
      contextAs({ id: "u1", email: "u1@example.test" } as never)
    );

    expect(nextly.findByID).toHaveBeenCalledTimes(1);
    expect(nextly.findByID.mock.calls[0]?.[0]).toMatchObject({
      collection: "components",
      id: "header",
      overrideAccess: false,
      user: { id: "u1", email: "u1@example.test" },
      draft: true,
    });
  });

  it("asks the by-id read for every lifecycle state, as the listing does", async () => {
    // The listing found the never-published row under `status: "all"`; a
    // by-id read that stated nothing is bounded back to public states and
    // answers 404 for that same row — the draft overlay never reaches it. A
    // component created and not yet published stayed unplaceable that way.
    await componentLibraryRoute().handler(
      request,
      contextAs({ id: "u1", email: "u1@example.test" } as never)
    );

    expect(nextly.findByID.mock.calls[0]?.[0]).toMatchObject({ status: "all" });
  });

  it("reads with the identity the CALLER resolved — roles and claims included — on both reads", async () => {
    // A stored role-based rule reads `user.roles`, and a rule written against
    // a tenant claim reads that off the user too. Built from `ctx.user` alone
    // the context carries neither, and the same caller who passed the route's
    // gate is refused by the collection's rule and gets an empty library. So
    // the user handed to the reads is the one the dispatcher resolved, as it
    // resolved it.
    const resolved = {
      id: "u1",
      email: "u1@example.test",
      roles: ["editor"],
      role: "editor",
      tenant: "acme",
    };
    await componentLibraryRoute().handler(
      request,
      contextAs({ id: "u1", email: "u1@example.test" } as never, {
        user: resolved,
      })
    );

    for (const call of [nextly.find, nextly.findByID]) {
      expect(call.mock.calls[0]?.[0].user).toBe(resolved);
    }
  });

  it("lists every lifecycle state, as the user, in id order, a page at a time", async () => {
    // `status: "all"` is what makes a draft-only component placeable: an
    // untrusted read that states no lifecycle is bounded to public states, and
    // the editor is exactly where a never-published component is reached for.
    // The service still decides which ROWS this caller may see, because the
    // override is off here too.
    await componentLibraryRoute().handler(
      request,
      contextAs({ id: "u1", email: "u1@example.test" } as never)
    );

    expect(nextly.find).toHaveBeenCalledTimes(1);
    expect(nextly.find.mock.calls[0]?.[0]).toMatchObject({
      collection: "components",
      overrideAccess: false,
      user: { id: "u1", email: "u1@example.test" },
      status: "all",
      sort: "id",
      page: 1,
      limit: COMPONENT_LIST_PAGE_SIZE,
    });
  });

  it("carries an API key's own scope on both reads", async () => {
    // A key is judged on the grants stamped on IT, and `user` alone names its
    // owner — so without the scope a viewer-scoped key minted by an
    // administrator would read as the administrator.
    const scope = { actorType: "apiKey", permissions: ["read-components"] };

    await componentLibraryRoute().handler(
      request,
      contextAs({ id: "u1", email: "u1@example.test" } as never, {
        user: { id: "u1", email: "u1@example.test" },
        authenticatedScope: scope as never,
      })
    );

    expect(nextly.find.mock.calls[0]?.[0]).toMatchObject({ actor: scope });
    expect(nextly.findByID.mock.calls[0]?.[0]).toMatchObject({ actor: scope });
  });

  it("names no actor for a session caller, rather than an empty one", async () => {
    // A session holds no stamped scope. Forwarding `undefined` under the key
    // would still be read as "a scope was given" by anything spreading the
    // config, so the key is absent when there is nothing to carry.
    await componentLibraryRoute().handler(
      request,
      contextAs({ id: "u1", email: "u1@example.test" } as never)
    );

    expect(nextly.find.mock.calls[0]?.[0]).not.toHaveProperty("actor");
    expect(nextly.findByID.mock.calls[0]?.[0]).not.toHaveProperty("actor");
  });

  it("leaves out a row the caller may not read or that is gone, and lets any other failure fail the route", async () => {
    // Two expected answers on the by-id read are the walk's to report as a
    // cut library: the row vanished between the two reads, or this caller may
    // not read it. A transient failure — the database, a hook — is neither,
    // and reported as a cut it would read as a static ceiling with no retry
    // while every instance on the page draws as missing. The route fails
    // instead, which the client reads as unavailable, with the retry.
    nextly.find.mockResolvedValue(listed("gone", "kept", "secret"));
    nextly.findByID.mockImplementation(async ({ id }: { id: string }) => {
      if (id === "gone") throw NextlyError.notFound();
      if (id === "secret") throw NextlyError.forbidden();
      return {
        id,
        title: `Component ${id}`,
        content: { formatVersion: 1, kind: "component", nodes: [] },
      };
    });
    const answered = await componentLibraryRoute().handler(
      request,
      contextAs({ id: "u1", email: "u1@example.test" } as never)
    );
    const body = (await answered.json()) as {
      items: { id: string }[];
      meta: { truncated: boolean };
    };
    expect(body.items.map(item => item.id)).toEqual(["kept"]);
    expect(body.meta.truncated).toBe(true);
    // Not asked to swallow: the read's own switch would turn EVERY failure
    // into a missing row, which is what this case exists to refuse.
    expect(nextly.findByID.mock.calls[0]?.[0]).not.toHaveProperty(
      "disableErrors"
    );

    nextly.findByID.mockRejectedValue(
      NextlyError.internal({ logMessage: "db" })
    );
    await expect(
      componentLibraryRoute().handler(
        request,
        contextAs({ id: "u1", email: "u1@example.test" } as never)
      )
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("answers the canonical list envelope, with the document under the name the panel reads", async () => {
    const response = await componentLibraryRoute().handler(
      request,
      contextAs({ id: "u1", email: "u1@example.test" } as never)
    );

    expect(await response.json()).toEqual({
      items: [
        {
          id: "header",
          title: "Component header",
          document: { formatVersion: 1, kind: "component", nodes: [] },
        },
      ],
      meta: { count: 1, truncated: false },
    });
  });
});
