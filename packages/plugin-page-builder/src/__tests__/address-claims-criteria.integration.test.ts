/**
 * Entries and pages contending for one served address, through real saves:
 * who is refused, who waits, and who is handed the address once its holder
 * lets it go.
 *
 * What separates a correct wiring from a plausible broken one:
 * - a page published at, or renamed to, an address an entry holds is
 *   refused as a conflict, naming the entry, and keeps nothing there, page
 *   or claim;
 * - an entry's save and a page's save for one address at once, in either
 *   order of who claims first, leave exactly one holder, the other refused
 *   naming it, and one claim stored;
 * - an entry left waiting behind a page is handed the address when the page
 *   is renamed or deleted, without the entry being saved again;
 * - a page at `/blog` and a collection served from `/blog` never contend:
 *   the collection's address claims no path;
 * - moving a collection's address drops its entries' waits under the old
 *   one, so releasing what they waited for there hands them nothing.
 *
 * A site upgrading with entries whose addresses pages hold is covered by
 * `entry-claims-at-start.integration.test.ts`, on every dialect.
 */
import {
  definePlugin,
  NextlyError,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { TEMPLATES_SLUG } from "../collections/templates";
import { asOverwrite } from "../document-version";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";

const PLAIN_PAGE = { formatVersion: 1, kind: "page", nodes: [] };
const TEMPLATE = { formatVersion: 1, kind: "template", nodes: [] };

/** Where the posts collection is served, declared in code. */
const ADDRESSES = { posts: "/blog" };

const idOf = (created: unknown): string =>
  String((created as { item: { id: unknown } }).item.id);

/** What a write was refused with, or undefined when it was not. */
function refusedWith(write: Promise<unknown>): Promise<unknown> {
  return write.then(
    () => undefined,
    (caught: unknown) => caught
  );
}

/** The words a refusal gives, as its caller reads them. */
function wordsOf(error: unknown): string {
  const found = error as
    | { publicMessage?: unknown; message?: unknown }
    | undefined;
  if (found === undefined || found === null) return "no refusal";
  return String(found.publicMessage ?? found.message);
}

/** A collection whose entries a template serves, with a lifecycle. */
const entries = (slug: string, singular: string) =>
  defineCollection({
    slug,
    labels: { singular, plural: `${singular}s` },
    status: true,
    fields: [text({ name: "title" }), text({ name: "slug", unique: true })],
  });

/** The content route's provider, over the instance `t`. */
const pageContent = (t: TestNextly) =>
  pageBuilderContent({ nextly: t.nextly as never });

/**
 * Wait for the start-up passes over the address store: the listing of
 * addresses joins them, so once it answers they have finished.
 */
async function settled(t: TestNextly): Promise<void> {
  await pageContent(t).addresses(undefined, 1, []);
}

async function createPost(
  t: TestNextly,
  slug: string,
  collection = "posts"
): Promise<string> {
  return idOf(
    await t.nextly.create({
      collection,
      data: { title: `Post ${slug}`, slug, status: "published" },
      overrideAccess: true,
    })
  );
}

async function createPage(
  t: TestNextly,
  title: string,
  slug: string
): Promise<string> {
  return idOf(
    await t.nextly.create({
      collection: "pages",
      data: { title, slug, content: PLAIN_PAGE, status: "published" },
      overrideAccess: true,
    })
  );
}

async function createTemplate(
  t: TestNextly,
  collection = "posts",
  address?: string
): Promise<string> {
  return idOf(
    await t.nextly.create({
      collection: TEMPLATES_SLUG,
      data: {
        title: collection,
        collection,
        content: TEMPLATE,
        status: "published",
        ...(address === undefined ? {} : { address }),
      },
      overrideAccess: true,
    })
  );
}

/**
 * A save of the live document: pages and templates hold a working draft
 * for a save naming no status, which leaves their claims alone. These tests
 * are about claims, not stale writes, so each replaces whatever is stored.
 */
function updateLive(
  t: TestNextly,
  collection: string,
  id: string,
  data: Record<string, unknown>
) {
  return t.nextly.update({
    collection,
    id,
    data: asOverwrite({ status: "published", ...data }),
    overrideAccess: true,
  });
}

/** Every claim row whose kind `keep` accepts: its kind, path and holder, sorted. */
async function claimsWhere(
  t: TestNextly,
  keep: (kind: string) => boolean
): Promise<string[]> {
  const found = await t.nextly.find({
    collection: ADDRESS_CLAIMS_SLUG,
    overrideAccess: true,
    depth: 0,
    limit: 200,
  });
  return (found.items as Record<string, unknown>[])
    .filter(row => keep(String(row.kind)))
    .map(
      row =>
        `${String(row.kind)} ${String(row.path)} ${String(row.holderCollection)}:${String(row.holderId)}`
    )
    .sort();
}

/** Every claim row of `kinds`: its kind, path and holder, sorted. */
function held(
  t: TestNextly,
  kinds: readonly string[] = ["address", "space"]
): Promise<string[]> {
  return claimsWhere(t, kind => kinds.includes(kind));
}

/**
 * Every claim row of any kind but the locks, which serialise saves and serve
 * nothing: a wait or any other row a save leaves behind is counted.
 */
function everyClaim(t: TestNextly): Promise<string[]> {
  return claimsWhere(t, kind => kind !== "lock");
}

/**
 * Every write to an entry of the posts collection, as `operation id`, in
 * the order the writes ran: seen inside the write's own transaction, so a
 * save that stores the very values it read is counted all the same.
 */
function entryWrites() {
  const writes: string[] = [];
  return {
    /** The writes to the entry `id`. */
    of: (id: string) => writes.filter(write => write.endsWith(` ${id}`)),
    plugin: definePlugin({
      name: "@t/claims-entry-writes",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        ctx.hooks.onInTransaction("posts", write => {
          writes.push(`${write.operation} ${String(write.id)}`);
        });
      },
    }),
  };
}

