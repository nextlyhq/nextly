/**
 * A deploy runs the earlier version of the plugin beside this one for a
 * while: the earlier version kept the address record in the collection
 * `nx_seo_addresses`, and goes on writing it after this version has moved
 * the record to its own tables. These tests write that collection as such a
 * process would, after the move, and show the next start brings the record,
 * its redirects and the moves owed redirects up to date, while a start where
 * nothing was written writes nothing.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { statementsOf, writesAmong } from "../../__tests__/count-statements";
import { moveLoggedRows } from "../../not-found/log";
import { seoPlugin } from "../../plugin";
import {
  PROBLEMS_SLUG,
  readSiteCheck,
  saveSiteCheck,
} from "../../problems/store";
import { redirectsSlug } from "../../redirects/collection";
import { putRedirect, removeRedirect } from "../../redirects/store";
import { addressClaims } from "../../schema/tables";
import { catchUp, lastCatchUp } from "../catch-up";
import { ADDRESS_RECORD_SLUG } from "../collection";
import { pendingMoves } from "../pending-moves";
import { claimKey, sha256 } from "../rows";
import { moveEarlierRecord, noteKey } from "../store";

import {
  forgetNote,
  noteRows,
  recordedRows,
  seoContext,
} from "./record-tables";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  const seen: { ctx?: PluginContext } = {};
  current = await createTestNextly({
    dialect,
    plugins: [
      seoPlugin({ collections: ["pages", "posts", "articles"] }),
      definePlugin({
        name: "@test/context",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx) {
          seen.ctx = ctx;
        },
      }),
    ],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/blog/{slug}",
      }),
      // Served under /blog too: an article and a post can ask for one
      // address, which the record keeps to one of them.
      defineCollection({
        slug: "articles",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/blog/{slug}",
      }),
    ],
  });
  if (!seen.ctx) throw new Error("the helper plugin never started");
  // The start's own catch-up, finished before the test acts.
  await lastCatchUp();
  return { t: current, seo: seoContext() };
}

async function publish(t: TestNextly, collection: string, slug: string) {
  const created = await t.nextly.create({
    collection,
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

const address = (path: string) => claimKey("address", "en", path);

/**
 * Write a row of the earlier collection as a process of the earlier version
 * does: a whole entry save, through the collection.
 */
async function earlierWrites(t: TestNextly, rows: Record<string, unknown>[]) {
  for (const data of rows) {
    await t.nextly.create({ collection: ADDRESS_RECORD_SLUG, data });
  }
}

/** The id of the earlier collection's row under `key`. */
async function earlierRowId(t: TestNextly, key: string) {
  const { items } = await t.nextly.find({
    collection: ADDRESS_RECORD_SLUG,
    where: { claimKey: { equals: key } },
    limit: 1,
  });
  const [row] = items as Record<string, unknown>[];
  if (row === undefined) throw new Error(`no earlier row under ${key}`);
  return String(row.id);
}

/** The earlier collection's lock row for `path`, as a save of it took one. */
const earlierLock = (path: string) => ({
  claimKey: claimKey("lock", "en", path),
  kind: "lock",
  locale: "en",
  path,
});

/** The earlier collection's claim of `path` for `collection`'s entry `id`. */
const earlierClaim = (path: string, collection: string, id: string) => ({
  claimKey: address(path),
  kind: "address",
  locale: "en",
  path,
  holderCollection: collection,
  holderId: id,
});

/** Take `path` out of this version's record, which never heard of a change. */
async function unrecord(seo: PluginContext, path: string) {
  await seo.db
    .delete(addressClaims)
    .where(eq(seo.db.table(addressClaims).claimKey, address(path)));
}

/** Put `path` back in this version's record for `collection`'s entry `id`. */
async function record(
  seo: PluginContext,
  path: string,
  collection: string,
  id: string
) {
  await seo.db.insert(addressClaims, {
    claimKey: address(path),
    kind: "address",
    locale: "en",
    path,
    holderCollection: collection,
    holderId: id,
  });
}

