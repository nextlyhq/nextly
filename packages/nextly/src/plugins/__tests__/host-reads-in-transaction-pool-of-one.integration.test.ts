/**
 * A plugin's read of a HOST collection inside a write's transaction completes
 * on a PostgreSQL pool of ONE connection, the usual serverless setting.
 *
 * The write's transaction holds the pool's only connection until its
 * in-transaction handlers return. A host read asks two things of the
 * database: whether the collection holds a field of a type the plugin
 * registered, from its registry row, and then its rows. Either one made
 * through the pool would wait for the connection the transaction holds, until
 * the pool's wait bound, and fail the write.
 * `ctx.services.ownCollections.listHostEntriesInTransaction` makes both on
 * the transaction's own connection, so the write completes.
 *
 * The control shows the fixture reaches that condition: with a transaction
 * holding the one connection, a pooled query from another flow waits out the
 * bound and is refused. Without it, a pool that quietly had more connections
 * would pass the main case whatever the read did.
 *
 * PostgreSQL only: SQLite has no pool, and the routing is covered for
 * correctness on every dialect by `host-reads-in-transaction.integration.test.ts`.
 * The suite self-skips without `TEST_POSTGRES_URL`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import { createAdapter } from "../../database/factory";
import { NextlyError } from "../../errors/nextly-error";
import { definePlugin, type PluginContext } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

// Suite-local slug: the suite runs on the worker's shared database.
const HOSTED = "poolofone_pages";

/** The field type the plugin registers, which the host collection holds. */
const HOST_DOC = "poolofonedoc";

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
  "an in-transaction handler's host read on a PostgreSQL pool of one connection",
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
            name: "@test/pool-of-one-host-reader",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: {
              fieldTypes: [
                {
                  type: HOST_DOC,
                  storage: "json",
                  component: "@test/pool-of-one-host-reader/admin#Doc",
                },
              ],
            },
            init(captured) {
              ctx = captured;
            },
          }),
        ],
        // A raw config: the type is registered by the plugin at boot.
        collections: [
          {
            slug: HOSTED,
            fields: [
              { name: "title", type: "text" },
              { name: "body", type: HOST_DOC },
            ],
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
          `SELECT table_name FROM dynamic_collections WHERE slug = '${HOSTED}'`
        );
        tables = rows.map(row => row.table_name);
      } catch {
        // A fresh database has no registry yet, so nothing to remove.
        return;
      }
      for (const statement of [
        ...tables.map(table => `DROP TABLE IF EXISTS "${table}"`),
        `DELETE FROM dynamic_collections WHERE slug = '${HOSTED}'`,
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

    it("completes a write whose handler lists a host collection holding the plugin's field type in the transaction", async () => {
      if (!handle || !ctx) throw new Error("not booted");
      const plugin = ctx;
      const listed: unknown[][] = [];
      plugin.hooks.onInTransaction(HOSTED, async write => {
        const page =
          await plugin.services.ownCollections.listHostEntriesInTransaction(
            write.transaction,
            HOSTED,
            { pagination: { limit: 10 } }
          );
        listed.push(page.data.map(row => row.title));
      });

      const created = await withTimeout(
        handle.nextly.create({
          collection: HOSTED,
          data: { title: "written on one connection", body: { v: 1 } },
        }),
        POOL_WAIT_MS * 3
      );

      expect(created.item.title).toBe("written on one connection");
      expect(listed).toEqual([["written on one connection"]]);
      const stored = await handle.nextly.count({ collection: HOSTED });
      expect(stored.total).toBe(1);
    }, 30_000);
  }
);
