/**
 * A plugin lists a collection's entries inside a transaction it holds, on a
 * PostgreSQL pool of ONE connection, the usual serverless setting.
 *
 * `ctx.services.collections.withTransaction` holds the pool's only
 * connection until its work returns. `services.collections.listEntries`
 * reads through the pool, so inside the transaction it waits for the
 * connection the transaction holds, until the pool's wait bound, and fails.
 * `services.collections.listEntriesInTransaction` reads on the
 * transaction's own connection, so it answers, with the page `listEntries`
 * answers outside it, and sees a row the transaction itself wrote.
 *
 * Two controls show the fixture reaches that condition. With a transaction
 * holding the one connection, a pooled query from another flow waits out the
 * bound and is refused; and `listEntries` itself, called inside the
 * transaction, is refused the same way, so the main case is not passing on a
 * read that never needed a connection. Without them, a pool that quietly had
 * more connections would pass the main case.
 *
 * PostgreSQL only: SQLite has no pool. The suite self-skips without
 * `TEST_POSTGRES_URL`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import { createAdapter } from "../../database/factory";
import { NextlyError } from "../../errors/nextly-error";
import { definePlugin, type PluginContext } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

// Suite-local slug: the suite runs on the worker's shared database.
const EVENTS = "txentries_events";

/** How long a request waits for a pooled connection before it is refused. */
const POOL_WAIT_MS = 5_000;

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

