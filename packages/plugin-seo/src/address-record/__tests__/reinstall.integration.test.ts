/**
 * Between `nextly plugins uninstall --keep-data` and the next install, the
 * SEO plugin does not run, and pages are saved, moved and deleted with no
 * record of them. Its tables, and the catch-up's fingerprint with them, are
 * kept. The install hooks forget that fingerprint, so the first start after
 * the reinstall brings the record up to date. The hooks are called as the
 * lifecycle commands call them: on the context of a booted app.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import { addressClaims } from "../../schema/tables";
import { catchUp, lastCatchUp } from "../catch-up";
import { claimKey } from "../rows";

import { recordedRows, seoContext } from "./record-tables";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  const seo = seoPlugin({ collections: ["posts", "articles"] });
  current = await createTestNextly({
    dialect,
    plugins: [seo],
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/blog/{slug}",
      }),
      // Served under /blog too, so only the record keeps an article off a
      // post's address: each collection's own slugs are unique already.
      defineCollection({
        slug: "articles",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/blog/{slug}",
      }),
    ],
  });
  await lastCatchUp();
  return { t: current, plugin: seo, ctx: seoContext() };
}

async function publish(t: TestNextly, slug: string, collection = "posts") {
  const created = await t.nextly.create({
    collection,
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

const address = (path: string) => claimKey("address", "en", path);

describe.each(getConfiguredTestDialects())(
  "the SEO plugin reinstalled after an uninstall that kept its data (%s)",
  dialect => {
    it("records the pages saved and deleted while it was uninstalled at the first start after the reinstall", async () => {
      const { t, plugin, ctx } = await boot(dialect);
      const gone = await publish(t, "gone");
      await publish(t, "kept");

      await plugin.onUninstall?.(ctx, { keepData: true });
      // Uninstalled: a page published and another deleted with no record
      // of either.
      const gap = await publish(t, "gap");
      await ctx.db
        .delete(addressClaims)
        .where(eq(ctx.db.table(addressClaims).claimKey, address("/blog/gap")));
      await t.nextly.delete({ collection: "posts", id: gone });
      await ctx.db.insert(addressClaims, {
        claimKey: address("/blog/gone"),
        kind: "address",
        locale: "en",
        path: "/blog/gone",
        holderCollection: "posts",
        holderId: gone,
      });
      await plugin.onInstall?.(ctx);

      const report = await catchUp();

      expect(report.ran).toBe(true);
      const held = await recordedRows(ctx);
      expect(held["en|/blog/gap"]).toBe(`posts:${gap}`);
      expect(held["en|/blog/gone"]).toBeUndefined();
      expect(held["en|/blog/kept"]).toBeDefined();
      // The address the deleted page held can be used again; the one the
      // page published meanwhile cannot be taken by another.
      await expect(publish(t, "gone", "articles")).resolves.toBeTruthy();
      await expect(publish(t, "gap", "articles")).rejects.toMatchObject({
        code: "DUPLICATE",
      });
      // And the start after that one finds the record current.
      expect((await catchUp()).ran).toBe(false);
    });

    it("catches up after a reinstall even where the uninstall forgot nothing, as an earlier release's did", async () => {
      const { t, plugin, ctx } = await boot(dialect);
      // Uninstalled by a release with no uninstall hook: the fingerprint
      // stays, and a page published meanwhile reaches no record.
      const gap = await publish(t, "between");
      await ctx.db
        .delete(addressClaims)
        .where(
          eq(ctx.db.table(addressClaims).claimKey, address("/blog/between"))
        );
      await plugin.onInstall?.(ctx);

      expect((await catchUp()).ran).toBe(true);
      expect((await recordedRows(ctx))["en|/blog/between"]).toBe(
        `posts:${gap}`
      );
    });

    it("leaves the record alone on a full uninstall, which drops it", async () => {
      const { t, plugin, ctx } = await boot(dialect);
      await publish(t, "stays");
      await plugin.onUninstall?.(ctx, { keepData: false });

      expect((await catchUp()).ran).toBe(false);
    });
  }
);