/** The two saves of a race, by the collection each writes. */
type Side = "posts" | "pages";
const SIDES: readonly Side[] = ["posts", "pages"];

/** How long a gate waits before giving up, so a broken race fails, not hangs. */
const GATE_MS = 10_000;

/** How often the database is asked whether the second save is waiting. */
const POLL_MS = 20;

/** A one-shot signal, and whether it has been given. */
interface Latch {
  readonly promise: Promise<void>;
  open(): void;
  readonly opened: boolean;
}

function latch(): Latch {
  let open = () => {};
  let opened = false;
  const promise = new Promise<void>(resolve => {
    open = () => {
      opened = true;
      resolve();
    };
  });
  return {
    promise,
    open: () => open(),
    get opened() {
      return opened;
    },
  };
}

/** True once `gate` opens, false when `ms` pass first. */
function openedWithin(gate: Latch, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    gate.promise.then(() => true),
    new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The race the gate plugin steers. Each save stops at `arrived` with its
 * document written and its transaction open, before the page builder claims
 * anything for it, until its `go` opens; once it has claimed, it opens its
 * `claimed`, and the save let go first then stays open until `released`.
 */
interface Race {
  armed: boolean;
  /** The save let go first, held open after it claims until `released`. */
  first: Side | null;
  arrived: Record<Side, Latch>;
  go: Record<Side, Latch>;
  claimed: Record<Side, Latch>;
  /** Opened once the other save is seen waiting on the first's claim. */
  released: Latch;
}

function newRace(first: Side | null = null): Race {
  const each = (): Record<Side, Latch> => ({ posts: latch(), pages: latch() });
  return {
    armed: first !== null,
    first,
    arrived: each(),
    go: each(),
    claimed: each(),
    released: latch(),
  };
}

/**
 * Whether another session on this test's database is seen waiting on a lock
 * within `ms`, asked from the test's own pool: a connection outside both
 * saves' transactions. Every boot here runs on a database of its own (see
 * `createTestNextly`), so the only sessions it can count are the two saves;
 * the first is parked in the gate plugin, between statements, so a waiter is
 * the second, blocked on what the first holds uncommitted.
 *
 * Raw SQL, and only in a test: the lock views are the database's own, and no
 * API reports another session's wait. On PostgreSQL the waiter's backend
 * reports a `Lock` wait; on MySQL 8 the lock-wait view lists it with its
 * thread's database (`innodb_trx` does not list every waiting session).
 */
async function seenWaitingOnALock(
  adapter: Pick<TestNextly["adapter"], "executeQuery">,
  dialect: TestDialect,
  ms: number
): Promise<boolean> {
  const sql =
    dialect === "postgresql"
      ? "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'"
      : "SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.threads t ON t.THREAD_ID = w.REQUESTING_THREAD_ID WHERE t.PROCESSLIST_DB = DATABASE() AND t.PROCESSLIST_ID <> CONNECTION_ID()";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const [counted] = await adapter.executeQuery<{ n: unknown }>(sql);
    if (Number(counted?.n ?? 0) > 0) return true;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  return false;
}

const sideOf = (collection: unknown): Side | null =>
  SIDES.find(side => side === collection) ?? null;

/**
 * The plugin holding the gates. It depends on the page builder, so it is
 * started after it: its handler on every collection runs after the page
 * builder's, and before any collection's own handlers, the page builder's
 * claims among them; its handlers on `pages` and `posts` run after the page
 * builder's claims there.
 */
function gatePlugin(race: () => Race): PluginDefinition {
  return definePlugin({
    name: "@t/claims-race-gate",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      ctx.hooks.onInTransaction("*", async write => {
        const current = race();
        const side = sideOf(write.collection);
        if (!current.armed || side === null || current.arrived[side].opened) {
          return;
        }
        current.arrived[side].open();
        await openedWithin(current.go[side], GATE_MS);
      });
      for (const side of SIDES) {
        ctx.hooks.onInTransaction(side, async () => {
          const current = race();
          if (!current.armed || current.claimed[side].opened) return;
          current.claimed[side].open();
          // Held open, its claim uncommitted, until the other save is seen
          // blocked on it: a fixed pause could end before the other reached
          // its claim, and the two would then meet one after the other.
          if (current.first === side) {
            await openedWithin(current.released, GATE_MS);
          }
        });
      }
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "entries and pages contending for an address (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let race = newRace();

    afterEach(async () => {
      // Every gate let go, so a case that failed mid-race leaves no save
      // waiting on one.
      race.armed = false;
      for (const side of SIDES) {
        race.go[side].open();
      }
      race.released.open();
      await current?.destroy();
      current = undefined;
      race = newRace();
    });

    async function boot(
      extra: Parameters<typeof createTestNextly>[0] = {}
    ): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        ...extra,
        plugins: [
          ...(extra.plugins ?? []),
          pageBuilder({ templates: { addresses: ADDRESSES } }),
        ],
        collections: [entries("posts", "Post"), entries("events", "Event")],
      });
      return current;
    }

    /** Whether a stored document of `collection` has `slug`, in any state. */
    async function stored(
      t: TestNextly,
      collection: string,
      slug: string
    ): Promise<boolean> {
      const found = await t.nextly.find({
        collection,
        overrideAccess: true,
        status: "all",
        depth: 0,
        where: { slug: { equals: slug } },
      });
      return found.items.length > 0;
    }

    it("refuses a page published at, or renamed to, an address an entry holds, naming the entry, and keeps nothing there", async () => {
      const t = await boot();
      await createTemplate(t);
      const entry = await createPost(t, "taken");
      expect(await held(t)).toEqual([`address /blog/taken posts:${entry}`]);

      const published = await refusedWith(createPage(t, "Taken", "blog/taken"));
      expect(NextlyError.isCode(published, "CONFLICT")).toBe(true);
      expect(wordsOf(published)).toContain(
        `/blog/taken is already the address of a document (${entry})`
      );
      expect(await stored(t, "pages", "blog/taken")).toBe(false);
      expect(await held(t)).toEqual([`address /blog/taken posts:${entry}`]);

      const other = await createPage(t, "Other", "blog/other");
      const renamed = await refusedWith(
        updateLive(t, "pages", other, { slug: "blog/taken" })
      );
      expect(NextlyError.isCode(renamed, "CONFLICT")).toBe(true);
      expect(wordsOf(renamed)).toContain(
        `/blog/taken is already the address of a document (${entry})`
      );
      // The rename is rolled back whole: the page keeps its slug and its
      // address, and holds nothing at the entry's.
      expect(await stored(t, "pages", "blog/taken")).toBe(false);
      expect(await stored(t, "pages", "blog/other")).toBe(true);
      expect(await held(t)).toEqual([
        `address /blog/other pages:${other}`,
        `address /blog/taken posts:${entry}`,
      ]);
      expect(
        await pageContent(t).resolveAddress(undefined, "/blog/taken")
      ).toEqual({ collection: "posts", id: entry, kind: "address" });
    });

    /**
     * Publish the post `both` and a page at `blog/both` at once, `first`
     * let through to its claim while the other waits with its transaction
     * open, and the other let go once the first has claimed. The first is
     * held uncommitted until the other is seen blocked on its claim, and
     * only then let commit, so the two claims meet while both are open.
     */
    async function publishAtOnce(t: TestNextly, first: Side) {
      race = newRace(first);
      const second: Side = first === "posts" ? "pages" : "posts";
      const saves = Promise.allSettled([
        createPost(t, "both"),
        createPage(t, "Both", "blog/both"),
      ]);
      const bothOpen =
        (await openedWithin(race.arrived.posts, GATE_MS)) &&
        (await openedWithin(race.arrived.pages, GATE_MS));
      race.go[first].open();
      const firstClaimed = await openedWithin(race.claimed[first], GATE_MS);
      race.go[second].open();
      let secondWaited = false;
      try {
        secondWaited =
          firstClaimed &&
          (await seenWaitingOnALock(t.adapter, dialect, GATE_MS));
      } finally {
        // Let go whatever was seen, so a race that never met ends and fails
        // on its assertions rather than holding the first save open.
        race.released.open();
      }
      const [entry, page] = await saves;
      race.armed = false;
      return { bothOpen, firstClaimed, secondWaited, entry, page };
    }

    /*
     * Concurrent saves, in each order of who claims first. SQLite runs one
     * writer at a time, so two saves there cannot both be open at once and
     * the race cannot happen; either order one after the other is covered
     * on every dialect by the refusal above and the entry claims' own tests.
     */
    describe.skipIf(dialect === "sqlite")("under concurrent saves", () => {
      for (const first of SIDES) {
        const loser: Side = first === "posts" ? "pages" : "posts";
        it(`gives the address to the ${first === "posts" ? "entry" : "page"} when it claims first, refusing the other naming it`, async () => {
          const t = await boot({ plugins: [gatePlugin(() => race)] });
          await settled(t);
          await createTemplate(t);

          const { bothOpen, firstClaimed, secondWaited, entry, page } =
            await publishAtOnce(t, first);
          // The race happened: both saves were open before either claimed,
          // the second claimed only after the first had, and it was blocked
          // on the first's claim while the first was still uncommitted.
          expect(bothOpen).toBe(true);
          expect(firstClaimed).toBe(true);
          expect(
            secondWaited,
            "the second save never waited on the first's claim"
          ).toBe(true);

          const [won, lost] = first === "posts" ? [entry, page] : [page, entry];
          expect(won.status).toBe("fulfilled");
          expect(lost.status).toBe("rejected");
          if (won.status !== "fulfilled" || lost.status !== "rejected") return;
          expect(NextlyError.isCode(lost.reason, "CONFLICT")).toBe(true);
          const words = wordsOf(lost.reason);
          expect(words).toContain("/blog/both is already the address of");
          expect(words).toContain(`(${won.value})`);
          // The winner's claim is the only row left: the refused save
          // keeps no claim, and no wait, of its own.
          expect(await everyClaim(t)).toEqual([
            `address /blog/both ${first}:${won.value}`,
          ]);
          // Nor the document it tried to save.
          expect(
            await stored(t, loser, loser === "posts" ? "both" : "blog/both")
          ).toBe(false);
        });
      }
    });

    /**
     * Two entries saved before their collection has a template, so neither
     * holds an address, and a page at each one's address; then the template
     * is published, leaving both entries waiting.
     */
    async function waitingBehindPages(t: TestNextly) {
      const entry = await createPost(t, "held");
      const page = await createPage(t, "Held", "blog/held");
      await createTemplate(t);
      expect(await held(t)).toEqual([`address /blog/held pages:${page}`]);
      expect(await held(t, ["waiting"])).toEqual([
        `waiting /blog/held posts:${entry}`,
      ]);
      return { entry, page };
    }

    /**
     * The entry was never saved after its creation, though its address
     * moved to it; and the log does see a save of it when there is one.
     */
    async function savedOnlyAtCreation(
      t: TestNextly,
      writes: ReturnType<typeof entryWrites>,
      entry: string
    ): Promise<void> {
      expect(writes.of(entry)).toEqual([`create ${entry}`]);
      await updateLive(t, "posts", entry, { title: "Post held, saved" });
      expect(writes.of(entry)).toEqual([`create ${entry}`, `update ${entry}`]);
    }

    it("hands a waiting entry its address when the page holding it is renamed, without saving the entry", async () => {
      const writes = entryWrites();
      const t = await boot({ plugins: [writes.plugin] });
      const { entry, page } = await waitingBehindPages(t);

      await updateLive(t, "pages", page, { slug: "elsewhere" });
      expect(await held(t)).toEqual([
        `address /blog/held posts:${entry}`,
        `address /elsewhere pages:${page}`,
      ]);
      expect(await held(t, ["waiting"])).toEqual([]);
      const content = pageContent(t);
      expect(await content.resolveAddress(undefined, "/blog/held")).toEqual({
        collection: "posts",
        id: entry,
        kind: "address",
      });
      await savedOnlyAtCreation(t, writes, entry);
    });

    it("hands a waiting entry its address when the page holding it is deleted, without saving the entry", async () => {
      const writes = entryWrites();
      const t = await boot({ plugins: [writes.plugin] });
      const { entry, page } = await waitingBehindPages(t);

      await t.nextly.delete({
        collection: "pages",
        id: page,
        overrideAccess: true,
      });
      expect(await held(t)).toEqual([`address /blog/held posts:${entry}`]);
      expect(await held(t, ["waiting"])).toEqual([]);
      expect(
        await pageContent(t).resolveAddress(undefined, "/blog/held")
      ).toEqual({ collection: "posts", id: entry, kind: "address" });
      await savedOnlyAtCreation(t, writes, entry);
    });

    it("serves a page at /blog beside the collection served from /blog, refusing neither", async () => {
      const t = await boot();
      // A page there before the collection's template is published, and
      // one entry saved after it; then a second page, after both.
      const before = await createPage(t, "Blog", "blog");
      await createTemplate(t);
      const entry = await createPost(t, "hello");
      expect(await held(t)).toEqual([
        `address /blog pages:${before}`,
        `address /blog/hello posts:${entry}`,
      ]);
      expect(await held(t, ["waiting"])).toEqual([]);
      const content = pageContent(t);
      expect(await content.resolveAddress(undefined, "/blog")).toEqual({
        collection: "pages",
        id: before,
        kind: "address",
      });
      expect(await content.resolveAddress(undefined, "/blog/hello")).toEqual({
        collection: "posts",
        id: entry,
        kind: "address",
      });

      // The page given up and published again, now the collection is
      // served: still nothing stands in its way.
      await t.nextly.delete({
        collection: "pages",
        id: before,
        overrideAccess: true,
      });
      const after = await createPage(t, "Blog again", "blog");
      expect(await held(t)).toEqual([
        `address /blog pages:${after}`,
        `address /blog/hello posts:${entry}`,
      ]);
    });

    it("drops an entry's waits under the old address when its collection's address moves", async () => {
      const t = await boot();
      // Saved before the collection has a template, then a page at its
      // address, then the template storing the address: the entry waits.
      const party = await createPost(t, "party", "events");
      const page = await createPage(t, "Party", "events/party");
      const template = await createTemplate(t, "events", "/events");
      expect(await held(t, ["waiting"])).toEqual([
        `waiting /events/party events:${party}`,
      ]);

      await updateLive(t, TEMPLATES_SLUG, template, { address: "/happenings" });
      expect(await held(t, ["waiting"])).toEqual([]);
      expect(await held(t)).toEqual([
        `address /events/party pages:${page}`,
        `address /happenings/party events:${party}`,
      ]);

      // What it waited for under the old address is given up: the entry
      // is handed nothing there.
      await t.nextly.delete({
        collection: "pages",
        id: page,
        overrideAccess: true,
      });
      expect(await held(t)).toEqual([
        `address /happenings/party events:${party}`,
      ]);
      expect(
        await pageContent(t).resolveAddress(undefined, "/events/party")
      ).toBeNull();
    });
  }
);
