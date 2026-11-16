/**
 * A template address set at runtime: judged as a declared one is, held by
 * one collection, refused in the guard's words, and changed only by someone
 * holding the routing permission.
 *
 * That the unique index refuses a second template storing an address under
 * concurrent writes, and that a person without the permission cannot set or
 * change one through the API, are proved against a real instance on every
 * dialect by `__tests__/template-addresses-runtime.integration.test.ts`.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { JUDGEMENT_CONTEXT } from "../judged-writes";

import {
  addressCollectionProblem,
  addressHolderProblem,
  guardAddress,
  guardWrite,
  storedAddressesReader,
  type TemplateGuardSetup,
} from "./template-guard";
import {
  mayManageTemplateRouting,
  MANAGE_TEMPLATE_ROUTING_PERMISSION,
  storedAddressProblem,
} from "./template-routing";

function setup(
  overrides: Partial<TemplateGuardSetup> = {}
): TemplateGuardSetup {
  return {
    templatesCollection: "templates",
    ownCollections: () => new Set(["pages", "templates"]),
    // Every collection named here may have a template.
    readCollection: async slug => ({
      slug,
      fields: [{ name: "slug", type: "text" }],
    }),
    holderOf: async () => null,
    declaredAddresses: new Map([["posts", "/blog"]]),
    holdEntry: async () => true,
    entryExists: async () => false,
    addressHolderOf: async () => null,
    ...overrides,
  };
}

async function refusalOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof NextlyError)) throw error;
    const listed = (error.publicData as { errors?: { message: string }[] })
      ?.errors;
    return listed?.[0]?.message ?? error.publicMessage;
  }
  return "no refusal";
}

describe("the routing permission", () => {
  it("is named as the role screen spells it", () => {
    expect(MANAGE_TEMPLATE_ROUTING_PERMISSION).toBe("manage-template-routing");
  });

  it("admits a caller holding it, whatever their role is called", () => {
    expect(
      mayManageTemplateRouting({
        permissions: ["update-templates", "manage-template-routing"],
      })
    ).toBe(true);
  });

  it("refuses a caller who may update templates but not change routing", () => {
    expect(
      mayManageTemplateRouting({
        permissions: ["read-templates", "update-templates"],
      })
    ).toBe(false);
    expect(mayManageTemplateRouting({})).toBe(false);
  });

  it("reads no role: a role's name alone admits nobody", () => {
    const named = {
      roles: ["super-admin"],
      permissions: [],
    };
    expect(mayManageTemplateRouting(named)).toBe(false);
  });
});

describe("a stored address", () => {
  const judge = { declared: new Map([["posts", "/blog"]]) };

  it.each([
    ["/blog/", /ends with "\/"/],
    ["//blog", /scheme or a host/],
    ["/blog/../news", /"\." or "\.\." segment/],
    ["https://x/blog", /scheme or a host/],
    ["/admin/blog", /kept by the runtime/],
    ["/", /site's root/],
  ])("refuses %s, as a declared address is refused", (address, why) => {
    expect(storedAddressProblem(address, "events", judge)).toMatch(why);
  });

  it("refuses an address another collection is given in code, naming it", () => {
    expect(storedAddressProblem("/blog", "events", judge)).toBe(
      '"/blog" is the address the collection "posts" is given in code. Each collection needs an address of its own.'
    );
  });

  it("is no clash with the collection's own declared address", () => {
    expect(storedAddressProblem("/blog", "posts", judge)).toBeNull();
  });

  it("refuses a different address for a collection given its own in code", () => {
    expect(storedAddressProblem("/posts", "posts", judge)).toBe(
      'The collection "posts" is given its address in code (/blog): change it there.'
    );
  });

  it("accepts an address of its own", () => {
    expect(storedAddressProblem("/events", "events", judge)).toBeNull();
  });
});

describe("the address guard", () => {
  it("refuses an address another collection's template stores, naming that collection", async () => {
    const addressHolderOf = vi.fn(async () => ({
      id: "t-news",
      collection: "news",
    }));
    const words = await refusalOf(() =>
      guardAddress(setup({ addressHolderOf }), {
        operation: "update",
        data: { address: "/events" },
        originalData: { id: "t-events", collection: "events", address: null },
      })
    );
    expect(addressHolderOf).toHaveBeenCalledWith("/events");
    expect(words).toBe(
      '"/events" is already the address of the collection "news". Each collection needs an address of its own.'
    );
  });

  it("lets a template keep the address it stores", async () => {
    const addressHolderOf = vi.fn(async () => ({
      id: "t-events",
      collection: "events",
    }));
    await guardAddress(setup({ addressHolderOf }), {
      operation: "update",
      data: { address: "/events", title: "Renamed" },
      originalData: { id: "t-events", collection: "events", address: "/old" },
    });
    expect(addressHolderOf).toHaveBeenCalledOnce();
  });

  it("refuses a code-declared address of another collection before reading anything", async () => {
    const addressHolderOf = vi.fn(async () => null);
    const words = await refusalOf(() =>
      guardAddress(setup({ addressHolderOf }), {
        operation: "create",
        data: { collection: "events", address: "/blog" },
      })
    );
    expect(words).toMatch(/given in code/);
    expect(addressHolderOf).not.toHaveBeenCalled();
  });

  it.each([
    "/blog/",
    "//blog",
    "/blog/../news",
    "https://x/blog",
    "/admin/blog",
    "/",
  ])("refuses %s at save", async address => {
    const words = await refusalOf(() =>
      guardAddress(setup(), {
        operation: "create",
        data: { collection: "events", address },
      })
    );
    expect(words).not.toBe("no refusal");
  });

  it("stores an emptied address as none, and judges nothing", async () => {
    const addressHolderOf = vi.fn(async () => null);
    const written = await guardAddress(setup({ addressHolderOf }), {
      operation: "update",
      data: { address: "" },
      originalData: { id: "t1", collection: "events", address: "/events" },
    });
    expect(written).toEqual({ address: null });
    expect(addressHolderOf).not.toHaveBeenCalled();
  });

  it("leaves a write that does not name the address alone", async () => {
    expect(
      await guardAddress(setup(), {
        operation: "update",
        data: { title: "Only the title" },
        originalData: { id: "t1", collection: "events", address: "/blog" },
      })
    ).toBeUndefined();
  });

  it("refuses an address on a template that draws no collection", async () => {
    expect(addressHolderProblem({ collection: "" })).toMatch(
      /Only a collection's template has an address/
    );
    expect(addressHolderProblem({ collection: "events" })).toBeNull();
  });

  it("refuses an address on an entry's own design", async () => {
    expect(
      addressHolderProblem({
        collection: null,
        entry: "posts:p1",
        entryCollection: "posts",
        entryId: "p1",
      })
    ).toMatch(/own design has no address of its own/);
    const words = await refusalOf(() =>
      guardAddress(setup(), {
        operation: "update",
        data: { address: "/mine" },
        originalData: {
          id: "d1",
          entry: "posts:p1",
          entryCollection: "posts",
          entryId: "p1",
        },
      })
    );
    expect(words).toMatch(/own design has no address of its own/);
  });

  it("refuses to read inside a caller's transaction, but lets a judging write through", async () => {
    const words = await refusalOf(() =>
      guardAddress(setup(), {
        operation: "create",
        data: { collection: "events", address: "/events" },
        executor: {},
      })
    );
    expect(words).toMatch(/bulk operation/);
    const addressHolderOf = vi.fn(async () => null);
    await guardAddress(setup({ addressHolderOf }), {
      operation: "create",
      data: { collection: "events", address: "/events" },
      executor: {},
      context: { [JUDGEMENT_CONTEXT]: true },
    });
    expect(addressHolderOf).not.toHaveBeenCalled();
  });
});

describe("an address for a collection that may not have a template", () => {
  it("is refused, in the words a new template's collection is refused in", async () => {
    const words = await refusalOf(() =>
      guardAddress(setup({ readCollection: async () => null }), {
        operation: "update",
        data: { address: "/events" },
        originalData: { id: "t1", collection: "events", address: null },
      })
    );
    expect(words).toBe('There is no collection "events" to give a template.');
  });
});

describe("a collection's eligibility for an address", () => {
  it("is judged from one read of its record", async () => {
    const readCollection = vi.fn(async (slug: string) => ({
      slug,
      fields: [{ name: "slug", type: "text" }],
      localized: true,
    }));
    expect(
      await addressCollectionProblem(setup({ readCollection }), "events")
    ).toMatch(/is localized/);
    expect(readCollection).toHaveBeenCalledOnce();
  });
});

describe("pointing an addressed template at another collection", () => {
  it("is refused while the template stores an address", async () => {
    const readCollection = vi.fn(async () => null);
    const words = await refusalOf(() =>
      guardWrite(setup({ readCollection }), {
        operation: "update",
        data: { collection: "events" },
        originalData: { id: "t1", collection: "gone", address: "/gone" },
      })
    );
    expect(words).toBe(
      "This template serves its collection's entries at /gone. Remove its address before pointing it at another collection."
    );
    expect(readCollection).toHaveBeenCalledWith("gone");
  });

  it("is refused for its collection, not its address, while that collection exists", async () => {
    // Removing the address would not let this change through, so the
    // refusal does not send the editor to take the address down.
    const words = await refusalOf(() =>
      guardWrite(setup({ readCollection: async slug => ({ slug }) }), {
        operation: "update",
        data: { collection: "events" },
        originalData: { id: "t1", collection: "news", address: "/news" },
      })
    );
    expect(words).toBe(
      "A template's collection cannot be changed while that collection exists. Create a template for the other collection instead."
    );
  });

  it("is refused by its address alone inside a judged transaction, reading nothing", async () => {
    const readCollection = vi.fn(async () => null);
    const words = await refusalOf(() =>
      guardWrite(setup({ readCollection }), {
        operation: "update",
        data: { collection: "events" },
        originalData: { id: "t1", collection: "gone", address: "/gone" },
        executor: {},
        context: { [JUDGEMENT_CONTEXT]: true },
      })
    );
    expect(words).toMatch(/Remove its address/);
    expect(readCollection).not.toHaveBeenCalled();
  });

  it("is judged as before once the same write removes the address", async () => {
    const words = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "update",
        data: { collection: "events", address: null },
        originalData: { id: "t1", collection: "gone", address: "/gone" },
      })
    );
    expect(words).not.toMatch(/Remove its address/);
  });
});

describe("every stored address", () => {
  it("is read in a unique order, so no template moves between pages", async () => {
    const asked: Record<string, unknown>[] = [];
    const read = storedAddressesReader(
      {
        listEntries: async (_slug, options) => {
          asked.push(options);
          return {
            data: [
              { id: "t1", collection: "events", address: "/events" },
              { id: "t2", collection: "news", address: null },
            ],
          };
        },
      },
      "templates"
    );
    expect([...(await read()).entries()]).toEqual([["events", "/events"]]);
    expect(asked[0]?.sort).toEqual({ field: "id", direction: "asc" });
  });
});
