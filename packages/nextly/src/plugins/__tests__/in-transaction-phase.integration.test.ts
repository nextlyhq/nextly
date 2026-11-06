/**
 * The in-transaction hook phase on collections, on every dialect.
 *
 * A plugin registers `ctx.hooks.onInTransaction("orders", …)` and writes a row
 * of its own through the `db` it is handed. That row must share the entry's
 * fate, whichever way the write ends:
 *
 * - it commits with the entry, on create, update and delete;
 * - it rolls back with the entry, when the caller's transaction around the
 *   write fails;
 * - a handler that throws aborts the write, the caller gets the handler's own
 *   status, and neither the entry nor the row is kept;
 * - the handler's `db` reads inside the write's transaction, so it sees the
 *   entry row the write has not committed yet;
 * - on a repeat status-less save of a published entry with drafts, the
 *   handler is handed the prior working draft as `originalData`, not the
 *   unchanged live document;
 * - a version-conflict retry runs the handler again, and only the attempt that
 *   commits keeps its row; the retry is handed the shared context as it was,
 *   whatever a handler of the discarded attempt tried to do to it;
 * - a handler that was removed, or whose plugin is suspended, does not run;
 * - with no handler for a collection, its writes do not reach the phase.
 *
 * The caller-transaction write bodies (`createEntryInTransaction` and its
 * siblings, which the bulk operations use) run the phase too, on the caller's
 * transaction. A write takes its handlers once: one registered while it is
 * under way first runs on the next write.
 */
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { col, defineTable } from "../../domains/schema/extension/dsl";
import { VersionConflictError } from "../../domains/versions/version-conflict";
import { NextlyError } from "../../errors/nextly-error";
import { HookRegistry } from "../../hooks/hook-registry";
import {
  definePlugin,
  type InTransactionHandler,
  type PluginContext,
} from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

const PLUGIN = "@test/order-ledger";

/** The plugin's own table: one row per write its handler saw. */
const ledger = defineTable("ledger", {
  id: col.id(),
  entryId: col.shortText(),
  op: col.shortText(),
});

/** A column the plugin contributes to the collection's own table. */
const stampColumns = { ledgerStamp: col.text({ nullable: true }) };

const orders = defineCollection({
  slug: "orders",
  fields: [text({ name: "title" })],
});

/** A collection with drafts, whose status-less edits of a live entry are held. */
const articles = defineCollection({
  slug: "articles",
  status: true,
  versions: { drafts: true },
  fields: [text({ name: "title" })],
});

/** A second collection, which no handler is registered for. */
const notes = defineCollection({
  slug: "notes",
  fields: [text({ name: "title" })],
});

/** Boot the plugin on `dialect` and hand back its context. */
async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    collections: [orders, notes, articles],
    plugins: [
      definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          schema: {
            prefix: "ledg",
            tables: [ledger],
            extend: [
              ({ schema }) => {
                schema.extendTable("dc_orders", { columns: stampColumns });
              },
            ],
          },
        },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (!captured) throw new Error("the plugin's init did not run");
  return captured;
}

function nextly(): TestNextly["nextly"] {
  if (!current) throw new Error("not booted");
  return current.nextly;
}

/** The ledger as committed, read through `ctx.db` outside any transaction. */
async function ledgerRows(
  ctx: PluginContext
): Promise<{ entryId: string; op: string }[]> {
  return (await ctx.db.select(ledger).all())
    .map(row => ({ entryId: row.entryId, op: row.op }))
    .sort((a, b) => a.op.localeCompare(b.op));
}

/** How many orders are stored, read outside any transaction. */
async function orderCount(): Promise<number> {
  return (await nextly().count({ collection: "orders" })).total;
}

/** The handler that keeps the ledger: one row per write, through its `db`. */
const keepLedger: InTransactionHandler = async ({ db, id, operation }) => {
  await db.insert(ledger, { entryId: id, op: operation });
};

