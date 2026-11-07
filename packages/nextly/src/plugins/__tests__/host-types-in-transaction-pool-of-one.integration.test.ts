/**
 * A plugin lists the host content holding its field type inside a
 * transaction it holds, on a PostgreSQL pool of ONE connection, the usual
 * serverless setting.
 *
 * `ctx.services.collections.withTransaction` holds the pool's only
 * connection until its work returns. The listing asks the database for every
 * collection and every Single, then for every schema and, when one names a
 * component, every component's fields. The plugin's own `services.collections.listCollections` and
 * `services.singles.list` ask through the pool, so inside the transaction they
 * wait for the connection it holds, until the pool's wait bound, and fail.
 * `ctx.services.ownCollections.listHostTypesInTransaction` asks all of it on
 * the transaction's own connection, so it answers.
 *
 * The control shows the fixture reaches that condition: with a transaction
 * holding the one connection, a pooled query from another flow waits out the
 * bound and is refused. Without it, a pool that quietly had more connections
 * would pass the main case whatever the listing did.
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

// Suite-local slugs: the suite runs on the worker's shared database.
const HOSTED = "hosttypes_pages";
const PLAIN = "hosttypes_posts";
const HOSTED_SINGLE = "hosttypes_home";
const PLAIN_SINGLE = "hosttypes_footer";

/** The field type the plugin registers, which the hosted content holds. */
const HOST_DOC = "hosttypesdoc";

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
 * Reject if `work` does not settle within `ms`, so a listing that waits for
 * the connection its own transaction holds fails the case instead of hanging
 * it.
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
  "a plugin's host-types listing on a PostgreSQL pool of one connection",
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
            name: "@test/pool-of-one-host-types",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: {
              fieldTypes: [
                {
                  type: HOST_DOC,
                  storage: "json",
                  component: "@test/pool-of-one-host-types/admin#Doc",
                },
              ],
            },
            init(captured) {
              ctx = captured;
            },
          }),
        ],
        // Raw configs: the type is registered by the plugin at boot.
        collections: [
          {
            slug: HOSTED,
            fields: [
              { name: "title", type: "text" },
              {
                name: "panel",
                type: "group",
                fields: [{ name: "body", type: HOST_DOC }],
              },
            ],
          } as unknown as CollectionConfig,
          {
            slug: PLAIN,
            fields: [{ name: "title", type: "text" }],
          } as unknown as CollectionConfig,
        ],
        singles: [
          {
            slug: HOSTED_SINGLE,
            fields: [
              { name: "headline", type: "text" },
              { name: "body", type: HOST_DOC },
            ],
          } as never,
          {
            slug: PLAIN_SINGLE,
            fields: [{ name: "headline", type: "text" }],
          } as never,
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
     * Remove what the suite registered on the shared database: each
     * collection's and Single's table, under the name its registry row
     * gives, and the rows.
     */
    async function drop(adapter: TestAdapter): Promise<void> {
      const registries = [
        { table: "dynamic_collections", slugs: [HOSTED, PLAIN] },
        { table: "dynamic_singles", slugs: [HOSTED_SINGLE, PLAIN_SINGLE] },
      ];
      for (const { table, slugs } of registries) {
        const listed = slugs.map(slug => `'${slug}'`).join(", ");
        let tables: string[] = [];
        try {
          const rows = await adapter.executeQuery<{ table_name: string }>(
            `SELECT table_name FROM ${table} WHERE slug IN (${listed})`
          );
          tables = rows.map(row => row.table_name);
        } catch {
          // A fresh database has no registry yet, so nothing to remove.
          continue;
        }
        for (const statement of [
          ...tables.map(name => `DROP TABLE IF EXISTS "${name}"`),
          `DELETE FROM ${table} WHERE slug IN (${listed})`,
        ]) {
          await adapter.executeQuery(statement);
        }
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

    it("lists the collections and Singles holding the plugin's field type inside withTransaction, on its connection", async () => {
      if (!handle || !ctx) throw new Error("not booted");
      const { collections, ownCollections } = ctx.services;

      const found = await withTimeout(
        // The transaction takes the pool's one connection when it opens,
        // and holds it until this work returns.
        collections.withTransaction(async tx => {
          const types = await ownCollections.listHostTypesInTransaction(tx);
          // A host read of the listed collection, on the same transaction,
          // is accepted; it holds no rows yet.
          const rows = await ownCollections.listHostEntriesInTransaction(
            tx,
            HOSTED
          );
          return { types, rows: rows.data.length };
        }),
        POOL_WAIT_MS * 3
      );

      expect(found.types.collections.map(listed => listed.name)).toEqual([
        HOSTED,
      ]);
      expect(found.types.singles.map(listed => listed.slug)).toEqual([
        HOSTED_SINGLE,
      ]);
      expect(found.rows).toBe(0);
    }, 30_000);
  }
);
