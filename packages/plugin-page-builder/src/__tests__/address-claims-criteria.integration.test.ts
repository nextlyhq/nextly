/**
 * Entries and pages contending for one served address, through real saves:
 * who is refused, who waits, and who is handed the address once its holder
 * lets it go.
 *
 * What separates a correct wiring from a plausible broken one:
 * - a page published at an address an entry holds is refused, naming the
 *   entry, and keeps nothing, page or claim;
 * - an entry's save and a page's save for one address at once leave exactly
 *   one holder, the other refused naming it, and one claim stored;
 * - an entry left waiting behind a page is handed the address when the page
 *   is renamed or deleted, without the entry being saved again;
 * - a page at `/blog` and a collection served from `/blog` never contend:
 *   the collection's address claims no path;
 * - a site upgrading with entries whose addresses pages hold keeps each page
 *   at its address and leaves the entry waiting, then serves it once the
 *   page lets the address go;
 * - moving a collection's address drops its entries' waits under the old
 *   one, so releasing what they waited for there hands them nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createAdapter } from "nextly/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { TEMPLATES_SLUG } from "../collections/templates";
import { asOverwrite } from "../document-version";
import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";

const PLAIN_PAGE = { formatVersion: 1, kind: "page", nodes: [] };
const TEMPLATE = { formatVersion: 1, kind: "template", nodes: [] };

/** Where the posts collection is served, declared in code. */
const ADDRESSES = { posts: "/blog" };

const idOf = (created: unknown): string =>
  String((created as { item: { id: unknown } }).item.id);