async function createOrder(title: string): Promise<string> {
  const created = await nextly().create({
    collection: "orders",
    data: { title },
  });
  const id = created.item.id;
  if (typeof id !== "string") throw new Error("the order has no string id");
  return id;
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

describeEachDialect("the in-transaction phase", dialect => {
  it("commits the handler's write with the entry on create, update and delete", async () => {
    const ctx = await boot(dialect);
    ctx.hooks.onInTransaction("orders", keepLedger);

    const id = await createOrder("first");
    await nextly().update({ collection: "orders", id, data: { title: "2" } });
    await nextly().delete({ collection: "orders", id });

    expect(await ledgerRows(ctx)).toEqual([
      { entryId: id, op: "create" },
      { entryId: id, op: "delete" },
      { entryId: id, op: "update" },
    ]);
  });

  it("aborts a create with the handler's own status, keeping neither row", async () => {
    const ctx = await boot(dialect);
    // The ledger row is written first, so the refusal has something of the
    // handlers' own to roll back as well as the entry.
    ctx.hooks.onInTransaction("orders", keepLedger);
    ctx.hooks.onInTransaction("orders", () => {
      throw NextlyError.validation({
        errors: [{ path: "title", code: "INVALID", message: "not allowed" }],
      });
    });

    const caught = await rejectionOf(() => createOrder("refused"));

    expect(caught).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    expect(await orderCount()).toBe(0);
    expect(await ledgerRows(ctx)).toEqual([]);
  });

  it("aborts with a 500 when the handler throws a plain error, keeping neither row", async () => {
    const ctx = await boot(dialect);
    ctx.hooks.onInTransaction("orders", keepLedger);
    ctx.hooks.onInTransaction("orders", () => {
      throw new Error("the handler broke");
    });

    const caught = await rejectionOf(() => createOrder("broken"));

    expect(caught).toMatchObject({ statusCode: 500, code: "INTERNAL_ERROR" });
    expect(await orderCount()).toBe(0);
    expect(await ledgerRows(ctx)).toEqual([]);
  });

  it("leaves the entry as it was when the handler refuses an update or a delete", async () => {
    const ctx = await boot(dialect);
    const id = await createOrder("kept");
    ctx.hooks.onInTransaction("orders", keepLedger);
    ctx.hooks.onInTransaction("orders", ({ operation }) => {
      if (operation !== "create") throw NextlyError.forbidden({});
    });

    const update = await rejectionOf(() =>
      nextly().update({ collection: "orders", id, data: { title: "lost" } })
    );
    const remove = await rejectionOf(() =>
      nextly().delete({ collection: "orders", id })
    );

    expect(update).toMatchObject({ statusCode: 403 });
    expect(remove).toMatchObject({ statusCode: 403 });
    const stored = await nextly().findByID({ collection: "orders", id });
    expect(stored?.title).toBe("kept");
    expect(await ledgerRows(ctx)).toEqual([]);
  });

  it("hands the handler a db that sees the write's uncommitted entry row", async () => {
    const ctx = await boot(dialect);
    const seen: unknown[] = [];
    ctx.hooks.onInTransaction("orders", async ({ db, id }) => {
      // The entry row exists only inside the write's transaction: read on
      // any other connection, it is not there yet.
      const stamps = db.contributed("dc_orders", stampColumns);
      seen.push(await stamps.get(id));
      await stamps.set(id, { ledgerStamp: `stamped ${id}` });
    });

    const id = await createOrder("visible");

    expect(seen).toEqual([{ id, ledgerStamp: null }]);
    // And the handler's write to that row committed with it.
    expect(await ctx.db.contributed("dc_orders", stampColumns).get(id)).toEqual(
      { id, ledgerStamp: `stamped ${id}` }
    );
  });

  it("runs again on a retried attempt, keeping only the committed attempt's row", async () => {
    const ctx = await boot(dialect);
    const id = await createOrder("before");
    const attempts: string[] = [];
    ctx.hooks.onInTransaction("orders", async write => {
      attempts.push(write.operation);
      await keepLedger(write);
    });
    // The conflict comes after the ledger row of the first attempt is
    // written, so that row has to be undone for the count below to hold.
    let conflicts = 0;
    ctx.hooks.onInTransaction("orders", () => {
      conflicts += 1;
      if (conflicts === 1) throw new VersionConflictError();
    });

    await nextly().update({
      collection: "orders",
      id,
      data: { title: "after" },
    });

    expect(attempts).toEqual(["update", "update"]);
    expect(await ledgerRows(ctx)).toEqual([{ entryId: id, op: "update" }]);
    const stored = await nextly().findByID({ collection: "orders", id });
    expect(stored?.title).toBe("after");
  });

  it("hands a repeat draft save the prior draft as originalData, on both update paths", async () => {
    const ctx = await boot(dialect);
    const created = await nextly().create({
      collection: "articles",
      data: { title: "live", status: "published" },
    });
    const id = String(created.item.id);
    const seen: { before: unknown; beforeIsDraft: unknown; after: unknown }[] =
      [];
    ctx.hooks.onInTransaction(
      "articles",
      ({ operation, data, originalData }) => {
        if (operation !== "update") return;
        seen.push({
          before: originalData?.title,
          beforeIsDraft: originalData?._isWorkingDraft,
          after: data?.title,
        });
      }
    );

    // Two status-less saves: each is held as the working draft, the second
    // building on the first.
    await nextly().update({
      collection: "articles",
      id,
      data: { title: "draft one", _overwrite: true },
    });
    await nextly().update({
      collection: "articles",
      id,
      data: { title: "draft two", _overwrite: true },
    });
    // And once more on a caller's transaction.
    const collections = ctx.services.collections;
    await collections.withTransaction(async tx => {
      await collections.updateEntryInTransaction(
        tx,
        "articles",
        id,
        { title: "draft three", _overwrite: true },
        {}
      );
    });

    expect(seen).toEqual([
      { before: "live", beforeIsDraft: undefined, after: "draft one" },
      { before: "draft one", beforeIsDraft: true, after: "draft two" },
      { before: "draft two", beforeIsDraft: true, after: "draft three" },
    ]);
  });

  it("hands a retried attempt the context as it was, whatever a handler did to it", async () => {
    const ctx = await boot(dialect);
    const id = await createOrder("before");
    const seen: unknown[] = [];
    const refused: string[] = [];
    let attempts = 0;
    ctx.hooks.onInTransaction("orders", ({ context }) => {
      attempts += 1;
      const nested = context.nested as { count: number; tags: string[] };
      seen.push({ count: nested.count, tags: [...nested.tags] });
      if (attempts > 1) return;
      // The first attempt tries to leave nested state for the next one, then
      // loses a version race.
      try {
        nested.count = 99;
      } catch {
        refused.push("count");
      }
      try {
        nested.tags.push("leaked");
      } catch {
        refused.push("tags");
      }
      throw new VersionConflictError();
    });
    const sent = { nested: { count: 1, tags: ["a"] } };

    await nextly().update({
      collection: "orders",
      id,
      data: { title: "after" },
      context: sent,
    });

    expect(seen).toEqual([
      { count: 1, tags: ["a"] },
      { count: 1, tags: ["a"] },
    ]);
    expect(refused).toEqual(["count", "tags"]);
    // Nor did the attempt reach the caller's own object.
    expect(sent).toEqual({ nested: { count: 1, tags: ["a"] } });
  });

  it("stops running a handler once it is removed, or its plugin is suspended", async () => {
    const ctx = await boot(dialect);
    ctx.hooks.onInTransaction("orders", keepLedger);
    const first = await createOrder("one");

    ctx.hooks.offInTransaction("orders", keepLedger);
    await createOrder("two");

    ctx.hooks.onInTransaction("orders", keepLedger);
    // As a config reload suspends a plugin it switched off.
    if (!current) throw new Error("not booted");
    current.hooks.setSuspendedOwners([`plugin:${PLUGIN}`]);
    await createOrder("three");

    expect(await ledgerRows(ctx)).toEqual([{ entryId: first, op: "create" }]);
    expect(await orderCount()).toBe(3);
  });

  it("does not reach the phase for a collection with no handler", async () => {
    // A guard: writes to a collection nobody registered for go the way they
    // went before the phase existed, and a handler on another collection is
    // not run for them.
    const ctx = await boot(dialect);
    ctx.hooks.onInTransaction("orders", keepLedger);
    const runners = vi.spyOn(HookRegistry.prototype, "inTransactionRunners");
    const asked = vi.spyOn(HookRegistry.prototype, "hasInTransaction");

    const created = await nextly().create({
      collection: "notes",
      data: { title: "a" },
    });
    const id = created.item.id as string;
    await nextly().update({ collection: "notes", id, data: { title: "b" } });
    await nextly().delete({ collection: "notes", id });

    expect(asked.mock.calls.map(([collection]) => collection)).toEqual([
      "notes",
      "notes",
      "notes",
    ]);
    expect(asked.mock.results.map(result => result.value)).toEqual([
      false,
      false,
      false,
    ]);
    // Only the presence check read the store; the phase itself never ran.
    expect(runners).toHaveBeenCalledTimes(3);
    expect(await ledgerRows(ctx)).toEqual([]);
  });
});

describeEachDialect(
  "the in-transaction phase on a caller's transaction",
  dialect => {
    it("writes on the caller's transaction, and commits with it", async () => {
      const ctx = await boot(dialect);
      ctx.hooks.onInTransaction("orders", keepLedger);
      const collections = ctx.services.collections;

      const id = await collections.withTransaction(async tx => {
        const created = await collections.createEntryInTransaction(
          tx,
          "orders",
          { title: "one" },
          {}
        );
        const createdId = String(created.id);
        await collections.updateEntryInTransaction(
          tx,
          "orders",
          createdId,
          { title: "two" },
          {}
        );
        return createdId;
      });

      expect(await ledgerRows(ctx)).toEqual([
        { entryId: id, op: "create" },
        { entryId: id, op: "update" },
      ]);
    });

    it("rolls the handler's writes back with the entries when the caller's transaction fails", async () => {
      const ctx = await boot(dialect);
      // Counted, so an empty ledger below means rolled back rather than never
      // written.
      const ran: string[] = [];
      ctx.hooks.onInTransaction("orders", async write => {
        ran.push(write.operation);
        await keepLedger(write);
      });
      const collections = ctx.services.collections;

      // Both writes finish, and their phases with them; the caller's
      // transaction then fails, after the writes have returned.
      const failure = new Error("a later step failed");
      const caught = await rejectionOf(() =>
        collections.withTransaction(async tx => {
          const created = await collections.createEntryInTransaction(
            tx,
            "orders",
            { title: "rolled back" },
            {}
          );
          await collections.updateEntryInTransaction(
            tx,
            "orders",
            String(created.id),
            { title: "rolled back too" },
            {}
          );
          throw failure;
        })
      );

      // The collection service's transaction hands a plain error back
      // classified, keeping its message.
      expect(caught).toMatchObject({ message: failure.message });
      expect(ran).toEqual(["create", "update"]);
      expect(await orderCount()).toBe(0);
      expect(await ledgerRows(ctx)).toEqual([]);
    });

    it("runs only the handlers a write took when it began: a handler registered meanwhile waits for the next write", async () => {
      const ctx = await boot(dialect);
      const collections = ctx.services.collections;
      const handed: { op: string; title: unknown }[] = [];
      const late: InTransactionHandler = async write => {
        handed.push({ op: write.operation, title: write.data?.title });
        await keepLedger(write);
      };
      // The seam: right after a write asks the registry for its handlers, a
      // plugin registers one, as a concurrent request could.
      const presence = HookRegistry.prototype.hasInTransaction;
      const registerRightAfterTheQuestion = (): void => {
        vi.spyOn(
          HookRegistry.prototype,
          "hasInTransaction"
        ).mockImplementationOnce(function (
          this: HookRegistry,
          collection: string
        ) {
          const answer = presence.call(this, collection);
          ctx.hooks.onInTransaction("orders", late);
          return answer;
        });
      };

      registerRightAfterTheQuestion();
      const id = await collections.withTransaction(async tx => {
        const created = await collections.createEntryInTransaction(
          tx,
          "orders",
          { title: "one" },
          {}
        );
        return String(created.id);
      });
      ctx.hooks.offInTransaction("orders", late);
      registerRightAfterTheQuestion();
      await collections.withTransaction(async tx => {
        await collections.updateEntryInTransaction(
          tx,
          "orders",
          id,
          { title: "two" },
          {}
        );
      });
      // Registered all along now, so the next write runs it.
      await collections.withTransaction(async tx => {
        await collections.deleteEntryInTransaction(tx, "orders", id, {});
      });

      expect(handed).toEqual([{ op: "delete", title: "two" }]);
      expect(await ledgerRows(ctx)).toEqual([{ entryId: id, op: "delete" }]);
    });

    it("throws the handler's refusal out of the caller's transaction, keeping nothing", async () => {
      const ctx = await boot(dialect);
      ctx.hooks.onInTransaction("orders", keepLedger);
      ctx.hooks.onInTransaction("orders", () => {
        throw NextlyError.validation({
          errors: [{ path: "title", code: "INVALID", message: "not allowed" }],
        });
      });
      const collections = ctx.services.collections;

      const caught = await rejectionOf(() =>
        collections.withTransaction(async tx => {
          await collections.createEntryInTransaction(
            tx,
            "orders",
            { title: "refused" },
            {}
          );
        })
      );

      expect(caught).toMatchObject({
        statusCode: 400,
        code: "VALIDATION_ERROR",
      });
      expect(await orderCount()).toBe(0);
      expect(await ledgerRows(ctx)).toEqual([]);
    });
  }
);
