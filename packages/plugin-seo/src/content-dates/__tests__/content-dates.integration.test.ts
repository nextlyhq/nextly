/**
 * A page's sitemap date moves only when its published content changes, on
 * every configured dialect: an SEO-only change, a save that changes
 * nothing and a draft leave it; a content change moves it to that save. A
 * page with no date kept yet takes its own last save, and reading the
 * sitemap writes nothing. A deleted page's dates go, the full check prunes
 * any a page no longer holds, and a recording repeated, or two at once,
 * leave one row with one date.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text } from "nextly";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import { contentDates } from "../../schema/tables";
import { contentDatesSettled, recordSaved } from "../hooks";
import { pageDateKey, pruneContentDates } from "../store";

const SITE = "https://acme.example";
// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const PAGES = "seocd_pages";
const POSTS = "seocd_posts";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A plugin that hands its context over. */
function contextOf() {
  const seen: { ctx?: PluginContext } = {};
  const plugin = definePlugin({
    name: "@test/content-dates-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      seen.ctx = ctx;
    },
  });
  return { plugin, seen };
}

async function boot(dialect: TestDialect) {
  const { plugin, seen } = contextOf();
  current = await createTestNextly({
    dialect,
    plugins: [
      seoPlugin({
        collections: [PAGES, POSTS],
        singles: ["seocd_home"],
        baseUrl: SITE,
      }),
      plugin,
    ],
    collections: [
      defineCollection({
        slug: PAGES,
        status: true,
        // Edits to a published page are held as a working draft.
        versions: { drafts: true },
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
      defineCollection({
        slug: POSTS,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          text({ name: "body" }),
        ],
        publicAddress: "/blog/{slug}",
      }),
    ],
    singles: [
      defineSingle({
        slug: "seocd_home",
        fields: [text({ name: "title" })],
        publicAddress: "/",
      }),
    ],
  });
  const ctx = seen.ctx;
  if (!ctx) throw new Error("the probe plugin never started");
  await lastCatchUp();
  return { t: current, ctx };
}

/** The `<lastmod>` the sitemap gives the page at `loc`, once dates settle. */
async function lastmodOf(loc: string): Promise<string | undefined> {
  await contentDatesSettled();
  const response = await createDynamicHandlers().GET(
    new Request(`${SITE}/admin/api/sitemap.xml`),
    { params: Promise.resolve({ params: ["sitemap.xml"] }) }
  );
  const line = (await response.text())
    .split("\n")
    .find(each => each.includes(`<url><loc>${loc}</loc>`));
  if (line === undefined) throw new Error(`${loc} is not listed`);
  return /<lastmod>([^<]+)<\/lastmod>/.exec(line)?.[1];
}

/** The rows kept, as stored. */
async function rows(ctx: PluginContext): Promise<Record<string, unknown>[]> {
  return (await ctx.db.select(contentDates).all()) as unknown as Record<
    string,
    unknown
  >[];
}

/** Timestamps may be kept to the second: a later save is a later second. */
const nextSecond = () => new Promise(resolve => setTimeout(resolve, 1_100));

async function create(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>
): Promise<{ id: string; updatedAt: string }> {
  const { item } = await t.nextly.create({ collection, data });
  return { id: String(item.id), updatedAt: String(item.updatedAt) };
}

/**
 * A date to the second, as every dialect keeps a timestamp: MySQL keeps
 * the plugin's own to the second.
 */
const second = (value: unknown) =>
  new Date(String(value)).toISOString().slice(0, 19);

describe.each(getConfiguredTestDialects())(
  "a page's sitemap date (%s)",
  dialect => {
    it("stays for an SEO-only change, a save that changes nothing and a status saved again, and moves with a content change", async () => {
      const { t } = await boot(dialect);
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        body: "First words.",
        status: "published",
      });
      const loc = `${SITE}/blog/hello`;
      const first = await lastmodOf(loc);
      expect(second(first)).toBe(second(post.updatedAt));

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { seo: { metaTitle: "Hello, world" } },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { title: "Hello", body: "First words." },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { status: "published" },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      const { item } = await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { body: "Rewritten." },
      });
      const moved = await lastmodOf(loc);
      expect(moved).not.toBe(first);
      expect(second(moved)).toBe(second(item.updatedAt));
    });

    it("leaves the date while a change is a draft, and moves it when the change is published", async () => {
      const { t } = await boot(dialect);
      const page = await create(t, PAGES, {
        title: "About",
        slug: "about",
        status: "published",
      });
      const loc = `${SITE}/about`;
      const first = await lastmodOf(loc);

      await nextSecond();
      // A save that names no status is held as the working draft.
      await t.nextly.update({
        collection: PAGES,
        id: page.id,
        data: { title: "About us, rewritten", _overwrite: true },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      await t.nextly.update({
        collection: PAGES,
        id: page.id,
        data: {
          title: "About us, rewritten",
          status: "published",
          _overwrite: true,
        },
      });
      expect(await lastmodOf(loc)).not.toBe(first);
    });

    it("keeps a Single's date until its content changes", async () => {
      const { t } = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "seocd_home",
        data: { title: "Acme", _overwrite: true },
      });
      const loc = `${SITE}/`;
      const first = await lastmodOf(loc);
      expect(first).toBeDefined();

      await nextSecond();
      await t.nextly.updateSingle({
        slug: "seocd_home",
        data: { title: "Acme", seo: { metaTitle: "Acme, home" } },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      await t.nextly.updateSingle({
        slug: "seocd_home",
        data: { title: "Acme, welcome" },
      });
      expect(await lastmodOf(loc)).not.toBe(first);
    });

    it("gives a page with no date kept its own last save, and writes nothing while the sitemap is read", async () => {
      const { t, ctx } = await boot(dialect);
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await contentDatesSettled();
      // As a page saved before the dates were kept: no row.
      await ctx.db.delete(contentDates);
      expect(await rows(ctx)).toEqual([]);

      expect(second(await lastmodOf(`${SITE}/blog/hello`))).toBe(
        second(post.updatedAt)
      );
      expect(await rows(ctx)).toEqual([]);
    });

    it("gives a page with no row the date it already had where its first save changes only its SEO", async () => {
      const { t, ctx } = await boot(dialect);
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await contentDatesSettled();
      await ctx.db.delete(contentDates);

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { seo: { metaTitle: "Hello, world" } },
      });
      expect(second(await lastmodOf(`${SITE}/blog/hello`))).toBe(
        second(post.updatedAt)
      );
      expect(await rows(ctx)).toHaveLength(1);
    });

    it("forgets a deleted page's dates, and the full check prunes any a page no longer holds", async () => {
      const { t, ctx } = await boot(dialect);
      const kept = await create(t, POSTS, {
        title: "Kept",
        slug: "kept",
        status: "published",
      });
      const gone = await create(t, POSTS, {
        title: "Gone",
        slug: "gone",
        status: "published",
      });
      await contentDatesSettled();
      expect(await rows(ctx)).toHaveLength(2);

      await t.nextly.delete({ collection: POSTS, id: gone.id });
      await contentDatesSettled();
      expect((await rows(ctx)).map(row => row.holderId)).toEqual([kept.id]);

      // A row whose page went while the plugin did not run.
      const orphan = { collection: POSTS, id: "no-such-page" };
      await ctx.db.insert(contentDates, {
        pageKey: pageDateKey(orphan, "en"),
        holderCollection: orphan.collection,
        holderId: orphan.id,
        locale: "en",
        fingerprint: "0".repeat(64),
        changedAt: new Date(),
      });
      await pruneContentDates(ctx);
      expect((await rows(ctx)).map(row => row.holderId)).toEqual([kept.id]);
    });

    it("keeps one row with one date when a page is recorded twice, or twice at once", async () => {
      const { t, ctx } = await boot(dialect);
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await contentDatesSettled();
      await ctx.db.delete(contentDates);
      const holder = { collection: POSTS, id: post.id };

      await Promise.all([
        recordSaved(ctx, holder, undefined),
        recordSaved(ctx, holder, undefined),
      ]);
      await recordSaved(ctx, holder, undefined);

      const kept = await rows(ctx);
      expect(kept).toHaveLength(1);
      expect(second(kept[0]?.changedAt)).toBe(second(post.updatedAt));
    });
  }
);
