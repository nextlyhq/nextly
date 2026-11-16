/**
 * A plugin's read on its transaction with `lock: "none"`: a plain read on the
 * transaction's own connection, taking no row lock and waiting for none.
 *
 * Two writers, each holding a row the other needs. Writer A updates row R of
 * the plugin's collection, then asks for the lock row L. Writer B holds L
 * (it updated it first) and reads R through `findEntryByIdInTransaction`.
 *
 * The separating property is whether B's read waits for A. With the shared
 * lock (the default) it does: B waits for A's lock on R while A waits for
 * B's on L, and the database ends the cycle by refusing one of them as a
 * deadlock. With `none` B's read answers at once, from the committed row,
 * B commits and lets go of L, and A goes on and commits after it. Each is
 * run in both orders, the writer asking for L before the read and the read
 * before the writer, since either order closes the same cycle. A read that
 * took the lock anyway deadlocks in both; one that went to the pool instead
 * fails the escape guard (`src/__tests__/transaction-escapes`), and could not
 * see the transaction's own write, which the first case checks.
 *
 * SQLite has one connection and one writer, so two writers cannot each hold
 * a row there: the race is run on PostgreSQL and MySQL, and SQLite pins only
 * that the plain read answers on the transaction.
 */
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { toDbError } from "../../database/errors";
import { originalErrorOf } from "../../errors/original-error";
import { definePlugin, type PluginContext } from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

// Suite-local slugs: integration files share fixed system-table names.
/** The rows a writer updates and the other reads (R). */
const ROWS = "txplain_rows";
/** The lock rows, which each writer updates to hold (L). */
const LOCKS = "txplain_locks";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

/** Boot a plugin owning the rows and the lock rows. */
async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/tx-plain-reader",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          collections: [
            defineCollection({ slug: ROWS, fields: [text({ name: "title" })] }),
            defineCollection({
              slug: LOCKS,
              fields: [text({ name: "title" })],
            }),
          ],
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

function handle(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

/** A new committed entry of `collection`, by id. */
async function entry(collection: string, title: string): Promise<string> {
  const made = await handle().nextly.create({
    collection,
    data: { title },
    overrideAccess: true,
  });
  return String(made.item.id);
}

/** The stored title of entry `id`, read after both writers have ended. */
async function storedTitle(collection: string, id: string): Promise<unknown> {
  const stored = await handle().nextly.findByID({ collection, id });
  return stored?.title;
}

/** A promise and the call that settles it, to order the two writers. */
function latch(): { reached: Promise<void>; open: () => void } {
  let open!: () => void;
  const reached = new Promise<void>(resolve => (open = resolve));
  return { reached, open };
}

/**
 * Time for a statement just sent to reach the database and start waiting.
 * It only decides which of the two orders a case runs in; what each case
 * asserts holds in either, so a slow statement cannot turn its verdict.
 */
const settle = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 200));

/**
 * Whether `error`, or an error it was built from (its `cause`, or the error a
 * service envelope carried), is the database refusing a deadlock.
 */
function isDeadlock(dialect: TestDialect, error: unknown): boolean {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length > 0) {
    const link = pending.pop();
    if (link === null || typeof link !== "object" || seen.has(link)) continue;
    seen.add(link);
    if ((link as { kind?: unknown }).kind === "deadlock") return true;
    if (toDbError(dialect, link).kind === "deadlock") return true;
    pending.push((link as { cause?: unknown }).cause, originalErrorOf(link));
  }
  return false;
}

type Order = "the writer asks first" | "the read asks first";
const ORDERS: readonly Order[] = [
  "the writer asks first",
  "the read asks first",
];

/**
 * Run writers A and B against each other (see the file's comment), B reading
 * R with `lock`, and say how each ended and what B's read answered.
 */
