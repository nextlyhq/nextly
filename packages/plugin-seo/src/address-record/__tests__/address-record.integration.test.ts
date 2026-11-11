/**
 * The SEO plugin's record of who holds each public address: a second page at
 * an address another holds is refused, whichever type it belongs to, and the
 * record follows every save, move and release.
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
      defineCollection({
        slug: "links",
        fields: [text({ name: "title" }), text({ name: "handle" })],
        publicAddress: "/go/{handle}",
      }),
    ],
  });
  const ctx = seen.ctx;
  if (!ctx) throw new Error("the helper plugin never started");
  return { t: current, ctx };
}

async function publish(t: TestNextly, collection: string, slug: string) {
  const created = await t.nextly.create({
    collection,
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

/** The record's address rows, as `locale|path` → `collection:id`. */
async function recorded(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: ADDRESS_RECORD_SLUG,
    limit: 500,
  });
  return Object.fromEntries(
    (items as Record<string, unknown>[])
      .filter(row => row.kind === "address" || row.kind === "range")
      .map(row => [
        `${row.locale}|${row.path}`,
        `${row.holderCollection}:${row.holderId}`,
      ])
  );
}

describe.each(getConfiguredTestDialects())(
  "the SEO plugin's address record (%s)",
  dialect => {
    it("refuses a second type's entry at an address another holds", async () => {
      const { t } = await boot(dialect);
      const page = await publish(t, "pages", "hello");

      await expect(publish(t, "posts", "hello")).rejects.toMatchObject({
        code: "DUPLICATE",
      });
      expect(await recorded(t)).toEqual({ "en|/hello": `pages:${page}` });
    });

    it("saving a holder again leaves the same rows", async () => {
      const { t } = await boot(dialect);
      const page = await publish(t, "pages", "hello");

      await t.nextly.update({
        collection: "pages",
        id: page,
        data: { title: "Hello again", _overwrite: true },
      });

      expect(await recorded(t)).toEqual({ "en|/hello": `pages:${page}` });
    });

    it("letting go removes the rows", async () => {
      const { t } = await boot(dialect);
      const page = await publish(t, "pages", "hello");
      const other = await publish(t, "pages", "other");
      expect(Object.keys(await recorded(t)).sort()).toEqual([
        "en|/hello",
        "en|/other",
      ]);

      await t.nextly.update({
        collection: "pages",
        id: page,
        data: { status: "draft", _overwrite: true },
      });
      await t.nextly.delete({ collection: "pages", id: other });

      expect(await recorded(t)).toEqual({});
    });

    it("a range refuses an address inside it, and the reverse", async () => {
      const { t, ctx } = await boot(dialect);
      const { refused } = await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            {
              holder: { collection: "lists", id: "1", label: "All links" },
              holds: [{ locale: "en", path: "/go", range: true }],
            },
          ],
          tx
        )
      );
      expect(refused).toEqual([]);

      await expect(
        t.nextly.create({
          collection: "links",
          data: { title: "A", handle: "a" },
        })
      ).rejects.toMatchObject({ code: "DUPLICATE" });

      // And a range over an address already held is refused too.
      await publish(t, "pages", "blog");
      const second = await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            {
              holder: { collection: "lists", id: "2" },
              holds: [{ locale: "en", path: "/", range: true }],
            },
          ],
          tx
        )
      );
      expect(second.refused).toHaveLength(1);
    });

    it("a batch swapping two addresses commits", async () => {
      const { t, ctx } = await boot(dialect);
      const a = { collection: "lists", id: "a" };
      const b = { collection: "lists", id: "b" };
      const at = (path: string) => [{ locale: "en", path }];
      await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            { holder: a, holds: at("/one") },
            { holder: b, holds: at("/two") },
          ],
          tx
        )
      );

      const { refused } = await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            { holder: a, holds: at("/two") },
            { holder: b, holds: at("/one") },
          ],
          tx
        )
      );

      expect(refused).toEqual([]);
      expect(await recorded(t)).toEqual({
        "en|/two": "lists:a",
        "en|/one": "lists:b",
      });
    });

    it("two saves of one address at once: one commits, one is refused", async () => {
      const { t } = await boot(dialect);

      const outcomes = await Promise.allSettled([
        publish(t, "pages", "same"),
        publish(t, "posts", "same"),
      ]);

      expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
      expect(Object.keys(await recorded(t))).toEqual(["en|/same"]);
    });
  }
);
