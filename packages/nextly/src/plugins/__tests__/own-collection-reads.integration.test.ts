/**
 * A plugin reads the collections it declared without any configured read hook
 * shaping the read, on every dialect.
 *
 * A plugin's bookkeeping (a usage index, a backfill cursor) is read to decide
 * something, such as whether a component is still in use. A site hook that
 * narrows every read to one tenant, retargets a read by id or rewrites the
 * document makes that answer wrong while it looks exact. Each test switches on
 * one kind of hook and reads twice: through `ctx.services.ownCollections`,
 * which must see what is stored, and through `ctx.services.collections`, the
 * control, which must still be shaped by that hook. A control that stopped
 * being shaped would mean the hook never ran, and the own read's answer would
 * prove nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAsPrincipal } from "../../auth/principal-scope";
import {
  defineCollection,
  json,
  password,
  relationship,
  text,
} from "../../config";
import { getFilterRegistry, resetFilterRegistry } from "../../filters";
import { StoredHookExecutor } from "../../hooks/stored-hook-executor";
import type { FieldHookContext, HookHandler } from "../../hooks/types";
import { definePlugin, type PluginContext } from "../plugin-context";
import type { Principal } from "../principals/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

// Suite-local slugs: integration files share fixed system-table names.
const OWNED = "ownread_ledger";
const FOREIGN = "ownread_foreign";
const SITE = "ownread_site";

/** Which test-controlled hooks are switched on for the current test. */
const on = new Set<"field" | "owner" | "related">();
/** What the related row's field hook saw, each time it ran. */
const relatedHookSaw: { user: unknown; principal: unknown }[] = [];
/** Every hook the dependent plugin's refused read could have reached. */
const hookCalls: string[] = [];

let current: TestNextly | undefined;
let owner: PluginContext | undefined;
let dependent: PluginContext | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  owner = undefined;
  dependent = undefined;
  on.clear();
  relatedHookSaw.length = 0;
  hookCalls.length = 0;
  resetFilterRegistry();
});

async function boot(
  dialect: TestDialect
): Promise<{ t: TestNextly; ctx: PluginContext; siteId: string }> {
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
                  ({ value }: FieldHookContext) =>
                    on.has("field") ? "field-hooked" : value,
                ],
              },
            }),
            json({ name: "meta" }),
            password({ name: "pin" }),
            relationship({ name: "site", relationTo: SITE }),
          ],
        }),
      ],
    },
    init(ctx) {
      owner = ctx;
      // The owning plugin's own afterRead: its own bookkeeping read skips it
      // too, since a count it adds on read would reshape the answer as well.
      ctx.hooks.on("afterRead", OWNED, hook =>
        on.has("owner") && Array.isArray(hook.data)
          ? (hook.data as Record<string, unknown>[]).map(row => ({
              ...row,
              title: "owner-hooked",
            }))
          : undefined
      );
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
  const follower = definePlugin({
    name: "@test/depends-on-reader",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { "@test/own-reader": ">=0.0.0" },
    init(ctx) {
      dependent = ctx;
    },
  });
  const t = await createTestNextly({
    dialect,
    plugins: [reader, other, follower],
    collections: [
      defineCollection({
        slug: SITE,
        fields: [
          text({
            name: "caption",
            hooks: {
              afterRead: [
                ({ value, user, principal }: FieldHookContext) => {
                  if (!on.has("related")) return value;
                  relatedHookSaw.push({ user, principal });
                  return "related-hooked";
                },
              ],
            },
          }),
        ],
      }),
    ],
  });
  current = t;
  const site = await t.nextly.create({
    collection: SITE,
    data: { caption: "stored-caption" },
  });
  const siteId = String(site.item.id);
  await t.nextly.create({
    collection: OWNED,
    data: {
      title: "A",
      tenant: "a",
      note: "plain",
      meta: { kind: "x" },
      pin: "1234-secret",
      site: siteId,
    },
  });
  await t.nextly.create({
    collection: OWNED,
    data: { title: "B", tenant: "b", note: "plain", meta: { kind: "y" } },
  });
  if (!owner) throw new Error("the owning plugin's init never ran");
  return { t, ctx: owner, siteId };
}

const titles = (rows: readonly Record<string, unknown>[]): string[] =>
  rows.map(row => String(row.title)).sort();

async function idOf(ctx: PluginContext, title: string): Promise<string> {
  const { data } = await ctx.services.ownCollections.listEntries(OWNED);
  const row = data.find(entry => entry.title === title);
  if (!row) throw new Error(`no row titled ${title}`);
  return String(row.id);
}

const tenantA: HookHandler = hook => ({
  ...(hook.data as Record<string, unknown>),
  tenant: { equals: "a" },
});