async function race(
  ctx: PluginContext,
  lock: "share" | "none",
  order: Order
): Promise<{
  a: PromiseSettledResult<void>;
  b: PromiseSettledResult<void>;
  read: unknown;
  row: string;
  lockRow: string;
}> {
  const { collections, ownCollections } = ctx.services;
  const row = await entry(ROWS, "committed");
  const lockRow = await entry(LOCKS, "free");
  const aHoldsRow = latch();
  const bHoldsLock = latch();
  const aAsks = latch();
  const bReads = latch();
  let read: unknown;

  const a = collections.withTransaction(async tx => {
    await collections.updateEntryInTransaction(
      tx,
      ROWS,
      row,
      { title: "A's", _overwrite: true },
      {}
    );
    aHoldsRow.open();
    await bHoldsLock.reached;
    if (order === "the read asks first") {
      await bReads.reached;
      await settle();
    }
    // Waits for B, which holds the lock row until it commits.
    const asking = collections.updateEntryInTransaction(
      tx,
      LOCKS,
      lockRow,
      { title: "A's", _overwrite: true },
      {}
    );
    aAsks.open();
    await asking;
  });

  const b = collections.withTransaction(async tx => {
    await collections.updateEntryInTransaction(
      tx,
      LOCKS,
      lockRow,
      { title: "B's", _overwrite: true },
      {}
    );
    bHoldsLock.open();
    await aHoldsRow.reached;
    if (order === "the writer asks first") {
      await aAsks.reached;
      await settle();
    }
    const reading = ownCollections.findEntryByIdInTransaction(tx, ROWS, row, {
      lock,
    });
    bReads.open();
    read = (await reading).title;
    // The lock row stays held until A has asked for it, so A's request
    // waits on B whichever order this case runs in.
    await aAsks.reached;
    await settle();
  });

  const [aEnded, bEnded] = await Promise.allSettled([a, b]);
  return { a: aEnded, b: bEnded, read, row, lockRow };
}

describeEachDialect("a plugin's plain read on its transaction", dialect => {
  it("reads on the transaction's connection, seeing what it wrote and has not committed", async () => {
    const ctx = await boot(dialect);
    await entry(ROWS, "committed");
    const { collections, ownCollections } = ctx.services;

    const seen = await collections.withTransaction(async tx => {
      const created = await collections.createEntryInTransaction(
        tx,
        ROWS,
        { title: "uncommitted" },
        {}
      );
      const listed = await ownCollections.listEntriesInTransaction(
        tx,
        ROWS,
        { sort: { field: "title", direction: "asc" } },
        { lock: "none" }
      );
      const found = await ownCollections.findEntryByIdInTransaction(
        tx,
        ROWS,
        String(created.id),
        { lock: "none" }
      );
      return { listed: listed.data.map(item => item.title), found };
    });

    expect(seen.listed).toEqual(["committed", "uncommitted"]);
    expect(seen.found.title).toBe("uncommitted");
  });

  for (const order of ORDERS) {
    it.skipIf(dialect === "sqlite")(
      `refuses one of two writers as a deadlock when the read takes the shared lock (${order})`,
      async () => {
        const ctx = await boot(dialect);

        const { a, b } = await race(ctx, "share", order);

        // The control: the cycle a plain read must break is real.
        const refused = [a, b].filter(ended => ended.status === "rejected");
        expect(refused).toHaveLength(1);
        const [only] = refused;
        expect(isDeadlock(dialect, only?.reason)).toBe(true);
      }
    );

    it.skipIf(dialect === "sqlite")(
      `lets both writers commit when the read takes no lock (${order})`,
      async () => {
        const ctx = await boot(dialect);

        const { a, b, read, row, lockRow } = await race(ctx, "none", order);

        expect(b).toEqual({ status: "fulfilled", value: undefined });
        expect(a).toEqual({ status: "fulfilled", value: undefined });
        // B read the committed row, not A's write, which had not committed.
        expect(read).toBe("committed");
        // A wrote both rows, the lock row after B let go of it.
        expect(await storedTitle(ROWS, row)).toBe("A's");
        expect(await storedTitle(LOCKS, lockRow)).toBe("A's");
      }
    );
  }
});