/** An adapter whose pool holds a single connection, with a bounded wait for it. */
async function connectSingleConnection(): Promise<TestAdapter> {
  // env.ts validates DATABASE_URL against DB_DIALECT on first read in this
  // worker, so both must be on process.env, not only passed to createAdapter.
  process.env.DB_DIALECT = "postgresql";
  process.env.DATABASE_URL = POSTGRES_URL;
  const adapter = await createAdapter({
    type: "postgresql",
    url: POSTGRES_URL,
    pool: { max: 1, connectionTimeoutMs: POOL_WAIT_MS },
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

/**
 * Reject if `work` does not settle within `ms`, so a read that waits for the
 * connection its own transaction holds fails the case instead of hanging it.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          NextlyError.internal({
            logContext: { reason: "pool-of-one-timeout", timeoutMs: ms },
          })
        ),
      ms
    );
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const describePg = describe.skipIf(!POSTGRES_URL);

describePg(
  "a plugin's entry list read on a PostgreSQL pool of one connection",
  () => {
    let handle: TestNextly | undefined;
    let ctx: PluginContext | undefined;

    beforeAll(async () => {
      const adapter = await connectSingleConnection();
      await drop(adapter);
      handle = await createTestNextly({
        adapter,
        plugins: [
          definePlugin({
            name: "@test/pool-of-one-entries",
            version: "1.0.0",
            nextly: ">=0.0.0",
            init(captured) {
              ctx = captured;
            },
          }),
        ],
        collections: [
          {
            slug: EVENTS,
            fields: [
              { name: "title", type: "text" },
              { name: "slug", type: "text" },
            ],
          } as unknown as CollectionConfig,
        ],
      });
      if (!ctx) throw new Error("not booted");
      // Outside any transaction, so through the pool.
      await ctx.services.collections.createEntry(EVENTS, {
        title: "Launch",
        slug: "launch",
      });
    }, 60_000);

    afterAll(async () => {
      if (!handle) return;
      await drop(handle.adapter);
      // Bounded: a transaction a failed case abandoned can still hold the
      // pool's only connection, and destroying the handle waits for it.
      await withTimeout(handle.destroy(), 15_000);
    }, 30_000);

    /**
     * Remove what the suite registered on the shared database: the
     * collection's table, under the name its registry row gives, and the row.
     */
    async function drop(adapter: TestAdapter): Promise<void> {
      let tables: string[] = [];
      try {
        const rows = await adapter.executeQuery<{ table_name: string }>(
          `SELECT table_name FROM dynamic_collections WHERE slug = '${EVENTS}'`
        );
        tables = rows.map(row => row.table_name);
      } catch {
        // A fresh database has no registry yet, so nothing to remove.
        return;
      }
      for (const statement of [
        ...tables.map(name => `DROP TABLE IF EXISTS "${name}"`),
        `DELETE FROM dynamic_collections WHERE slug = '${EVENTS}'`,
      ]) {
        await adapter.executeQuery(statement);
      }
    }

    /** The read every case makes: the routing columns of the entries. */
    const read = {
      where: { slug: { equals: "launch" } },
      pagination: { limit: 10 },
      select: { id: true, slug: true },
      depth: 0,
    };

    it("refuses a pooled query while a transaction holds the one connection (the control)", async () => {
      if (!handle) throw new Error("not booted");
      const adapter = handle.adapter;
      let release!: () => void;
      const gate = new Promise<void>(resolve => (release = resolve));
      let opened!: () => void;
      const isOpen = new Promise<void>(resolve => (opened = resolve));
      const holder = adapter.transaction(async () => {
        opened();
        await gate;
      });
      await isOpen;

      // From this flow, outside the transaction: a request for the pool's
      // connection, which the transaction holds.
      const waited = await withTimeout(
        adapter.executeQuery("SELECT 1").then(
          () => "got a connection",
          () => "refused"
        ),
        POOL_WAIT_MS * 3
      );
      release();
      await holder;

      expect(waited).toBe("refused");
    }, 30_000);

    it("refuses listEntries inside withTransaction, which reads through the pool (the control)", async () => {
      if (!ctx) throw new Error("not booted");
      const { collections } = ctx.services;

      const outcome = await withTimeout(
        collections
          .withTransaction(async () => collections.listEntries(EVENTS, read))
          .then(
            () => "answered",
            () => "refused"
          ),
        POOL_WAIT_MS * 3
      );

      expect(outcome).toBe("refused");
    }, 30_000);

    it("lists the entries inside withTransaction on its connection, as listEntries answers them", async () => {
      if (!ctx) throw new Error("not booted");
      const { collections } = ctx.services;

      const inside = await withTimeout(
        // The transaction takes the pool's one connection when it opens,
        // and holds it until this work returns.
        collections.withTransaction(tx =>
          collections.listEntriesInTransaction(tx, EVENTS, read)
        ),
        POOL_WAIT_MS * 3
      );
      // Outside any transaction, so through the pool.
      const pooled = await collections.listEntries(EVENTS, read);

      expect(inside.data.map(row => row.slug)).toEqual(["launch"]);
      expect(inside).toEqual(pooled);
    }, 30_000);

    it("sees an entry the transaction itself wrote, which it then rolls back", async () => {
      if (!ctx) throw new Error("not booted");
      const { collections } = ctx.services;
      const rolledBack = NextlyError.internal({
        logContext: { reason: "roll-back-the-test-write" },
      });

      let seen: unknown[] = [];
      const outcome = await withTimeout(
        collections
          .withTransaction(async tx => {
            await collections.createEntryInTransaction(tx, EVENTS, {
              title: "Draft",
              slug: "unsaved",
            });
            const found = await collections.listEntriesInTransaction(
              tx,
              EVENTS,
              { ...read, where: { slug: { equals: "unsaved" } } }
            );
            seen = found.data.map(row => row.slug);
            throw rolledBack;
          })
          .catch((error: unknown) => error),
        POOL_WAIT_MS * 3
      );

      // Rolled back by the work's throw, whatever the service wraps it in.
      expect(outcome).toBeInstanceOf(Error);
      expect(seen).toEqual(["unsaved"]);
      // CONTROL: the write never committed, so a pooled read finds nothing.
      const after = await collections.listEntries(EVENTS, {
        ...read,
        where: { slug: { equals: "unsaved" } },
      });
      expect(after.data).toEqual([]);
    }, 30_000);
  }
);
