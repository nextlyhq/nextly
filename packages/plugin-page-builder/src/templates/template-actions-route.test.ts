/**
 * `set-template-address`, judged with the instance stubbed: the routing
 * permission is asked before anything is read or written, a bad address is
 * refused in the guard's own words before any write, and a dry run of a
 * refused address answers the refusal rather than throwing.
 *
 * The write itself, its claims moving and the field rules taking an address
 * out of a save by someone without the permission, are proved against a real
 * instance by `__tests__/template-addresses-runtime.integration.test.ts`.
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  templateCollectionExistsPath,
  type TemplateActionResult,
} from "./template-actions-contract";
import {
  cutToTitleLength,
  readTemplateCollectionExists,
  readTemplateRoutingAccess,
  runTemplateAction,
  templateCollectionExistsRoute,
  type TemplateActionsContext,
  type TemplateActionsSetup,
} from "./template-actions-route";
import type { TemplateGuardSetup } from "./template-guard";

const stored = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  reads: 0,
  asked: [] as Record<string, unknown>[],
}));

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => ({
    findByID: async (args: Record<string, unknown>) => {
      stored.reads += 1;
      stored.asked.push(args);
      // The working draft only where it was asked for, as the Direct API
      // overlays it.
      return args.draft === true || stored.row?._isWorkingDraft !== true
        ? stored.row
        : { ...stored.row, _isWorkingDraft: undefined };
    },
  }),
}));

beforeEach(() => {
  stored.row = {
    id: "t1",
    title: "Events",
    collection: "events",
    status: "published",
    address: null,
  };
  stored.reads = 0;
  stored.asked = [];
});

/** A caller holding exactly `granted`, each as `<action>-<resource>`. */
function contextFor(granted: readonly string[]) {
  const asked: string[] = [];
  const updateEntry = vi.fn(async () => ({ item: stored.row }));
  const ctx = {
    user: { id: "u1" },
    caller: {
      authMethod: "session" as const,
      can: async (action: string, resource: string) => {
        asked.push(`${action}-${resource}`);
        return granted.includes(`${action}-${resource}`);
      },
      identity: async () => ({ user: { id: "u1" } }),
    },
    self: { collections: {}, singles: {} },
    services: {
      collections: {
        updateEntry,
        withTransaction: vi.fn(),
        updateEntryInTransaction: vi.fn(),
        getCollection: vi.fn(),
      },
    },
  } as unknown as TemplateActionsContext;
  return { ctx, asked, updateEntry };
}

function setupWith(guard: Partial<TemplateGuardSetup> = {}) {
  const addressHolderOf = vi.fn(async () => null);
  const setup: TemplateActionsSetup = {
    guard: () => ({
      templatesCollection: "templates",
      ownCollections: () => new Set(["templates"]),
      readCollection: async slug => ({
        slug,
        fields: [{ name: "slug", type: "text" }],
      }),
      holderOf: async () => null,
      declaredAddresses: new Map([["posts", "/blog"]]),
      holdEntry: async () => true,
      entryExists: async () => false,
      addressHolderOf,
      ...guard,
    }),
    waitingEntries: async () => 0,
  };
  return { setup, addressHolderOf };
}

/** The messages a refusal carries, as an API client reads them. */
function messagesOf(refused: unknown): string[] {
  if (!(refused instanceof NextlyError)) return ["no refusal"];
  const listed = (refused.publicData as { errors?: { message: string }[] })
    ?.errors;
  return listed?.map(item => item.message) ?? [refused.publicMessage];
}

const EVERY_TEMPLATE_RIGHT = ["read-templates", "update-templates"];

