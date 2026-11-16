/**
 * A plugin reads its own content on a transaction it holds, on every dialect.
 *
 * `ctx.services.ownCollections.listEntriesInTransaction`,
 * `findEntryByIdInTransaction` and `getSingleInTransaction` take the token
 * `ctx.services.collections.withTransaction` hands its work, or an
 * in-transaction handler's `transaction`, and read on that transaction's own
 * connection.
 *
 * The separating property is that a read sees what the transaction wrote and
 * has not committed. A read through the pool cannot on PostgreSQL and MySQL:
 * it runs on another connection, and the escape guard
 * (`src/__tests__/transaction-escapes`) fails any test here whose read takes
 * one. SQLite has one connection, so there the cases pin the answer and the
 * refusals rather than the routing. The pool-of-one case, where a pooled read
 * waits forever, is `own-reads-in-transaction-pool-of-one.integration.test.ts`.
 */
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, json, text } from "../../config";
import { definePlugin, type PluginContext } from "../plugin-context";
import type { PluginCollectionTransaction } from "../service-opts";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

// Suite-local slugs: integration files share fixed system-table names.
const OWNED = "txread_ledger";
const FOREIGN = "txread_foreign";
const OWN_SINGLE = "txread_settings";
const FOREIGN_SINGLE = "txread_other_settings";
const OWN_SINGLE_KEY = `single:${OWN_SINGLE}`;

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

/** Boot a plugin owning a collection and a Single, beside another plugin owning one of each. */
async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/tx-own-reader",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          collections: [
            defineCollection({
              slug: OWNED,
              fields: [text({ name: "title" }), json({ name: "meta" })],
            }),
          ],
          singles: [
            defineSingle({
              slug: OWN_SINGLE,
              fields: [text({ name: "headline" })],
            }),
          ],
        },
        init(ctx) {
          captured = ctx;
        },
      }),
      definePlugin({
        name: "@test/tx-other-plugin",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          collections: [
            defineCollection({
              slug: FOREIGN,
              fields: [text({ name: "title" })],
            }),
          ],
          singles: [
            defineSingle({
              slug: FOREIGN_SINGLE,
              fields: [text({ name: "headline" })],
            }),
          ],
        },
      }),
    ],
  });
  if (!captured) throw new Error("the plugin's init did not run");
  return captured;
}

function handle(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

/** What `run` rejected with, or a marker when it resolved. */
async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return "resolved";
}

describeEachDialect("a plugin's own reads on its transaction", dialect => {
  it("sees a row its withTransaction work created and has not committed", async () => {
    const ctx = await boot(dialect);
    await handle().nextly.create({
      collection: OWNED,
      data: { title: "committed", meta: { n: 1 } },
    });
    const { collections, ownCollections } = ctx.services;

    const seen = await collections.withTransaction(async tx => {
      const created = await collections.createEntryInTransaction(
        tx,
        OWNED,
        { title: "uncommitted", meta: { n: 2 } },
        {}
      );
      const listed = await ownCollections.listEntriesInTransaction(tx, OWNED, {
        sort: { field: "title", direction: "asc" },
      });
      const filtered = await ownCollections.listEntriesInTransaction(
        tx,
        OWNED,
        { where: { title: { equals: "uncommitted" } } }
      );
      const found = await ownCollections.findEntryByIdInTransaction(
        tx,
        OWNED,
        String(created.id)
      );
      return { listed, filtered, found };
    });

    expect(seen.listed.data.map(row => row.title)).toEqual([
      "committed",
      "uncommitted",
    ]);
    expect(seen.listed.pagination.total).toBe(2);
    expect(seen.filtered.data.map(row => row.meta)).toEqual([{ n: 2 }]);
    expect(seen.found.title).toBe("uncommitted");
  });

  it("sees, from an in-transaction handler, the row the write is making", async () => {
    const ctx = await boot(dialect);
    const seen: { listed: unknown[]; found: unknown }[] = [];
    ctx.hooks.onInTransaction(OWNED, async write => {
      const own = ctx.services.ownCollections;
      const listed = await own.listEntriesInTransaction(
        write.transaction,
        OWNED,
        { pagination: { limit: 10 } }
      );
      const found = await own.findEntryByIdInTransaction(
        write.transaction,
        OWNED,
        write.id
      );
      seen.push({
        listed: listed.data.map(row => row.title),
        found: found.title,
      });
    });

    await handle().nextly.create({
      collection: OWNED,
      data: { title: "being written" },
    });

    expect(seen).toEqual([
      { listed: ["being written"], found: "being written" },
    ]);
  });

  it("refuses a collection it did not declare, and a settled token, before reading", async () => {
    const ctx = await boot(dialect);
    const { collections, ownCollections } = ctx.services;
    const service = handle().getService("collectionService");
    const listEntries = vi.spyOn(service, "listEntries");
    const findEntryById = vi.spyOn(service, "findEntryById");
    let kept: PluginCollectionTransaction | undefined;

    const refusals = await collections.withTransaction(async tx => {
      kept = tx;
      return [
        await rejectionOf(() =>
          ownCollections.listEntriesInTransaction(tx, FOREIGN)
        ),
        await rejectionOf(() =>
          ownCollections.findEntryByIdInTransaction(tx, FOREIGN, "missing")
        ),
      ];
    });
    if (!kept) throw new Error("the transaction's work did not run");
    const settled = kept;
    const late = await rejectionOf(() =>
      ownCollections.listEntriesInTransaction(settled, OWNED)
    );

    for (const refused of refusals) {
      expect(refused).toMatchObject({
        code: "INVALID_INPUT",
        logContext: { reason: "own-collection-read-not-owned" },
      });
    }
    expect(late).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "plugin-transaction-finished" },
    });
    expect(listEntries).not.toHaveBeenCalled();
    expect(findEntryById).not.toHaveBeenCalled();
  });

  it("reads its own Single as the write left it, past its read hooks, and refuses another's", async () => {
    const ctx = await boot(dialect);
    // A read hook the own read must not run: it rewrites the headline.
    handle().hooks.register("afterRead", OWN_SINGLE_KEY, hook => ({
      ...(hook.data as Record<string, unknown>),
      headline: "hooked",
    }));
    const seen: unknown[] = [];
    ctx.hooks.onInTransaction(OWN_SINGLE_KEY, async write => {
      const own = ctx.services.ownCollections;
      const single = await own.getSingleInTransaction(
        write.transaction,
        OWN_SINGLE
      );
      seen.push(single.headline);
      seen.push(
        await rejectionOf(() =>
          own.getSingleInTransaction(write.transaction, FOREIGN_SINGLE)
        )
      );
      // A collection's slug is not a Single, even one the plugin owns.
      seen.push(
        await rejectionOf(() =>
          own.getSingleInTransaction(write.transaction, OWNED)
        )
      );
    });

    await handle().nextly.updateSingle({
      slug: OWN_SINGLE,
      data: { headline: "uncommitted", _overwrite: true },
    });

    expect(seen[0]).toBe("uncommitted");
    for (const refused of seen.slice(1)) {
      expect(refused).toMatchObject({
        code: "INVALID_INPUT",
        logContext: { reason: "own-single-read-not-owned" },
      });
    }
    // The control: the ordinary read of the same Single runs the hook.
    const ordinary = await handle().nextly.findSingle({ slug: OWN_SINGLE });
    expect(ordinary.headline).toBe("hooked");
  });
});
