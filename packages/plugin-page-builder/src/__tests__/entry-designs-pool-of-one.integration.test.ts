/**
 * An entry's own design on a PostgreSQL pool of ONE connection, the usual
 * serverless setting. Creating one holds its entry in the create's own
 * transaction (`ctx.services.collections.holdEntryInTransaction`), reading
 * the collection's registry row and the entry's row on that transaction's
 * connection; and deleting an entry that has one deletes the design in the
 * same transaction, read and written on the delete's own connection. So both
 * complete rather than waiting for a second connection that never comes free
 * until the pool's wait runs out.
 *
 * PostgreSQL only: SQLite has no pool, and MySQL's takes the same path.
 *
 * @module __tests__/entry-designs-pool-of-one.integration.test
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createAdapter } from "nextly/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { entryDesignKey, TEMPLATES_SLUG } from "../collections/templates";
import { pageBuilder } from "../plugin";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

/** How long a request waits for a pooled connection before it is refused. */
const POOL_WAIT_MS = 5_000;

/** Suite-local slug: the suite runs on the worker's shared database. */
const HOST = "poolofone_posts";

async function connectSingleConnection() {
  // The environment is validated against the dialect on first read in this
  // worker, so both are set, not only passed to the adapter.
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

/** `work`, or a failure once `ms` pass, so a delete that waits on itself fails the case. */
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

describe.skipIf(!POSTGRES_URL)(
  "an entry's own design on a PostgreSQL pool of one connection",
  () => {
    let t: TestNextly | undefined;
    const templates: string[] = [];

    beforeAll(async () => {
      t = await createTestNextly({
        adapter: await connectSingleConnection(),
        plugins: [pageBuilder()],
        collections: [
          defineCollection({
            slug: HOST,
            fields: [
              text({ name: "title" }),
              text({ name: "slug", unique: true }),
            ],
          }),
        ],
      });
    }, 60_000);

    afterAll(async () => {
      if (!t) return;
      for (const id of templates) {
        await t.nextly
          .delete({ collection: TEMPLATES_SLUG, id, overrideAccess: true })
          .catch(() => undefined);
      }
      await withTimeout(t.destroy(), 15_000);
    }, 30_000);

    it("creates an own design and deletes its entry with it, within the pool's wait", async () => {
      if (!t) throw new Error("the instance never started");
      const base = await t.nextly.create({
        collection: TEMPLATES_SLUG,
        data: { title: "Post page", collection: HOST, status: "published" },
        overrideAccess: true,
      });
      templates.push(String((base as { item: { id: unknown } }).item.id));
      const made = await t.nextly.create({
        collection: HOST,
        data: { title: "Hello", slug: `hello-${Date.now()}` },
        overrideAccess: true,
      });
      const entry = String((made as { item: { id: unknown } }).item.id);
      const design = await withTimeout(
        t.nextly.create({
          collection: TEMPLATES_SLUG,
          data: {
            title: "Hello",
            entry: entryDesignKey(HOST, entry),
            entryCollection: HOST,
            entryId: entry,
          },
          overrideAccess: true,
        }),
        POOL_WAIT_MS * 2
      );
      templates.push(String((design as { item: { id: unknown } }).item.id));

      await withTimeout(
        t.nextly.delete({ collection: HOST, id: entry, overrideAccess: true }),
        POOL_WAIT_MS * 2
      );

      const left = await t.nextly.find({
        collection: TEMPLATES_SLUG,
        where: { entry: { equals: entryDesignKey(HOST, entry) } },
        overrideAccess: true,
        status: "all",
        depth: 0,
      });
      expect(left.items).toEqual([]);
    }, 30_000);
  }
);
