/**
 * Entries' address claims on a PostgreSQL pool of ONE connection, the usual
 * serverless setting. A write's transaction, and each transaction of the
 * start-up passes, holds the pool's only connection while it runs, so every
 * read made inside one must be made on it: a read through the pool waits
 * for the connection its own transaction holds until the pool's wait runs
 * out, and the write fails.
 *
 * - At start, the pages' pass reads each page again inside the transaction
 *   that claims it, and the entries' pass then walks each collection's
 *   published entries inside the transaction that claims theirs. A site
 *   whose store holds nothing yet ends with every page and entry claimed
 *   (or waiting), which neither pass reaches when a read of it waits.
 * - Until the pages' pass has finished, a template's publish walks its
 *   collection's published entries, and both it and an entry's save look
 *   for published pages at each entry's address, all inside the write's
 *   transaction. Here the pages' pass is held at its first read, so the
 *   writes take that path, and each completes promptly: well inside the
 *   pool's wait, so one that waited for the pool fails the case even had
 *   the pool then let it through. A page published before the store held
 *   its claim is found at the entry's address and claimed for, so the
 *   in-transaction read answers the rows the claims are judged by.
 *
 * The pool of one is the one `createAdapter` builds for `pool.max = 1`, as
 * the core suite on in-transaction reads shows waiting for a connection
 * (`nextly/src/plugins/__tests__/entries-in-transaction-pool-of-one`).
 * Each case runs on a database of its own, created beside the integration
 * database and dropped after, so the address store starts empty and a
 * restart finds what the case left.
 *
 * PostgreSQL only: SQLite has no pool, and MySQL's takes the same path
 * (a bounded wait for its one connection); core reads its environment's
 * dialect once per boot, and the suites on a pool of one run on one.
 *
 * @module __tests__/entry-claims-pool-of-one.integration.test
 */
import { randomBytes } from "node:crypto";

import { definePlugin, NextlyError } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createAdapter } from "nextly/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";

import {
  blogPageBuilder,
  claimRows,
  held,
  idOf,
  POSTS,
  postsCollection,
  publishPostsTemplate,
  savePage,
  savePost,
  startupSettled,
} from "./entry-page-claims-harness";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

/** How long a request waits for a pooled connection before it is refused. */
const POOL_WAIT_MS = 5_000;

/**
 * How long a write may take: under the pool's wait, so a write that waited
 * for a second connection fails the case even had the pool let it through.
 */
const PROMPT_MS = 4_000;

type Adapter = Awaited<ReturnType<typeof createAdapter>>;

/** A database of the case's own, and how to remove it. */
interface SiteDatabase {
  readonly url: string;
  drop(): Promise<void>;
}