/**
 * Wait until the check each save of `ids` starts has written its page's row:
 * it runs after the save, and marks the full check out of date where a
 * page's result changed.
 */
async function pagesChecked(t: TestNextly, ids: readonly string[]) {
  for (let tries = 0; tries < 100; tries++) {
    const { items } = await t.nextly.find({
      collection: PROBLEMS_SLUG,
      limit: 100,
    });
    const checked = new Set(
      (items as Record<string, unknown>[]).map(row => String(row.holderId))
    );
    if (ids.every(id => checked.has(id))) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("the saved pages were never checked");
}

/** The redirects saved from `source`. */
async function redirectsFrom(
  t: TestNextly,
  seo: PluginContext,
  source: string
) {
  const { items } = await t.nextly.find({
    collection: redirectsSlug(seo),
    where: { source: { equals: source } },
    limit: 10,
  });
  return items as Record<string, unknown>[];
}

/**
 * Stop this process's clock at `at`, as every write it makes and every time
 * it reads is stamped: the earlier version's servers and this one stamp rows
 * and readings by the clock of the process.
 */
function clockAt(at: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

/** A whole second, so a time kept to the second keeps it exactly. */
const wholeSecond = () => Math.floor(Date.now() / 1000) * 1000;

/** Save a redirect as a person would, from `source` to `target`. */
async function savedRedirect(
  seo: PluginContext,
  source: string,
  target: string
) {
  const outcome = await seo.services.collections.withTransaction(tx =>
    putRedirect(seo, tx, { locale: "en", source, target, origin: "person" })
  );
  if (!("saved" in outcome)) throw new Error(outcome.refused);
  return outcome.saved.id;
}

describe.each(getConfiguredTestDialects())(
  "the address record after an earlier version wrote its collection (%s)",
  dialect => {
    it("records a page an earlier version's process published after the move, and refuses its address to another", async () => {
      const { t, seo } = await boot(dialect);
      const id = await publish(t, "posts", "old-only");
      // Published by the earlier version: claimed in its collection, never
      // in this version's record.
      await unrecord(seo, "/blog/old-only");
      await earlierWrites(t, [
        earlierLock("/blog/old-only"),
        earlierClaim("/blog/old-only", "posts", id),
      ]);

      const report = await catchUp();

      expect(report.ran).toBe(true);
      expect((await recordedRows(seo))["en|/blog/old-only"]).toBe(
        `posts:${id}`
      );
      // An article, not a second post: posts' own slugs are unique already,
      // so only the record keeps another page off the address.
      await expect(publish(t, "articles", "old-only")).rejects.toMatchObject({
        code: "DUPLICATE",
      });
    });

    it("lets go of the address of a page an earlier version's process deleted after the move", async () => {
      const { t, seo } = await boot(dialect);
      const id = await publish(t, "posts", "gone");
      // Deleted by the earlier version: its claim let go of there only, so
      // this version's record still says the page holds the address.
      await t.nextly.delete({ collection: "posts", id });
      await record(seo, "/blog/gone", "posts", id);
      await earlierWrites(t, [earlierLock("/blog/gone")]);

      await catchUp();

      expect((await recordedRows(seo))["en|/blog/gone"]).toBeUndefined();
      await expect(publish(t, "posts", "gone")).resolves.toBeTruthy();
    });

    it("records a slug change an earlier version's process saved, and the redirect it left answers here", async () => {
      const { t, seo } = await boot(dialect);
      const id = await publish(t, "posts", "before");
      await t.nextly.update({
        collection: "posts",
        id,
        data: { slug: "after", _overwrite: true },
      });
      const [redirect] = await redirectsFrom(t, seo, "/blog/before");
      if (redirect === undefined) throw new Error("no redirect was saved");
      const redirectId = String(redirect.id);
      // Saved by the earlier version: this version's record still says the
      // post holds its old address, and knows nothing of the redirect.
      await unrecord(seo, "/blog/after");
      await unrecord(seo, "/blog/before");
      await record(seo, "/blog/before", "posts", id);
      await earlierWrites(t, [
        earlierLock("/blog/after"),
        earlierClaim("/blog/after", "posts", id),
        earlierClaim("/blog/before", redirectsSlug(seo), redirectId),
      ]);

      await catchUp();

      const held = await recordedRows(seo);
      expect(held["en|/blog/after"]).toBe(`posts:${id}`);
      // The redirect holds its From address again, so the Proxy answers it.
      expect(held["en|/blog/before"]).toBe(
        `${redirectsSlug(seo)}:${redirectId}`
      );
      expect(await redirectsFrom(t, seo, "/blog/before")).toHaveLength(1);
    });

    it("makes the redirect a move an earlier version's process noted after the move is owed", async () => {
      const { t, seo } = await boot(dialect);
      const id = await publish(t, "posts", "now");
      // The earlier version's start moved this post off /blog/was and noted
      // the redirect it owes, in its collection.
      await earlierWrites(t, [
        {
          claimKey: sha256(`pending:posts:${id}|address:en|/blog/was`),
          kind: "pending",
          locale: "en",
          path: JSON.stringify({ locale: "en", path: "/blog/was" }),
          holderCollection: "posts",
          holderId: id,
        },
      ]);

      await catchUp();

      const [made] = await redirectsFrom(t, seo, "/blog/was");
      expect(made).toMatchObject({ target: "/blog/now" });
      expect(await pendingMoves(seo)).toEqual([]);
    });

    it("repairs a site whose record moved before its shape was kept, owed redirects included", async () => {
      const { t, seo } = await boot(dialect);
      const id = await publish(t, "posts", "kept");
      // Moved by a release that kept no shape: what was written after it
      // cannot be told from what was moved, so all of it is taken in.
      await forgetNote("record-drained", seo);
      await unrecord(seo, "/blog/kept");
      await earlierWrites(t, [
        {
          claimKey: sha256(`pending:posts:${id}|address:en|/blog/kept-was`),
          kind: "pending",
          locale: "en",
          path: JSON.stringify({ locale: "en", path: "/blog/kept-was" }),
          holderCollection: "posts",
          holderId: id,
        },
      ]);

      expect((await catchUp()).ran).toBe(true);

      expect((await recordedRows(seo))["en|/blog/kept"]).toBe(`posts:${id}`);
      const [made] = await redirectsFrom(t, seo, "/blog/kept-was");
      expect(made).toMatchObject({ target: "/blog/kept" });
    });

    it("hands a redirect's From address to the one an earlier version's process saved in place of it", async () => {
      const { t, seo } = await boot(dialect);
      const slug = redirectsSlug(seo);
      const removed = await savedRedirect(seo, "/blog/from", "/elsewhere");
      // Removed on the earlier version, and another saved from the same
      // address: only that version's record heard of either.
      await t.nextly.delete({ collection: slug, id: removed });
      const { item } = await t.nextly.create({
        collection: slug,
        data: {
          sourceKey: createHash("sha256")
            .update("en|/blog/from", "utf8")
            .digest("hex"),
          source: "/blog/from",
          locale: "en",
          target: "/somewhere-else",
          origin: "person",
        },
      });
      const replacement = String(item.id);
      expect((await recordedRows(seo))["en|/blog/from"]).toBe(
        `${slug}:${removed}`
      );
      await earlierWrites(t, [earlierClaim("/blog/from", slug, replacement)]);

      await catchUp();

      expect((await recordedRows(seo))["en|/blog/from"]).toBe(
        `${slug}:${replacement}`
      );
    });

    it("reads again a shape it read close to the newest write, however long the repair took", async () => {
      const { t, seo } = await boot(dialect);
      const at = wholeSecond();
      clockAt(at);
      await earlierWrites(t, [earlierLock("/blog/first")]);
      let late = "";
      await catchUp({
        // While the repair runs, in the second its shape was read in, an
        // earlier version's process publishes a page: the count and the
        // newest time stay as they were read. The repair then runs long.
        afterListing: async () => {
          late = await publish(t, "posts", "late");
          await unrecord(seo, "/blog/late");
          await t.nextly.delete({
            collection: ADDRESS_RECORD_SLUG,
            id: await earlierRowId(t, claimKey("lock", "en", "/blog/first")),
          });
          await earlierWrites(t, [earlierClaim("/blog/late", "posts", late)]);
          vi.setSystemTime(at + 11 * 60 * 1000);
        },
      });
      expect((await recordedRows(seo))["en|/blog/late"]).toBeUndefined();

      await catchUp();

      expect((await recordedRows(seo))["en|/blog/late"]).toBe(`posts:${late}`);
    });

    it("takes over a move an earlier version's process noted with a clock behind, once", async () => {
      const { t, seo } = await boot(dialect);
      const id = await publish(t, "posts", "here");
      const at = wholeSecond();
      clockAt(at);
      await earlierWrites(t, [earlierLock("/blog/first")]);
      await catchUp({ settleMs: 0 });
      // Noted by a process whose clock is a minute behind.
      clockAt(at - 60_000);
      await earlierWrites(t, [
        {
          claimKey: sha256(`pending:posts:${id}|address:en|/blog/there`),
          kind: "pending",
          locale: "en",
          path: JSON.stringify({ locale: "en", path: "/blog/there" }),
          holderCollection: "posts",
          holderId: id,
        },
      ]);
      clockAt(at + 1_000);

      await catchUp({ settleMs: 0 });

      const [made] = await redirectsFrom(t, seo, "/blog/there");
      expect(made).toMatchObject({ target: "/blog/here" });
      // Removed by a person, it is not made again when the earlier version
      // writes again: the move was taken over once.
      await seo.services.collections.withTransaction(tx =>
        removeRedirect(seo, tx, String(made?.id))
      );
      clockAt(at + 2_000);
      await earlierWrites(t, [earlierLock("/blog/second")]);
      await catchUp({ settleMs: 0 });
      expect(await redirectsFrom(t, seo, "/blog/there")).toEqual([]);
    });

    it("says the SEO Problems list is out of date when a page lost its address in the catch-up", async () => {
      const { t, seo } = await boot(dialect);
      // The earlier version published a post at /blog/both; this version,
      // not knowing, let an article take it too.
      const first = await publish(t, "posts", "both");
      await unrecord(seo, "/blog/both");
      const second = await publish(t, "articles", "both");
      await pagesChecked(t, [first, second]);
      await earlierWrites(t, [
        earlierLock("/blog/both"),
        earlierClaim("/blog/both", "posts", first),
      ]);
      const now = new Date().toISOString();
      await saveSiteCheck(seo, {
        startedAt: now,
        checkedAt: now,
        pagesChecked: 2,
        problems: [],
      });
      expect((await readSiteCheck(seo)).outOfDate).toBe(false);

      const report = await catchUp();

      // The page already holding the address keeps it.
      expect(report.lost.map(lost => lost.holder.id)).toEqual([first]);
      expect((await readSiteCheck(seo)).outOfDate).toBe(true);
    });

    it("keeps a drained note for each move, and a start that finds nothing new writes nothing", async () => {
      const { t, seo } = await boot(dialect);
      await moveLoggedRows(seo);
      const notes = new Map(
        (await noteRows(seo)).map(row => [String(row.noteKey), row.value])
      );
      expect(JSON.parse(String(notes.get(noteKey("record-drained"))))).toEqual(
        expect.objectContaining({ rows: 0, newest: null })
      );
      expect(notes.get(noteKey("not-found-drained"))).toEqual(
        expect.any(String)
      );

      // After a repair too: the shape it kept is the shape found.
      const id = await publish(t, "posts", "quiet");
      await unrecord(seo, "/blog/quiet");
      await earlierWrites(t, [earlierClaim("/blog/quiet", "posts", id)]);
      expect((await catchUp()).ran).toBe(true);

      const statements = await statementsOf(dialect, async () => {
        // Read as far from the newest write as a later start would.
        expect((await catchUp({ settleMs: 0 })).ran).toBe(false);
        expect(await moveEarlierRecord(seo)).toBe(0);
        await moveLoggedRows(seo);
      });

      expect(writesAmong(statements)).toEqual([]);
    });
  }
);