describe.each(getConfiguredTestDialects())(
  "a plugin's read of its own collections (%s)",
  dialect => {
    it("is not narrowed by a global beforeRead filter, in any of the four reads", async () => {
      const { t, ctx } = await boot(dialect);
      t.hooks.register("beforeRead", "*", tenantA);
      const own = ctx.services.ownCollections;

      expect(titles((await own.listEntries(OWNED)).data)).toEqual(["A", "B"]);
      expect(await own.count(OWNED)).toBe(2);
      const grouped = await own.group(OWNED, { groupBy: "tenant" });
      expect(
        grouped.buckets.map(bucket => [bucket.value, bucket.count]).sort()
      ).toEqual([
        ["a", 1],
        ["b", 1],
      ]);
      const idB = await idOf(ctx, "B");
      expect((await own.findEntryById(OWNED, idB)).title).toBe("B");

      // The control: the same hook narrows the ordinary read and its count.
      const ordinary = ctx.services.collections;
      expect(
        titles((await ordinary.listEntries(OWNED, {}, { as: "system" })).data)
      ).toEqual(["A"]);
      expect(await ordinary.count(OWNED, {}, { as: "system" })).toBe(1);
    });

    it("is not narrowed by the collection's own beforeRead filter", async () => {
      const { t, ctx } = await boot(dialect);
      t.hooks.register("beforeRead", OWNED, tenantA);

      expect(await ctx.services.ownCollections.count(OWNED)).toBe(2);
      expect(
        await ctx.services.collections.count(OWNED, {}, { as: "system" })
      ).toBe(1);
    });

    it("is neither narrowed nor retargeted by a beforeOperation hook", async () => {
      const { t, ctx } = await boot(dialect);
      const idA = await idOf(ctx, "A");
      const idB = await idOf(ctx, "B");
      t.hooks.registerBeforeOperation(OWNED, hook => {
        const args = hook.args as Record<string, unknown>;
        return "id" in args
          ? { ...args, id: idA }
          : { ...args, where: { tenant: { equals: "a" } } };
      });
      const own = ctx.services.ownCollections;

      expect((await own.findEntryById(OWNED, idB)).title).toBe("B");
      expect(titles((await own.listEntries(OWNED)).data)).toEqual(["A", "B"]);

      const ordinary = await ctx.services.collections.findEntryById(
        OWNED,
        idB,
        { as: "system" }
      );
      expect(ordinary.title).toBe("A");
    });

    it("is not rewritten by a global afterRead hook", async () => {
      const { t, ctx } = await boot(dialect);
      const idA = await idOf(ctx, "A");
      const rewrite: HookHandler = hook =>
        Array.isArray(hook.data)
          ? (hook.data as Record<string, unknown>[]).map(row => ({
              ...row,
              title: "hooked",
            }))
          : { ...(hook.data as Record<string, unknown>), title: "hooked" };
      t.hooks.register("afterRead", "*", rewrite);
      const own = ctx.services.ownCollections;

      expect(titles((await own.listEntries(OWNED)).data)).toEqual(["A", "B"]);
      expect((await own.findEntryById(OWNED, idA)).title).toBe("A");

      const ordinary = await ctx.services.collections.findEntryById(
        OWNED,
        idA,
        { as: "system" }
      );
      expect(ordinary.title).toBe("hooked");
    });

    it("is not rewritten by the owning plugin's own afterRead hook", async () => {
      const { ctx } = await boot(dialect);
      on.add("owner");

      expect(
        titles((await ctx.services.ownCollections.listEntries(OWNED)).data)
      ).toEqual(["A", "B"]);
      expect(
        titles(
          (
            await ctx.services.collections.listEntries(
              OWNED,
              {},
              { as: "system" }
            )
          ).data
        )
      ).toEqual(["owner-hooked", "owner-hooked"]);
    });

    it("is not rewritten by a field hook set in config", async () => {
      const { ctx } = await boot(dialect);
      on.add("field");

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

    it("never enters the stored afterRead phase", async () => {
      const { ctx } = await boot(dialect);
      const idA = await idOf(ctx, "A");
      // No pre-built hook runs on afterRead, so a stored one cannot change a
      // value today; what is observable is whether the phase is entered.
      const execute = vi.spyOn(StoredHookExecutor.prototype, "execute");
      const afterReadCalls = () =>
        execute.mock.calls.filter(([phase]) => phase === "afterRead").length;

      await ctx.services.ownCollections.listEntries(OWNED);
      await ctx.services.ownCollections.findEntryById(OWNED, idA);
      expect(afterReadCalls()).toBe(0);

      await ctx.services.collections.listEntries(OWNED, {}, { as: "system" });
      expect(afterReadCalls()).toBe(1);
    });

    it("is not narrowed by a list-query filter", async () => {
      const { ctx } = await boot(dialect);
      getFilterRegistry().addFilter(
        "collections.listQuery",
        (where: Record<string, unknown>) => ({
          ...where,
          tenant: { equals: "a" },
        })
      );

      expect(
        titles((await ctx.services.ownCollections.listEntries(OWNED)).data)
      ).toEqual(["A", "B"]);
      expect(
        titles(
          (
            await ctx.services.collections.listEntries(
              OWNED,
              {},
              { as: "system" }
            )
          ).data
        )
      ).toEqual(["A"]);
    });

    it("keeps what each field's type does to make a stored value readable", async () => {
      const { ctx } = await boot(dialect);
      const idA = await idOf(ctx, "A");
      const row = await ctx.services.ownCollections.findEntryById(OWNED, idA);

      // Decoding: SQLite stores JSON as text, and the read hands back the value.
      expect(row.meta).toEqual({ kind: "x" });
      // Casing: the timestamp columns arrive in their API form.
      expect(row).toHaveProperty("createdAt");
      expect(row).not.toHaveProperty("created_at");
      // Redaction: a password's stored hash never leaves the read.
      expect(row).not.toHaveProperty("pin");
      expect(JSON.stringify(row)).not.toContain("1234-secret");
    });

    it("keeps a related row's own hooks, run as the system inside a person's request", async () => {
      const { ctx } = await boot(dialect);
      on.add("related");
      const idA = await idOf(ctx, "A");
      relatedHookSaw.length = 0;
      const person = {
        id: "p-request",
        kind: "member",
      } as unknown as Principal;

      const row = await runAsPrincipal(person, () =>
        ctx.services.ownCollections.listEntries(OWNED, {
          where: { id: { equals: idA } },
          depth: 1,
        })
      );
      const related = row.data[0]?.site as Record<string, unknown> | undefined;

      expect(related?.caption).toBe("related-hooked");
      expect(relatedHookSaw.length).toBeGreaterThan(0);
      for (const saw of relatedHookSaw) {
        expect(saw.user).toBeUndefined();
        expect(saw.principal).toBeUndefined();
      }
    });

    it("keeps each read's own hooks when a granted and an ordinary read run at once", async () => {
      const { t, ctx } = await boot(dialect);
      const slowNarrow: HookHandler = async hook => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return tenantA(hook);
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
  }
);

describe.each(getConfiguredTestDialects())(
  "who may read a collection without its hooks (%s)",
  dialect => {
    it("refuses a collection another plugin declared, and an app collection", async () => {
      const { ctx, siteId } = await boot(dialect);
      await expect(
        ctx.services.ownCollections.listEntries(FOREIGN)
      ).rejects.toThrow(/not a collection this plugin declared/);
      await expect(
        ctx.services.ownCollections.group(FOREIGN, { groupBy: "title" })
      ).rejects.toThrow(/not a collection this plugin declared/);
      await expect(
        ctx.services.ownCollections.findEntryById(SITE, siteId)
      ).rejects.toThrow(/not a collection this plugin declared/);
    });

    it("refuses a plugin that depends on the owner, before any hook runs", async () => {
      const { t } = await boot(dialect);
      if (!dependent) throw new Error("the dependent plugin's init never ran");
      const record =
        (name: string): HookHandler =>
        () => {
          hookCalls.push(name);
          return undefined;
        };
      t.hooks.register("beforeRead", OWNED, record("beforeRead"));
      t.hooks.register("afterRead", OWNED, record("afterRead"));
      t.hooks.registerBeforeOperation(OWNED, () => {
        hookCalls.push("beforeOperation");
        return undefined;
      });

      await expect(
        dependent.services.ownCollections.listEntries(OWNED)
      ).rejects.toThrow(/not a collection this plugin declared/);
      await expect(
        dependent.services.ownCollections.count(OWNED)
      ).rejects.toThrow(/not a collection this plugin declared/);
      expect(hookCalls).toEqual([]);

      // The control: an ordinary read reaches every one of those hooks.
      await dependent.services.collections.listEntries(
        OWNED,
        {},
        { as: "system" }
      );
      expect(hookCalls).toEqual(
        expect.arrayContaining(["beforeOperation", "beforeRead", "afterRead"])
      );
    });

    it("cannot be claimed by app code passing a grant-shaped context to the raw facade", async () => {
      // `getService` is a public export, so app code can reach the collection
      // facade and hand it any context it builds. A copied grant must waive
      // nothing: the hook below still narrows the read.
      const { t } = await boot(dialect);
      t.hooks.register("beforeRead", "*", tenantA);
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

    it("offers reads only", async () => {
      const { ctx } = await boot(dialect);
      expect(Object.keys(ctx.services.ownCollections).sort()).toEqual([
        "count",
        "findEntryById",
        "group",
        "listEntries",
      ]);
    });
  }
);
