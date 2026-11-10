/**
 * A plugin reads a collection's record inside a transaction it holds, on a
 * PostgreSQL pool of ONE connection, the usual serverless setting.
 *
 * `ctx.services.collections.withTransaction` holds the pool's only
 * connection until its work returns. `services.collections.getCollection`
 * asks the registry through the pool, so inside the transaction it waits
 * for the connection the transaction holds, until the pool's wait bound,
 * and fails. `services.collections.getCollectionInTransaction` asks on the
 * transaction's own connection, so it answers, with the record
 * `getCollection` answers outside it.
 *
 * Two controls show the fixture reaches that condition. With a transaction
 * holding the one connection, a pooled query from another flow waits out the
 * bound and is refused; and `getCollection` itself, called inside the
 * transaction, is refused the same way, so the registry read is not served
 * from memory where the main case would pass whatever it read on. Without
 * them, a pool that quietly had more connections would pass the main case.
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
const EVENTS = "txrecord_events";

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
  "a plugin's collection record read on a PostgreSQL pool of one connection",
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
            name: "@test/pool-of-one-collection-record",
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
            status: true,
            fields: [{ name: "title", type: "text" }],
          } as unknown as CollectionConfig,
        ],
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

    it("refuses getCollection inside withTransaction, which asks through the pool (the control)", async () => {
      if (!ctx) throw new Error("not booted");
      const { collections } = ctx.services;

      const outcome = await withTimeout(
        collections
          .withTransaction(async () => collections.getCollection(EVENTS, {}))
          .then(
            () => "answered",
            () => "refused"
          ),
        POOL_WAIT_MS * 3
      );

      expect(outcome).toBe("refused");
    }, 30_000);

    it("reads the record inside withTransaction on its connection, as getCollection answers it", async () => {
      if (!ctx) throw new Error("not booted");
      const { collections } = ctx.services;

      const inside = await withTimeout(
        // The transaction takes the pool's one connection when it opens,
        // and holds it until this work returns.
        collections.withTransaction(tx =>
          collections.getCollectionInTransaction(tx, EVENTS)
        ),
        POOL_WAIT_MS * 3
      );
      // Outside any transaction, so through the pool.
      const pooled = await collections.getCollection(EVENTS, {});

      expect(inside.name).toBe(EVENTS);
      // The Draft/Published lifecycle a save asks the record about.
      expect((inside as unknown as { status?: unknown }).status).toBe(true);
      expect(inside).toEqual(pooled);
    }, 30_000);

    it("refuses a collection there is no record of, inside withTransaction, as getCollection does", async () => {
      if (!ctx) throw new Error("not booted");
      const { collections } = ctx.services;

      const refused = await withTimeout(
        collections
          .withTransaction(tx =>
            collections.getCollectionInTransaction(tx, "txrecord_missing")
          )
          .catch((error: unknown) => error),
        POOL_WAIT_MS * 3
      );

      expect(NextlyError.isNotFound(refused)).toBe(true);
    }, 30_000);
  }
);
