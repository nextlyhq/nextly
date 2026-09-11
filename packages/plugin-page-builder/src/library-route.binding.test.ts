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
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Direct API handle the route reaches, with both reads recorded. */
const nextly = vi.hoisted(() => ({
  find: vi.fn(),
  findByID: vi.fn(),
}));

vi.mock("nextly/runtime", () => ({
  requireNextly: () => nextly,
}));

import { LIBRARY_PAGE_SIZE, componentLibraryRoute } from "./library-route";

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

/** A route context: who is asking, and which collections the host has. */
function contextAs(
  user: PluginRouteContext["user"],
  authenticatedScope?: PluginRouteContext["authenticatedScope"]
): PluginRouteContext {
  return {
    self: { collections: {} },
    user,
    ...(authenticatedScope === undefined ? {} : { authenticatedScope }),
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
      disableErrors: true,
    });
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
      limit: LIBRARY_PAGE_SIZE,
    });
  });

  it("carries an API key's own scope on both reads", async () => {
    // A key is judged on the grants stamped on IT, and `user` alone names its
    // owner — so without the scope a viewer-scoped key minted by an
    // administrator would read as the administrator.
    const scope = { actorType: "apiKey", permissions: ["read-components"] };

    await componentLibraryRoute().handler(
      request,
      contextAs({ id: "u1", email: "u1@example.test" } as never, scope as never)
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
