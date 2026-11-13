/**
 * A field rewrite on a PostgreSQL pool of ONE connection, the usual serverless
 * setting, for a collection whose table this process has not built yet.
 *
 * The rewrite holds the pool's only connection in its transaction from the
 * entry's row lock to its commit. The collection's Drizzle table is built from
 * its registry row the first time a read needs it, and the rewrite reads the
 * live copy inside its transaction. Built through the pool, that registry read
 * waits for the connection the transaction holds until the pool's wait bound,
 * and the rewrite fails; built on the transaction's own connection, it
 * answers.
 *
 * The control shows the fixture reaches that condition: with a transaction
 * holding the one connection, a pooled query from another flow is refused.
 * Without it, a pool that quietly had more connections would pass the main
 * case whatever the rewrite read through.
 *
 * PostgreSQL only: SQLite has no pool. The suite self-skips without
 * `TEST_POSTGRES_URL`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

// Suite-local slug: the suite runs on the worker's shared database.
const PAGES = "rwpoolpages";

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

describePg("a field rewrite on a PostgreSQL pool of one connection", () => {
  let handle: TestNextly | undefined;

  beforeAll(async () => {
    const adapter = await connectSingleConnection();
    await drop(adapter);
    handle = await createTestNextly({
      adapter,
      collections: [
        defineCollection({
          slug: PAGES,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" }), text({ name: "layout" })],
        }),
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
        `SELECT table_name FROM dynamic_collections WHERE slug = '${PAGES}'`
      );
      tables = rows.map(row => row.table_name);
    } catch {
      // A fresh database has no registry yet, so nothing to remove.
      return;
    }
    for (const statement of [
      ...tables.map(name => `DROP TABLE IF EXISTS "${name}"`),
      `DELETE FROM dynamic_collections WHERE slug = '${PAGES}'`,
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

  it("builds the collection's table inside its transaction, on that connection", async () => {
    if (!handle) throw new Error("not booted");
    const { nextly } = handle;
    const created = await nextly.create({
      collection: PAGES,
      data: { title: "Live", layout: "wide", status: "published" },
    });
    const id = String(created.item.id);
    const read = await nextly.findByID({ collection: PAGES, id });
    const version = (read as unknown as { _rev: string })._rev;
    // As a process that has not read this collection since it started: its
    // table is built from the registry row by the next read that needs it,
    // which is the rewrite's own read of the live copy, in its transaction.
    (
      handle.getService("collectionsHandler") as CollectionsHandler
    ).invalidateCollectionSchema(PAGES);

    const done = await withTimeout(
      nextly.rewriteField({
        collection: PAGES,
        id,
        field: "layout",
        expectedVersion: version,
        set: { value: "narrow" },
        reason: "Layout 'Wide' was deleted",
      }),
      POOL_WAIT_MS * 3
    );

    expect(done.item.copies).toEqual([{ form: "live", locale: null }]);
    const after = await nextly.findByID({ collection: PAGES, id });
    expect((after as unknown as { layout: string }).layout).toBe("narrow");
  }, 30_000);
});