describe("set-template-address", () => {
  it("asks for the routing permission before reading or writing anything", async () => {
    const { ctx, asked, updateEntry } = contextFor(EVERY_TEMPLATE_RIGHT);
    const { setup, addressHolderOf } = setupWith();

    const refused = await runTemplateAction(
      ctx,
      {
        action: { kind: "set-template-address", id: "t1", address: "/events" },
      },
      setup
    ).then(
      () => null,
      (error: unknown) => error
    );

    expect(NextlyError.isForbidden(refused)).toBe(true);
    expect(asked[0]).toBe("manage-template-routing");
    expect(stored.reads).toBe(0);
    expect(addressHolderOf).not.toHaveBeenCalled();
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it("refuses a bad address in the guard's words, writing nothing", async () => {
    const { ctx, updateEntry } = contextFor([
      "manage-template-routing",
      ...EVERY_TEMPLATE_RIGHT,
    ]);
    const { setup } = setupWith();

    const refused = await runTemplateAction(
      ctx,
      { action: { kind: "set-template-address", id: "t1", address: "/blog/" } },
      setup
    ).then(
      () => null,
      (error: unknown) => error
    );

    expect(messagesOf(refused)).toEqual([
      '"/blog/" ends with "/": write it without one.',
    ]);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it("answers a dry run's refusals, naming the collection given the address in code", async () => {
    const { ctx, updateEntry } = contextFor([
      "manage-template-routing",
      ...EVERY_TEMPLATE_RIGHT,
    ]);
    const { setup } = setupWith();

    const answered = await runTemplateAction(
      ctx,
      {
        action: { kind: "set-template-address", id: "t1", address: "/blog" },
        dryRun: true,
      },
      setup
    );

    const item = answered.item as TemplateActionResult;
    expect(item.dryRun).toBe(true);
    expect(item.refusals).toEqual([
      '"/blog" is the address the collection "posts" is given in code. Each collection needs an address of its own.',
    ]);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it("refuses to change a published template's address while it holds unpublished changes", async () => {
    stored.row = { ...stored.row, _isWorkingDraft: true };
    const { ctx, updateEntry } = contextFor([
      "manage-template-routing",
      ...EVERY_TEMPLATE_RIGHT,
    ]);
    const { setup } = setupWith();

    const refused = await runTemplateAction(
      ctx,
      {
        action: { kind: "set-template-address", id: "t1", address: "/events" },
      },
      setup
    ).then(
      () => null,
      (error: unknown) => error
    );

    expect(messagesOf(refused)).toEqual([
      expect.stringMatching(/has unpublished changes/),
    ]);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it("writes the address to the live template, publishing nothing else", async () => {
    const { ctx, updateEntry } = contextFor([
      "manage-template-routing",
      ...EVERY_TEMPLATE_RIGHT,
    ]);
    const { setup } = setupWith();

    await runTemplateAction(
      ctx,
      {
        action: { kind: "set-template-address", id: "t1", address: "/events" },
      },
      setup
    );

    expect(updateEntry).toHaveBeenCalledOnce();
    const [, id, data] = updateEntry.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe("t1");
    expect(data).toMatchObject({ address: "/events", status: "published" });
  });
});

describe("set-template-address's answer", () => {
  it("still reports a committed write when counting the waiting entries fails", async () => {
    const { ctx, updateEntry } = contextFor([
      "manage-template-routing",
      ...EVERY_TEMPLATE_RIGHT,
    ]);
    const { setup } = setupWith();
    const answered = await runTemplateAction(
      ctx,
      {
        action: { kind: "set-template-address", id: "t1", address: "/events" },
      },
      {
        ...setup,
        waitingEntries: async () => {
          throw new Error("connection lost");
        },
      }
    );
    expect(updateEntry).toHaveBeenCalledOnce();
    const item = answered.item as TemplateActionResult;
    expect(item.dryRun).toBe(false);
    expect(item.waiting).toBeUndefined();
  });
});

describe("the routing question", () => {
  it("answers whether the caller holds the routing permission", async () => {
    const ask = (granted: boolean) =>
      readTemplateRoutingAccess({
        caller: { can: async () => granted },
      });
    expect(await ask(true)).toEqual({ mayManageRouting: true });
    expect(await ask(false)).toEqual({ mayManageRouting: false });
    expect(await readTemplateRoutingAccess({ caller: null })).toEqual({
      mayManageRouting: false,
    });
  });
});

describe("the collection question", () => {
  /** A guard whose registry holds `posts` alone, under a renamed templates slug. */
  function existenceGuard() {
    const readCollection = vi.fn((slug: string) =>
      Promise.resolve(slug === "posts" ? { slug: "posts" } : null)
    );
    const guard: TemplateGuardSetup = {
      templatesCollection: "site_templates",
      ownCollections: () => new Set(["site_templates"]),
      readCollection,
      holderOf: () => Promise.resolve(null),
      entryExists: () => Promise.resolve(true),
      holdEntry: () => Promise.resolve(true),
      declaredAddresses: new Map(),
      addressHolderOf: () => Promise.resolve(null),
    };
    return { guard, readCollection };
  }

  /** A caller granted `update` on `granted` and nothing else. */
  function callerFor(granted: string | null) {
    const can = vi.fn((action: string, resource: string) =>
      Promise.resolve(action === "update" && resource === granted)
    );
    return { can };
  }

  it("answers whether a collection exists, read by the guard's own lookup", async () => {
    const { guard, readCollection } = existenceGuard();
    const caller = callerFor("site_templates");
    expect(
      await readTemplateCollectionExists("posts", { caller, guard })
    ).toEqual({ exists: true });
    // Gone: what the guard lets a template be pointed away from.
    expect(
      await readTemplateCollectionExists("articles", { caller, guard })
    ).toEqual({ exists: false });
    expect(readCollection.mock.calls.map(([slug]) => slug)).toEqual([
      "posts",
      "articles",
    ]);
    // The right asked is updating the RESOLVED templates collection, as a
    // type-level question, since the read names no template.
    expect(caller.can).toHaveBeenCalledWith("update", "site_templates", {
      anyEntry: true,
    });
  });

  it("refuses a caller who may not update templates, before anything is read", async () => {
    const { guard, readCollection } = existenceGuard();
    for (const caller of [callerFor("templates"), callerFor(null), null]) {
      await expect(
        readTemplateCollectionExists("posts", { caller, guard })
      ).rejects.toSatisfy(error => NextlyError.isForbidden(error));
    }
    expect(readCollection).not.toHaveBeenCalled();
  });

  it("is served as a GET never stored, and refuses a query naming no collection", async () => {
    const { guard, readCollection } = existenceGuard();
    const route = templateCollectionExistsRoute({ guard: () => guard });
    expect(route.method).toBe("GET");
    expect(route).not.toHaveProperty("public");
    expect(route.noStore).toBe(true);
    const ctx = {
      caller: callerFor("site_templates"),
    } as unknown as PluginRouteContext;
    const get = (path: string) =>
      route.handler(new Request(`http://nextly.test/x${path}`), ctx);
    // The positive control: the refusals below would be met by a handler
    // that refuses everything.
    const answer = await get(templateCollectionExistsPath("posts"));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ exists: true });
    for (const path of [
      route.path,
      `${route.path}?collection=`,
      `${route.path}?collection=${"a".repeat(513)}`,
    ]) {
      await expect(get(path)).rejects.toSatisfy(error =>
        NextlyError.isValidation(error)
      );
    }
    expect(readCollection).toHaveBeenCalledOnce();
  });
});

describe("a derived title's length", () => {
  // An emoji is two UTF-16 units, the length the title field's `maxLength`
  // counts. A cut by characters keeps 128 of them, 256 units, which the
  // field refuses; a plain cut by units keeps half of the last one.
  const emoji = "\u{1F600}";

  it("is held to the units the title field counts", () => {
    const cut = cutToTitleLength(emoji.repeat(128), 255);
    expect(cut.length).toBeLessThanOrEqual(255);
    expect(cut).toBe(emoji.repeat(127));
  });

  it("keeps no half of a character the cut would split", () => {
    // 254 units of text, then an emoji across the 255th and 256th.
    const cut = cutToTitleLength(`${"a".repeat(254)}${emoji}b`, 255);
    expect(cut).toBe("a".repeat(254));
    const last = cut.charCodeAt(cut.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it("keeps an emoji that ends exactly at the limit, and a title that fits", () => {
    const fits = `${"a".repeat(253)}${emoji}`;
    expect(cutToTitleLength(`${fits}tail`, 255)).toBe(fits);
    expect(cutToTitleLength("Hello world", 255)).toBe("Hello world");
  });
});