/** The words a refused write gives, as its caller reads them. */
async function refusal(write: Promise<unknown>): Promise<string> {
  const error = (await write.then(
    () => undefined,
    (caught: unknown) => caught
  )) as { publicMessage?: unknown; message?: unknown } | undefined;
  if (error === undefined) return "no refusal";
  return String(error.publicMessage ?? error.message);
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

/** Every claim row of `kinds`: its kind, path and holder, sorted. */
async function held(
  t: TestNextly,
  kinds: readonly string[] = ["address", "space"]
): Promise<string[]> {
  const found = await t.nextly.find({
    collection: ADDRESS_CLAIMS_SLUG,
    overrideAccess: true,
    depth: 0,
    limit: 200,
  });
  return (found.items as Record<string, unknown>[])
    .filter(row => kinds.includes(String(row.kind)))
    .map(
      row =>
        `${String(row.kind)} ${String(row.path)} ${String(row.holderCollection)}:${String(row.holderId)}`
    )
    .sort();
}

/** When the entry `id` of `collection` was last saved, as stored. */
async function savedAt(
  t: TestNextly,
  collection: string,
  id: string
): Promise<unknown> {
  const row = (await t.nextly.findByID({
    collection,
    id,
    overrideAccess: true,
    depth: 0,
  })) as unknown as Record<string, unknown>;
  return row.updatedAt;
}

/**
 * Two saves held at the start of their in-transaction phase until both
 * have reached it, or two seconds pass: each has written its own row, and
 * neither has read or claimed an address yet, so both then claim at once.
 * Registered before the page builder's own handlers, so it runs first.
 */
function raceGate() {
  let armed = false;
  let arrived = 0;
  let bothArrived: () => void = () => undefined;
  const together = new Promise<void>(resolve => {
    bothArrived = resolve;
  });
  const meet = async (): Promise<void> => {
    if (!armed) return;
    arrived += 1;
    if (arrived === 2) bothArrived();
    await Promise.race([
      together,
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
  };
  return {
    arm: () => {
      armed = true;
    },
    /** How many saves reached the gate. */
    arrivals: () => arrived,
    plugin: definePlugin({
      name: "@t/claims-race-gate",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        ctx.hooks.onInTransaction("pages", meet);
        ctx.hooks.onInTransaction("posts", meet);
      },
    }),
  };
}

describe.each(getConfiguredTestDialects())(
  "entries and pages contending for an address (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
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

    it("refuses a page published at an address an entry holds, naming the entry, and keeps nothing", async () => {
      const t = await boot();
      await createTemplate(t);
      const entry = await createPost(t, "taken");
      expect(await held(t)).toEqual([`address /blog/taken posts:${entry}`]);

      const words = await refusal(createPage(t, "Taken", "blog/taken"));
      expect(words).toContain(
        `/blog/taken is already the address of a document (${entry})`
      );
      const pages = await t.nextly.find({
        collection: "pages",
        overrideAccess: true,
        status: "all",
        depth: 0,
        where: { slug: { equals: "blog/taken" } },
      });
      expect(pages.items).toHaveLength(0);
      expect(await held(t)).toEqual([`address /blog/taken posts:${entry}`]);
      expect(
        await pageContent(t).resolveAddress(undefined, "/blog/taken")
      ).toEqual({ collection: "posts", id: entry, kind: "address" });
    });

    /*
     * Concurrent saves. SQLite runs one writer at a time, so the race below
     * cannot happen there; PostgreSQL and MySQL run both at once. Either
     * order is covered on every dialect by the refusals above and in the
     * entry claims' own tests.
     */
    describe.skipIf(dialect === "sqlite")("under concurrent saves", () => {
      it("gives an address one entry and one page save at once to exactly one, refusing the other naming it", async () => {
        const gate = raceGate();
        const t = await boot({ plugins: [gate.plugin] });
        await createTemplate(t);
        await settled(t);

        gate.arm();
        const [entrySave, pageSave] = await Promise.allSettled([
          createPost(t, "both"),
          createPage(t, "Both", "blog/both"),
        ]);
        // Both saves were in their transactions together: a race, not two
        // saves one after the other.
        expect(gate.arrivals()).toBe(2);
        expect([entrySave.status, pageSave.status].sort()).toEqual([
          "fulfilled",
          "rejected",
        ]);

        const [winner, loser] =
          entrySave.status === "fulfilled"
            ? [{ collection: "posts", id: entrySave.value }, pageSave]
            : [
                {
                  collection: "pages",
                  id: pageSave.status === "fulfilled" ? pageSave.value : "",
                },
                entrySave,
              ];
        const reason =
          loser.status === "rejected"
            ? (loser.reason as { publicMessage?: unknown; message?: unknown })
            : undefined;
        const words = String(reason?.publicMessage ?? reason?.message);
        expect(words).toContain("/blog/both is already the address of");
        expect(words).toContain(`(${winner.id})`);

        expect(await held(t)).toEqual([
          `address /blog/both ${winner.collection}:${winner.id}`,
        ]);
        // The refused save kept nothing of its own.
        const loserCollection =
          winner.collection === "posts" ? "pages" : "posts";
        const kept = await t.nextly.find({
          collection: loserCollection,
          overrideAccess: true,
          status: "all",
          depth: 0,
        });
        expect(kept.items).toHaveLength(0);
      });
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
      return { entry, page, saved: await savedAt(t, "posts", entry) };
    }

    it("hands a waiting entry its address when the page holding it is renamed, without saving the entry", async () => {
      const t = await boot();
      const { entry, page, saved } = await waitingBehindPages(t);

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
      expect(await savedAt(t, "posts", entry)).toEqual(saved);
    });

    it("hands a waiting entry its address when the page holding it is deleted, without saving the entry", async () => {
      const t = await boot();
      const { entry, page, saved } = await waitingBehindPages(t);

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
      expect(await savedAt(t, "posts", entry)).toEqual(saved);
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

/**
 * A site upgrading to the address store: its pages and entries are there,
 * and the store is empty. Two boots on one database, the first to make the
 * content and the second to run the start-up passes over it.
 *
 * SQLite alone: the harness gives each PostgreSQL and MySQL boot a database
 * of its own and drops it at the next boot, while a SQLite file is a
 * database two boots can share. The start-up passes read and write through
 * the same collections service on every dialect.
 */
describe("a site upgrading with entries whose addresses pages hold (sqlite)", () => {
  let site: TestNextly | undefined;
  let folder: string | undefined;

  afterEach(async () => {
    await site?.destroy();
    site = undefined;
    vi.unstubAllEnvs();
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
    folder = undefined;
  });

  /**
   * A boot on the file at `url`. Core's environment names it for as long as
   * the site runs, not only while the adapter is made: a boot on a supplied
   * adapter reads the dialect from the environment again, and with none set
   * it answers for another dialect than this file's.
   */
  async function bootOn(url: string): Promise<TestNextly> {
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("DB_DIALECT", "sqlite");
    site = await createTestNextly({
      adapter: await createAdapter({ type: "sqlite", url }),
      plugins: [pageBuilder({ templates: { addresses: ADDRESSES } })],
      collections: [entries("posts", "Post"), entries("events", "Event")],
    });
    return site;
  }

  it("keeps each page at its address, leaves the entry waiting, and serves it once the page lets the address go", async () => {
    folder = mkdtempSync(join(tmpdir(), "pb-claims-upgrade-"));
    const url = `file:${join(folder, "site.db")}`;

    // 1. The site as it stood: two entries, a page at one's address, and
    // the collection's template published.
    let t = await bootOn(url);
    const free = await createPost(t, "free");
    const waiting = await createPost(t, "taken");
    const page = await createPage(t, "Taken", "blog/taken");
    await createTemplate(t);
    await settled(t);
    // The store as it was before the site had one.
    for (;;) {
      const found = await t.nextly.find({
        collection: ADDRESS_CLAIMS_SLUG,
        overrideAccess: true,
        depth: 0,
        limit: 200,
      });
      if (found.items.length === 0) break;
      for (const row of found.items as Record<string, unknown>[]) {
        await t.nextly.delete({
          collection: ADDRESS_CLAIMS_SLUG,
          id: String(row.id),
          overrideAccess: true,
        });
      }
    }
    expect(await held(t, ["address", "space", "waiting"])).toEqual([]);
    await t.destroy();
    site = undefined;

    // 2. The site starting on the same database: the passes claim pages
    // first, so the page keeps its address and the entry waits for it.
    t = await bootOn(url);
    await settled(t);
    expect(await held(t)).toEqual([
      `address /blog/free posts:${free}`,
      `address /blog/taken pages:${page}`,
    ]);
    expect(await held(t, ["waiting"])).toEqual([
      `waiting /blog/taken posts:${waiting}`,
    ]);
    const content = pageContent(t);
    expect(await content.resolveAddress(undefined, "/blog/taken")).toEqual({
      collection: "pages",
      id: page,
      kind: "address",
    });

    // 3. The page unpublished: the waiting entry is served, never saved.
    await updateLive(t, "pages", page, { status: "draft" });
    expect(await held(t)).toEqual([
      `address /blog/free posts:${free}`,
      `address /blog/taken posts:${waiting}`,
    ]);
    expect(await held(t, ["waiting"])).toEqual([]);
    expect(await content.resolveAddress(undefined, "/blog/taken")).toEqual({
      collection: "posts",
      id: waiting,
      kind: "address",
    });
  });
});
