/**
 * A plugin takes part in deleting a collection through
 * `ctx.hooks.onCollectionDelete`, on every dialect.
 *
 * The plugin keeps "designs" naming a collection by slug in a collection of
 * its own. Its `impact` names them for the delete dialog, which asks the
 * collections endpoint (`previewCollectionDelete`), and its `inTransaction`
 * removes them with the collection.
 *
 * The separating property is that the removal is part of the delete's own
 * transaction: when a later handler throws, the delete is refused and the
 * designs the first handler deleted are back, with the collection still
 * registered. A removal made on a transaction or connection of its own would
 * have committed and left them gone. The handler runs before the delete's
 * first table drop, so this holds on MySQL too.
 *
 * @module domains/collections/__tests__/collection-delete-plugin-hook.integration.test
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import type { CollectionRegistryService } from "../services/collection-registry-service";

// Suite-local slugs: integration files share fixed system-table names.
const HOST = "cdh_posts";
const KEPT = "cdh_pages";
const DESIGNS = "cdh_designs";
const DESIGNER = "@test/designer";

/** Whether the second plugin refuses the delete. */
const refusing = { on: false };
/**
 * When set, the second plugin's handler says it was reached and waits for
 * `gate`, holding the delete open inside its transaction.
 */
const pausing: {
  at?: { reached: () => void; gate: Promise<void> };
} = {};
/** The designer's context, for a write of its own beside the delete. */
let designerContext: PluginContext | undefined;
/** The slugs the designer's `inTransaction` was called for. */
const handled: string[] = [];

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  refusing.on = false;
  pausing.at = undefined;
  designerContext = undefined;
  handled.length = 0;
  await current?.destroy();
  current = undefined;
});

/** The designs naming `slug`, read by the designer on the transaction or the pool. */
const naming = (slug: string) => ({
  where: { target: { equals: slug } },
  pagination: { limit: 100 },
});

/**
 * Boot the designer, which keeps designs naming a collection and removes
 * them with it, and a second plugin that refuses the delete while
 * `refusing.on`, registered after it so it runs after the designer's removal.
 */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  let designer: PluginContext | undefined;
  const t = await createTestNextly({
    dialect,
    collections: [
      defineCollection({ slug: HOST, fields: [text({ name: "title" })] }),
      defineCollection({ slug: KEPT, fields: [text({ name: "title" })] }),
    ],
    plugins: [
      definePlugin({
        name: DESIGNER,
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          collections: [
            defineCollection({
              slug: DESIGNS,
              fields: [text({ name: "title" }), text({ name: "target" })],
            }),
          ],
        },
        init(ctx) {
          designer = ctx;
          ctx.hooks.onCollectionDelete({
            impact: async slug => {
              const { data } = await ctx.services.ownCollections.listEntries(
                DESIGNS,
                naming(slug)
              );
              return data.map(row => ({
                label: String(row.title),
                kind: "design",
              }));
            },
            inTransaction: async ({ slug, transaction }) => {
              handled.push(slug);
              const own = ctx.services.ownCollections;
              const { data } = await own.listEntriesInTransaction(
                transaction,
                DESIGNS,
                naming(slug),
                { lock: "update" }
              );
              for (const row of data) {
                await ctx.services.collections.deleteEntryInTransaction(
                  transaction,
                  DESIGNS,
                  String(row.id),
                  {}
                );
              }
            },
          });
        },
      }),
      definePlugin({
        name: "@test/refuser",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx) {
          ctx.hooks.onCollectionDelete({
            inTransaction: async () => {
              if (pausing.at) {
                pausing.at.reached();
                await pausing.at.gate;
              }
              if (refusing.on) {
                throw NextlyError.conflict({
                  message: "The refuser holds this collection.",
                });
              }
            },
          });
        },
      }),
    ],
  });
  current = t;
  if (!designer) throw new Error("the designer's init did not run");
  designerContext = designer;
  for (const [title, target] of [
    ["Home design", HOST],
    ["About design", HOST],
    ["Pages design", KEPT],
  ]) {
    await t.nextly.create({ collection: DESIGNS, data: { title, target } });
  }
  // Code-first rows are locked; the Builder's delete reaches only unlocked ones.
  await t.adapter.update(
    "dynamic_collections",
    { locked: 0 },
    { and: [{ column: "slug", op: "IN", value: [HOST, KEPT] }] }
  );
  clearRegistryRowCache();
  return t;
}

/** The designs' titles, as stored. */
async function designTitles(t: TestNextly): Promise<string[]> {
  const found = await t.nextly.find({
    collection: DESIGNS,
    limit: 100,
    overrideAccess: true,
  });
  return found.items.map(row => String(row.title)).sort();
}

const registered = async (t: TestNextly, slug: string) =>
  (await (
    t.getService("collectionRegistryService") as CollectionRegistryService
  ).getCollectionBySlug(slug)) !== null;

