/**
 * The SEO plugin brings its address record up to date at start: a site with
 * content when the plugin arrives, or addresses a deploy moved, is recorded
 * without any save, the page already holding an address keeping it.
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
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import { catchUp, lastCatchUp } from "../catch-up";
import { ADDRESS_RECORD_SLUG } from "../collection";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A plugin that hands its context over, to move addresses directly. */
function contextOf() {
  const seen: { ctx?: PluginContext } = {};
  const plugin = definePlugin({
    name: "@test/address-mover",
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
    plugins: [seoPlugin({ collections: ["pages", "posts"] }), plugin],
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
        publicAddress: "/{slug}",
      }),
    ],
  });
  const ctx = seen.ctx;
  if (!ctx) throw new Error("the helper plugin never started");
  // The start-up catch-up of an empty site, finished before the test acts.
  await lastCatchUp();
  return { t: current, ctx };
}

async function publish(t: TestNextly, collection: string, slug: string) {
  const created = await t.nextly.create({
    collection,
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

/** Every row of the record, address rows as `locale|path` → `collection:id`. */
async function rows(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: ADDRESS_RECORD_SLUG,
    limit: 500,
  });
  return items as Record<string, unknown>[];
}

async function recorded(t: TestNextly) {
  return Object.fromEntries(
    (await rows(t))
      .filter(row => row.kind === "address" || row.kind === "range")
      .map(row => [
        `${row.locale}|${row.path}`,
        `${row.holderCollection}:${row.holderId}`,
      ])
  );
}

/** Empty the record, as on a site the plugin has just been added to. */
async function forget(t: TestNextly) {
  for (const row of await rows(t)) {
    await t.nextly.delete({
      collection: ADDRESS_RECORD_SLUG,
      id: String(row.id),
    });
  }
}

/** Forget the fingerprint of the last run, as a changed template would. */
async function forgetFingerprint(t: TestNextly) {
  for (const row of await rows(t)) {
    // The fingerprint alone; the list of site types beside it stays.
    if (row.kind === "meta" && !String(row.path).startsWith("[")) {
      await t.nextly.delete({
        collection: ADDRESS_RECORD_SLUG,
        id: String(row.id),
      });
    }
  }
}

/** Run the catch-up again, as the next start would. */
async function restart() {
  const run = lastCatchUp();
  if (run === undefined) throw new Error("no catch-up ever started");
  return catchUp();
}

describe.each(getConfiguredTestDialects())(
  "the SEO plugin catches its address record up (%s)",
  dialect => {
    it("records a site's published content at its first start", async () => {
      const { t } = await boot(dialect);
      const page = await publish(t, "pages", "hello");
      await forget(t);
      expect(await recorded(t)).toEqual({});

      const report = await restart();

      expect(report.ran).toBe(true);
      expect(await recorded(t)).toEqual({ "en|/hello": `pages:${page}` });
    });

    it("changes nothing on a start where nothing changed", async () => {
      const { t } = await boot(dialect);
      await publish(t, "pages", "hello");
      await restart();

      const report = await restart();

      expect(report.ran).toBe(false);
    });

    it("of two pages recorded by neither, the older takes the address", async () => {
      const { t } = await boot(dialect);
      const page = await publish(t, "pages", "hello");
      await forget(t);
      // Some databases keep creation times to the second: the second page is
      // made in a later one, so which is older is beyond doubt.
      await new Promise(resolve => setTimeout(resolve, 1_100));
      // A second page at the same address, made while nothing was recorded.
      const post = await publish(t, "posts", "hello");
      await forget(t);

      const report = await restart();

      expect(await recorded(t)).toEqual({ "en|/hello": `pages:${page}` });
      expect(report.lost).toEqual([
        expect.objectContaining({
          holder: expect.objectContaining({ collection: "posts", id: post }),
          address: { locale: "en", path: "/hello" },
        }),
      ]);
    });

    it("the page already holding an address keeps it, even if newer", async () => {
      const { t, ctx } = await boot(dialect);
      const page = await publish(t, "pages", "hello");
      await forget(t);
      const post = await publish(t, "posts", "hello");
      await forget(t);
      // As an earlier start left it: the newer page holds the address.
      await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            {
              holder: { collection: "posts", id: post },
              holds: [{ locale: "en", path: "/hello" }],
            },
          ],
          tx
        )
      );

      const report = await restart();

      expect(await recorded(t)).toEqual({ "en|/hello": `posts:${post}` });
      expect(report.lost.map(lost => lost.holder.id)).toEqual([page]);
    });

    it("a deploy that moves one page off an address and another onto it is no clash", async () => {
      const { t, ctx } = await boot(dialect);
      const a = await publish(t, "pages", "new-home");
      const b = await publish(t, "pages", "old-home");
      await forget(t);
      // As before the deploy: A held /old-home, which B now resolves to.
      await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            {
              holder: { collection: "pages", id: a },
              holds: [{ locale: "en", path: "/old-home" }],
            },
          ],
          tx
        )
      );

      const report = await restart();

      expect(report.lost).toEqual([]);
      expect(await recorded(t)).toEqual({
        "en|/new-home": `pages:${a}`,
        "en|/old-home": `pages:${b}`,
      });
    });

    it("leaves a page as a save made while it runs recorded it", async () => {
      const { t } = await boot(dialect);
      const page = await publish(t, "pages", "old");
      await forget(t);

      // The catch-up has read the page at /old; the editor then moves it to
      // /new, which the save records, before the catch-up records anything.
      const report = await catchUp({
        afterListing: async () => {
          await t.nextly.update({
            collection: "pages",
            id: page,
            data: { slug: "new", _overwrite: true },
          });
        },
      });

      expect(report.ran).toBe(true);
      expect(await recorded(t)).toEqual({ "en|/new": `pages:${page}` });
      // The page still holds /new: another page is refused it.
      await expect(publish(t, "posts", "new")).rejects.toMatchObject({
        code: "DUPLICATE",
      });
    });

    it("lets go of a type removed since the last run, and keeps a plugin's own holder", async () => {
      const { t, ctx } = await boot(dialect);
      const hold = (collection: string, id: string, path: string) =>
        ctx.services.collections.withTransaction(tx =>
          ctx.publicAddresses.move(
            [
              {
                holder: { collection, id },
                holds: [{ locale: "en", path }],
              },
            ],
            tx
          )
        );
      // As a site whose `articles` type was later removed, or pruned, left it.
      await hold("articles", "1", "/article");
      // A plugin's own page, never one of the site's types.
      await hold("lists", "1", "/list");
      await restart();
      const [types] = (await rows(t)).filter(
        row => row.kind === "meta" && String(row.path).startsWith("[")
      );
      if (types === undefined) throw new Error("no site types were stored");
      await t.nextly.update({
        collection: ADDRESS_RECORD_SLUG,
        id: String(types.id),
        data: {
          path: JSON.stringify(["articles", "pages", "posts"]),
          _overwrite: true,
        },
      });
      await forgetFingerprint(t);

      await restart();

      expect(await recorded(t)).toEqual({ "en|/list": "lists:1" });
    });

    it("keeps a page it did not see while listing, that still exists", async () => {
      const { t } = await boot(dialect);
      const first = await publish(t, "pages", "first");
      // A later second, so the listing reads the first before it.
      await new Promise(resolve => setTimeout(resolve, 1_100));
      const second = await publish(t, "pages", "second");
      await forgetFingerprint(t);

      // One page per read: deleting the first between reads moves the second
      // to where the listing has already been, so it is not seen.
      await catchUp({
        pageSize: 1,
        betweenPages: async () => {
          await t.nextly.delete({ collection: "pages", id: first });
        },
      });

      expect(await recorded(t)).toEqual({ "en|/second": `pages:${second}` });
    });

    it("records every page none had recorded, though one listed is deleted while it lists", async () => {
      const { t } = await boot(dialect);
      const pages = [
        await publish(t, "pages", "one"),
        await publish(t, "pages", "two"),
        await publish(t, "pages", "three"),
      ];
      await forget(t);

      // One page per read, the first listed deleted after the first read: a
      // listing by position would then step past one it has not read.
      let deleted: string | undefined;
      await catchUp({
        pageSize: 1,
        betweenPages: async listed => {
          if (deleted !== undefined) return;
          deleted = listed[0]?.holder.id;
          if (deleted !== undefined) {
            await t.nextly.delete({ collection: "pages", id: deleted });
          }
        },
      });

      const left = pages.filter(id => id !== deleted);
      expect(left).toHaveLength(2);
      expect(Object.values(await recorded(t)).sort()).toEqual(
        left.map(id => `pages:${id}`).sort()
      );
    });

    it("lets go of a page that no longer exists", async () => {
      const { t, ctx } = await boot(dialect);
      await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            {
              holder: { collection: "pages", id: "gone" },
              holds: [{ locale: "en", path: "/gone" }],
            },
          ],
          tx
        )
      );

      // A start after a deploy that changed an address template.
      await forgetFingerprint(t);

      await restart();

      expect(await recorded(t)).toEqual({});
    });
  }
);
