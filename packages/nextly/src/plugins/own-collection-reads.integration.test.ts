/**
 * A plugin reads the collections it declared without the site's read hooks
 * shaping the read.
 *
 * A plugin's bookkeeping — a usage index, a backfill cursor — is counted to
 * decide something, such as whether a component is still in use. A site hook
 * that narrows every read to one tenant, retargets a read by id or rewrites the
 * document makes that count read low while looking exact. The grant is
 * structural: `ctx.services.ownCollections` reads only what the plugin declared,
 * and the ordinary `ctx.services.collections` path keeps every hook, which is
 * each test's control.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../config";
import { getFilterRegistry, resetFilterRegistry } from "../filters";
import type { HookHandler } from "../hooks/types";

import {
  createPluginContext,
  definePlugin,
  type PluginContext,
} from "./plugin-context";
import { createTestNextly, type TestNextly } from "./test-nextly";

// Suite-local slugs: integration files share fixed system-table names.
const OWNED = "ownread_ledger";
const FOREIGN = "ownread_foreign";
const SITE = "ownread_site";

let current: TestNextly | undefined;
let owner: PluginContext | undefined;
let fieldHookOn = false;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  owner = undefined;
  fieldHookOn = false;
  resetFilterRegistry();
});

async function boot(): Promise<{ t: TestNextly; ctx: PluginContext }> {
  const reader = definePlugin({
    name: "@test/own-reader",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      collections: [
        defineCollection({
          slug: OWNED,
          fields: [
            text({ name: "title" }),
            text({ name: "tenant" }),
            text({
              name: "note",
              hooks: {
                afterRead: [
                  ({ value }) => (fieldHookOn ? "field-hooked" : value),
                ],
              },
            }),
          ],
        }),
      ],
    },
    init(ctx) {
      owner = ctx;
    },
  });
  const other = definePlugin({
    name: "@test/other-plugin",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      collections: [
        defineCollection({ slug: FOREIGN, fields: [text({ name: "title" })] }),
      ],
    },
  });
  const t = await createTestNextly({
    plugins: [reader, other],
    collections: [
      defineCollection({ slug: SITE, fields: [text({ name: "title" })] }),
    ],
  });
  current = t;
  await t.nextly.create({
    collection: OWNED,
    data: { title: "A", tenant: "a", note: "plain" },
  });
  await t.nextly.create({
    collection: OWNED,
    data: { title: "B", tenant: "b", note: "plain" },
  });
  if (!owner) throw new Error("the owning plugin's init never ran");
  return { t, ctx: owner };
}

const titles = (rows: readonly Record<string, unknown>[]): string[] =>
  rows.map(row => String(row.title)).sort();

async function idOf(ctx: PluginContext, title: string): Promise<string> {
  const { data } = await ctx.services.ownCollections.listEntries(OWNED);
  const row = data.find(entry => entry.title === title);
  if (!row) throw new Error(`no row titled ${title}`);
  return String(row.id);
}

describe("a plugin's read of its own collections", () => {
  it("is not narrowed by a site beforeRead hook", async () => {
    const { t, ctx } = await boot();
    const narrow: HookHandler = hook => ({
      ...(hook.data as Record<string, unknown>),
      tenant: { equals: "a" },
    });
    t.hooks.register("beforeRead", "*", narrow);

    const own = await ctx.services.ownCollections.listEntries(OWNED);
    expect(titles(own.data)).toEqual(["A", "B"]);
    expect(await ctx.services.ownCollections.count(OWNED)).toBe(2);

    // The control: the same hook narrows the ordinary read.
    const ordinary = await ctx.services.collections.listEntries(
      OWNED,
      {},
      { as: "system" }
    );
    expect(titles(ordinary.data)).toEqual(["A"]);
  });

  it("is neither narrowed nor retargeted by a site beforeOperation hook", async () => {
    const { t, ctx } = await boot();
    const idA = await idOf(ctx, "A");
    const idB = await idOf(ctx, "B");
    t.hooks.registerBeforeOperation(OWNED, hook => {
      const args = hook.args as Record<string, unknown>;
      return "id" in args
        ? { ...args, id: idA }
        : { ...args, where: { tenant: { equals: "a" } } };
    });

    const own = await ctx.services.ownCollections.findEntryById(OWNED, idB);
    expect(own.title).toBe("B");
    expect(
      titles((await ctx.services.ownCollections.listEntries(OWNED)).data)
    ).toEqual(["A", "B"]);

    const ordinary = await ctx.services.collections.findEntryById(OWNED, idB, {
      as: "system",
    });
    expect(ordinary.title).toBe("A");
  });

  it("is not rewritten by a site afterRead hook", async () => {
    const { t, ctx } = await boot();
    const idA = await idOf(ctx, "A");
    const rewrite: HookHandler = hook =>
      Array.isArray(hook.data)
        ? (hook.data as Record<string, unknown>[]).map(row => ({
            ...row,
            title: "hooked",
          }))
        : { ...(hook.data as Record<string, unknown>), title: "hooked" };
    t.hooks.register("afterRead", "*", rewrite);

    const own = await ctx.services.ownCollections.listEntries(OWNED);
    expect(titles(own.data)).toEqual(["A", "B"]);
    expect(
      (await ctx.services.ownCollections.findEntryById(OWNED, idA)).title
    ).toBe("A");

    const ordinary = await ctx.services.collections.findEntryById(OWNED, idA, {
      as: "system",
    });
    expect(ordinary.title).toBe("hooked");
  });

  it("is not rewritten by a field-level afterRead hook", async () => {
    const { ctx } = await boot();
    fieldHookOn = true;

    const own = await ctx.services.ownCollections.listEntries(OWNED);
    expect(own.data.map(row => row.note)).toEqual(["plain", "plain"]);

    const ordinary = await ctx.services.collections.listEntries(
      OWNED,
      {},
      { as: "system" }
    );
    expect(ordinary.data.map(row => row.note)).toEqual([
      "field-hooked",
      "field-hooked",
    ]);
  });

  it("is not narrowed by a list-query filter", async () => {
    const { ctx } = await boot();
    getFilterRegistry().addFilter(
      "collections.listQuery",
      (where: Record<string, unknown>) => ({
        ...where,
        tenant: { equals: "a" },
      })
    );

    const own = await ctx.services.ownCollections.listEntries(OWNED);
    expect(titles(own.data)).toEqual(["A", "B"]);

    const ordinary = await ctx.services.collections.listEntries(
      OWNED,
      {},
      { as: "system" }
    );
    expect(titles(ordinary.data)).toEqual(["A"]);
  });

  it("keeps each read's own hooks when an exempt and an ordinary read run at once", async () => {
    const { t, ctx } = await boot();
    const slowNarrow: HookHandler = async hook => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return {
        ...(hook.data as Record<string, unknown>),
        tenant: { equals: "a" },
      };
    };
    t.hooks.register("beforeRead", "*", slowNarrow);

    const [own, ordinary, ownAgain] = await Promise.all([
      ctx.services.ownCollections.listEntries(OWNED),
      ctx.services.collections.listEntries(OWNED, {}, { as: "system" }),
      ctx.services.ownCollections.listEntries(OWNED),
    ]);
    expect(titles(own.data)).toEqual(["A", "B"]);
    expect(titles(ordinary.data)).toEqual(["A"]);
    expect(titles(ownAgain.data)).toEqual(["A", "B"]);
  });
});

describe("what a plugin may read without hooks", () => {
  it("refuses a collection another plugin declared", async () => {
    const { ctx } = await boot();
    await expect(
      ctx.services.ownCollections.listEntries(FOREIGN)
    ).rejects.toThrow(/not a collection this plugin declared/);
    await expect(ctx.services.ownCollections.count(FOREIGN)).rejects.toThrow(
      /not a collection this plugin declared/
    );
  });

  it("refuses an app collection", async () => {
    const { ctx } = await boot();
    await expect(
      ctx.services.ownCollections.findEntryById(SITE, "any")
    ).rejects.toThrow(/not a collection this plugin declared/);
  });

  it("cannot be claimed by app code passing a grant-shaped context to the raw facade", async () => {
    // `getService` is a public export, so app code can reach the collection
    // facade and hand it any context it builds. A copied grant must waive
    // nothing: the hook below still narrows the read.
    const { t } = await boot();
    const narrow: HookHandler = hook => ({
      ...(hook.data as Record<string, unknown>),
      tenant: { equals: "a" },
    });
    t.hooks.register("beforeRead", "*", narrow);
    const facade = t.getService("collectionService") as unknown as {
      listEntries: (
        slug: string,
        options: object,
        context: Record<string, unknown>
      ) => Promise<{ data: Record<string, unknown>[] }>;
    };

    const forged = await facade.listEntries(
      OWNED,
      {},
      { overrideAccess: true, hookExemptRead: { grant: "hook-exempt-read" } }
    );
    expect(titles(forged.data)).toEqual(["A"]);
  });

  it("grants nothing to a context built without a plugin", async () => {
    const { t } = await boot();
    // Built the way the auth bridge builds its context: with no plugin. The
    // refusal comes before any service is used, so the services are stand-ins.
    const bare = createPluginContext(
      (() => ({})) as unknown as Parameters<typeof createPluginContext>[0],
      t.hooks
    );
    await expect(
      bare.services.ownCollections.listEntries(OWNED)
    ).rejects.toThrow(/not a collection this plugin declared/);
  });
});
