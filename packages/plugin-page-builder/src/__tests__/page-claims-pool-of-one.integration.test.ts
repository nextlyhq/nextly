/**
 * A page's address claims on a PostgreSQL pool of ONE connection, the usual
 * serverless setting.
 *
 * The save's transaction holds the pool's only connection while its
 * in-transaction handlers run. The claims are read and written on that
 * transaction, so publishing a page completes, and a clash is refused
 * naming the page in the way, rather than the save waiting for a second
 * connection that never comes free until the pool's wait runs out.
 *
 * PostgreSQL only: SQLite has no pool, and MySQL's takes the same path.
 *
 * @module __tests__/page-claims-pool-of-one.integration.test
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { BlockNode } from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createAdapter } from "nextly/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { pageBuilder } from "../plugin";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

/** How long a request waits for a pooled connection before it is refused. */
const POOL_WAIT_MS = 5_000;

/** An adapter whose pool holds a single connection, with a bounded wait. */
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

/** `work`, or a failure once `ms` pass, so a save that waits on itself fails the case. */
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

/** A page document holding one collection list split into pages. */
const PAGINATED = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "pages", limit: 10, paginate: true },
      slots: { children: [], empty: [] },
    } as BlockNode,
  ],
};
const PLAIN = { formatVersion: 1, kind: "page", nodes: [] };

describe.skipIf(!POSTGRES_URL)(
  "a page's address claims on a PostgreSQL pool of one connection",
  () => {
    let t: TestNextly | undefined;
    // What the suite published on the worker's shared database, deleted after
    // it so a later run starts from the same state (deleting releases each
    // page's claims).
    const published: string[] = [];

    beforeAll(async () => {
      t = await createTestNextly({
        adapter: await connectSingleConnection(),
        plugins: [pageBuilder()],
      });
      // The start-up pass over existing pages runs in the background; let
      // it finish on this empty site, so saves no longer look for pages in
      // a list's way.
      await new Promise(resolve => setTimeout(resolve, 500));
    }, 60_000);

    afterAll(async () => {
      if (!t) return;
      for (const id of published) {
        await t.nextly
          .delete({ collection: "pages", id, overrideAccess: true })
          .catch(() => undefined);
      }
      await withTimeout(t.destroy(), 15_000);
    }, 30_000);

    async function publish(
      slug: string,
      title: string,
      content: unknown = PLAIN
    ): Promise<string> {
      if (!t) throw new Error("the instance never started");
      const created = await t.nextly.create({
        collection: "pages",
        data: { title, slug, content, status: "published" },
        overrideAccess: true,
      });
      const id = String((created as { item: { id: unknown } }).item.id);
      published.push(id);
      return id;
    }

    it("publishes a page and holds its address, within the pool's wait", async () => {
      const id = await withTimeout(
        publish("pool-of-one-about", "About"),
        POOL_WAIT_MS * 2
      );
      const held = await t?.nextly.find({
        collection: ADDRESS_CLAIMS_SLUG,
        where: { holderId: { equals: id } },
        overrideAccess: true,
        depth: 0,
      });
      expect(
        (held?.items as Record<string, unknown>[]).map(row => row.path)
      ).toEqual(["/pool-of-one-about"]);
    }, 30_000);

    it("refuses a list over a published page with a conflict naming it, within the pool's wait", async () => {
      const secondId = await withTimeout(
        publish("pool-news/page/2", "Second"),
        POOL_WAIT_MS * 2
      );
      const refused = await withTimeout(
        publish("pool-news", "News", PAGINATED).then(
          () => undefined,
          (error: unknown) => error
        ),
        POOL_WAIT_MS * 2
      );
      expect(NextlyError.isConflict(refused)).toBe(true);
      expect((refused as NextlyError).publicMessage).toContain(
        `the page "Second" (${secondId})`
      );
    }, 30_000);
  }
);