/** The Builder's delete of `slug`, through the dispatcher the admin reaches. */
const builderDelete = (slug: string) =>
  dispatchCollections(
    {} as ServiceContainer,
    "deleteCollection",
    { collectionName: slug },
    undefined
  );

describeEachDialect("a plugin's collection-delete hook", dialect => {
  it("names what the delete takes with it at the dialog's endpoint, deleting nothing", async () => {
    const t = await boot(dialect);

    const response = (await dispatchCollections(
      {} as ServiceContainer,
      "previewCollectionDelete",
      { collectionName: HOST },
      undefined
    )) as Response;
    const body = (await response.json()) as {
      impact: { plugin: string; items: { label: string; kind: string }[] }[];
    };

    expect(body.impact).toHaveLength(1);
    expect(body.impact[0]?.plugin).toBe(DESIGNER);
    expect(
      body.impact[0]?.items.map(item => `${item.kind}:${item.label}`).sort()
    ).toEqual(["design:About design", "design:Home design"]);
    expect(handled).toEqual([]);
    expect(await designTitles(t)).toEqual([
      "About design",
      "Home design",
      "Pages design",
    ]);
  });

  it("removes the plugin's rows in the delete's transaction", async () => {
    const t = await boot(dialect);

    await builderDelete(HOST);

    expect(handled).toEqual([HOST]);
    expect(await designTitles(t)).toEqual(["Pages design"]);
    expect(await registered(t, HOST)).toBe(false);
  });

  it("rolls the delete back, the plugin's removal with it, when a handler throws", async () => {
    const t = await boot(dialect);
    refusing.on = true;

    const refused = await builderDelete(HOST).then(
      () => undefined,
      (error: unknown) => error
    );

    // The designer ran and deleted its rows before the refuser threw.
    expect(handled).toEqual([HOST]);
    expect(NextlyError.is(refused)).toBe(true);
    expect(await designTitles(t)).toEqual([
      "About design",
      "Home design",
      "Pages design",
    ]);
    expect(await registered(t, HOST)).toBe(true);
    // The control: without the refusal the same delete goes through.
    refusing.on = false;
    clearRegistryRowCache();
    await builderDelete(HOST);
    expect(await designTitles(t)).toEqual(["Pages design"]);
  });

  it("holds a collection a write names until its delete ends, then answers it gone", async () => {
    await boot(dialect);
    const plugin = designerContext;
    if (!plugin) throw new Error("not booted");
    const collections = plugin.services.collections;
    const hold = () =>
      collections.withTransaction(tx =>
        collections.holdCollectionInTransaction(tx, HOST)
      );
    // The control: before any delete, the collection is there.
    expect(await hold()).toBe(true);

    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let reached!: () => void;
    const inDelete = new Promise<void>(resolve => (reached = resolve));
    pausing.at = { reached, gate };
    const deleting = builderDelete(HOST);
    await inDelete;
    // Asked while the delete holds the registry row and has not yet removed
    // it: a hold that took no lock would answer that the collection exists.
    const held = hold();
    await new Promise(resolve => setTimeout(resolve, 200));
    release();
    await deleting;

    expect(await held).toBe(false);
  });

  it("goes on holding the collection past the delete's table drop, in development", async () => {
    const t = await boot(dialect);
    const plugin = designerContext;
    if (!plugin) throw new Error("not booted");
    const collections = plugin.services.collections;
    // Each transaction's statements, with the delete held just after it
    // drops HOST's table: on MySQL that drop has committed the transaction
    // so far, row locks included, while the registry row is still there.
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let reached!: () => void;
    const dropped = new Promise<void>(resolve => (reached = resolve));
    const dropOfHost = new RegExp(
      `DROP TABLE IF EXISTS [\`"]dc_${HOST}[\`"](\\s+CASCADE)?;?\\s*$`
    );
    const transaction = t.adapter.transaction.bind(t.adapter);
    vi.spyOn(t.adapter, "transaction").mockImplementation((work, options) =>
      transaction(
        tx =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key === "execute") {
                  return async (
                    statement: string,
                    params?: Parameters<TransactionContext["execute"]>[1]
                  ) => {
                    const rows = await target.execute(statement, params);
                    if (dropOfHost.test(statement)) {
                      reached();
                      await gate;
                    }
                    return rows;
                  };
                }
                const value: unknown = Reflect.get(target, key);
                return typeof value === "function"
                  ? (value as (...args: unknown[]) => unknown).bind(target)
                  : value;
              },
            })
          ),
        options
      )
    );

    vi.stubEnv("NODE_ENV", "development");
    const deleting = builderDelete(HOST);
    await dropped;
    // Asked once the table is gone and the registry row is not: a hold the
    // drop's commit had released would answer that the collection exists.
    const held = collections.withTransaction(tx =>
      collections.holdCollectionInTransaction(tx, HOST)
    );
    await new Promise(resolve => setTimeout(resolve, 200));
    release();
    await deleting;

    expect(await held).toBe(false);
    expect(await registered(t, HOST)).toBe(false);
  });
});