/** A name this test generated, the only kind it builds DDL from. */
function scratchName(): string {
  const name = `pb_pool_one_${randomBytes(6).toString("hex")}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(name);
  return name;
}

/** A database created beside the integration database, dropped after. */
async function siteDatabase(): Promise<SiteDatabase> {
  vi.stubEnv("DATABASE_URL", POSTGRES_URL);
  vi.stubEnv("DB_DIALECT", "postgresql");
  const name = scratchName();
  const server = await createAdapter({ type: "postgresql", url: POSTGRES_URL });
  // Until it is handed back, nothing else can drop the database or close the
  // server connection: a setup that fails part way does both itself.
  let created = false;
  try {
    await server.executeQuery(`CREATE DATABASE ${name}`);
    created = true;
    const url = new URL(POSTGRES_URL);
    url.pathname = `/${name}`;
    return {
      url: url.toString(),
      drop: async () => {
        try {
          await server.executeQuery(`DROP DATABASE IF EXISTS ${name}`);
        } finally {
          await server.disconnect();
        }
      },
    };
  } catch (error) {
    if (created) {
      await server
        .executeQuery(`DROP DATABASE IF EXISTS ${name}`)
        .catch(() => {});
    }
    await server.disconnect().catch(() => {});
    throw error;
  }
}

/**
 * An adapter on `database` for one boot: an ordinary pool, or one holding a
 * single connection with a bounded wait for it. Core reads its environment
 * when an adapter is made and when a site boots, so it names this database,
 * and the boot is given no secret: the harness then makes one.
 */
async function adapterOn(
  database: SiteDatabase,
  pool: "ordinary" | "one"
): Promise<Adapter> {
  vi.stubEnv("DATABASE_URL", database.url);
  vi.stubEnv("DB_DIALECT", "postgresql");
  vi.stubEnv("NEXTLY_SECRET", undefined);
  const adapter = await createAdapter({
    type: "postgresql",
    url: database.url,
    ...(pool === "one"
      ? { pool: { max: 1, connectionTimeoutMs: POOL_WAIT_MS } }
      : {}),
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

/** `work`, or a failure once `ms` pass, so a write that waits on itself fails the case. */
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

/**
 * Holds the pages' start-up pass at the first read of its walk (every
 * published page, by no slug or id), until let go, so the site's pages are
 * not all claimed yet and writes take the path that claims them first. The
 * reads under test are hook-free and never reach it.
 */
function pagesWalkHold() {
  let reached = () => {};
  let release = () => {};
  const atWalk = new Promise<void>(resolve => {
    reached = resolve;
  });
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  let armed = true;
  const plugin = definePlugin({
    name: "@t/hold-pages-walk",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      ctx.hooks.onBeforeOperation("pages", async context => {
        const where = (context.args.where ?? {}) as Record<string, unknown>;
        const status = where.status as { equals?: unknown } | undefined;
        const walk =
          context.operation === "read" &&
          status?.equals === "published" &&
          Object.keys(where).length === 1;
        if (!armed || !walk) return;
        armed = false;
        reached();
        await released;
      });
    },
  });
  return { plugin, atWalk, release: () => release() };
}

describe.skipIf(!POSTGRES_URL)(
  "entries' address claims on a PostgreSQL pool of one connection",
  () => {
    let current: TestNextly | undefined;
    let database: SiteDatabase | undefined;
    let letGo: (() => void) | undefined;

    afterEach(async () => {
      // A held pass is let go first, so the instance can stop.
      letGo?.();
      letGo = undefined;
      await current?.destroy();
      current = undefined;
      await database?.drop();
      database = undefined;
      vi.unstubAllEnvs();
    }, 60_000);

    it("claims every page and entry at start, reading each on the claim's own transaction", async () => {
      database = await siteDatabase();

      // The install, on an ordinary pool: entries saved before their
      // template is published, a page at one of their addresses, then the
      // template, and every row of the address store deleted, as a site
      // from before the store holds them.
      current = await createTestNextly({
        adapter: await adapterOn(database, "ordinary"),
        plugins: [blogPageBuilder()],
        collections: [postsCollection()],
      });
      await startupSettled(current);
      const hello = idOf(await savePost(current, "hello"));
      const taken = idOf(await savePost(current, "taken"));
      const page = idOf(await savePage(current, "Taken", "blog/taken"));
      await publishPostsTemplate(current);
      for (const row of await claimRows(current)) {
        await current.nextly.delete({
          collection: ADDRESS_CLAIMS_SLUG,
          id: String(row.id),
          overrideAccess: true,
        });
      }
      expect(await claimRows(current)).toEqual([]);
      await current.destroy();
      current = undefined;

      // The site starts again on a pool of one: pages first, then entries.
      current = await createTestNextly({
        adapter: await adapterOn(database, "one"),
        plugins: [blogPageBuilder()],
        collections: [postsCollection()],
      });
      await withTimeout(startupSettled(current), POOL_WAIT_MS * 4);
      expect(await held(current)).toEqual([
        `address /blog/hello ${POSTS}:${hello}`,
        `address /blog/taken pages:${page}`,
        `waiting /blog/taken ${POSTS}:${taken}`,
      ]);
    }, 90_000);

    it("publishes a template and saves an entry before every page is claimed, promptly", async () => {
      database = await siteDatabase();
      const hold = pagesWalkHold();
      letGo = hold.release;
      current = await createTestNextly({
        adapter: await adapterOn(database, "one"),
        plugins: [blogPageBuilder(), hold.plugin],
        collections: [postsCollection()],
      });
      const t = current;
      // The pages' pass is held: until it finishes, writes claim the pages
      // at their entries' addresses themselves.
      await withTimeout(hold.atWalk, POOL_WAIT_MS * 4);

      const hello = idOf(await withTimeout(savePost(t, "hello"), PROMPT_MS));
      const taken = idOf(await withTimeout(savePost(t, "taken"), PROMPT_MS));
      const page = idOf(
        await withTimeout(savePage(t, "Taken", "blog/taken"), PROMPT_MS)
      );
      // The page as a site from before the store has it: published, and
      // holding no claim.
      for (const row of await claimRows(t)) {
        await t.nextly.delete({
          collection: ADDRESS_CLAIMS_SLUG,
          id: String(row.id),
          overrideAccess: true,
        });
      }
      expect(await held(t)).toEqual([]);

      // The template's publish walks the published entries, and claims the
      // page found at an entry's address for it, before the entry waits.
      await withTimeout(publishPostsTemplate(t), PROMPT_MS);
      expect(await held(t)).toEqual([
        `address /blog/hello ${POSTS}:${hello}`,
        `address /blog/taken pages:${page}`,
        `waiting /blog/taken ${POSTS}:${taken}`,
      ]);

      // An entry's save looks for a page at its own address the same way.
      const late = idOf(await withTimeout(savePost(t, "late"), PROMPT_MS));
      expect(await held(t)).toEqual([
        `address /blog/hello ${POSTS}:${hello}`,
        `address /blog/late ${POSTS}:${late}`,
        `address /blog/taken pages:${page}`,
        `waiting /blog/taken ${POSTS}:${taken}`,
      ]);
    }, 90_000);
  }
);
