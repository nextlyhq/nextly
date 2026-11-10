/**
 * A page's address claims, held by real saves of the Pages collection in
 * the save's own transaction.
 *
 * What separates a correct wiring from a plausible broken one:
 * - a published page holds its address, a draft holds nothing, and a save
 *   held as a working draft leaves the live page's claims alone;
 * - a page published inside a paginated page's later pages is refused,
 *   naming that page, and so is paginating over a published page, in either
 *   order, and the refused save keeps nothing, page or claim;
 * - a list that grows or shrinks writes no claim; unpaginating gives up the
 *   space and keeps the address; unpublishing and deleting give up all;
 * - a slug change moves the address;
 * - two pages saved in one transaction see each other's claims, so the
 *   clash is refused as a conflict rather than failing the batch.
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { asOverwrite } from "../document-version";
import { pageBuilder } from "../plugin";

/** A page document holding one collection list, split into pages or not. */
function listPage(paginate: boolean, limit = 10) {
  const list: BlockNode = {
    id: "list",
    type: "core/collection-loop",
    version: 1,
    props: {
      collection: "pages",
      limit,
      ...(paginate ? { paginate: true } : {}),
    },
    slots: { children: [], empty: [] },
  } as BlockNode;
  return { formatVersion: 1, kind: "page", nodes: [list] };
}

const PLAIN = { formatVersion: 1, kind: "page", nodes: [] };

/** The words a refused write gives, as its caller reads them. */
async function refusal(write: Promise<unknown>): Promise<string> {
  const error = (await write.then(
    () => undefined,
    (caught: unknown) => caught
  )) as { publicMessage?: unknown; message?: unknown } | undefined;
  if (error === undefined) return "no refusal";
  return String(error.publicMessage ?? error.message);
}

describe.each(getConfiguredTestDialects())(
  "a page's address claims (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let captured: PluginContext | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      captured = undefined;
    });

    async function boot(
      options: Parameters<typeof pageBuilder>[0] = {}
    ): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [
          pageBuilder(options),
          definePlugin({
            name: "@t/page-claims",
            version: "1.0.0",
            nextly: ">=0.0.0",
            init(ctx) {
              captured = ctx;
            },
          }),
        ],
      });
      return current;
    }

    async function publish(
      t: TestNextly,
      title: string,
      slug: string,
      content: unknown = PLAIN
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: "pages",
        data: { title, slug, content, status: "published" },
        overrideAccess: true,
      });
      return String((created as { item: { id: unknown } }).item.id);
    }

    // A save of the live page: one naming no status over a published page is
    // held as a working draft, which leaves its claims alone. These tests are
    // about claims, not stale writes, so each replaces whatever is stored.
    function update(t: TestNextly, id: string, data: Record<string, unknown>) {
      return t.nextly.update({
        collection: "pages",
        id,
        data: asOverwrite({ status: "published", ...data }),
        overrideAccess: true,
      });
    }

    /** Every claim row: its kind, path and holder, in a stable order. */
    async function held(t: TestNextly): Promise<string[]> {
      const found = await t.nextly.find({
        collection: ADDRESS_CLAIMS_SLUG,
        overrideAccess: true,
        depth: 0,
        limit: 200,
      });
      return (found.items as Record<string, unknown>[])
        .filter(row => row.kind === "address" || row.kind === "space")
        .map(
          row =>
            `${String(row.kind)} ${String(row.path)} ${String(row.holderId)}`
        )
        .sort();
    }

    it("holds a published page's address, and nothing for a draft", async () => {
      const t = await boot();
      const about = await publish(t, "About", "about");
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "Draft",
          slug: "draft",
          content: PLAIN,
          status: "draft",
        },
        overrideAccess: true,
      });
      expect(await held(t)).toEqual([`address /about ${about}`]);
    });

    it("refuses a page inside a paginated page's later pages, naming it, and keeps nothing", async () => {
      const t = await boot();
      const news = await publish(t, "News", "news", listPage(true));
      expect(await refusal(publish(t, "Second", "news/page/2"))).toContain(
        `the page "News" (${news})`
      );
      const pages = await t.nextly.find({
        collection: "pages",
        overrideAccess: true,
        status: "all",
        where: { slug: { equals: "news/page/2" } },
      });
      expect(pages.items).toHaveLength(0);
      expect(await held(t)).toEqual([
        `address /news ${news}`,
        `space /news ${news}`,
      ]);
    });

    it("refuses paginating over a published page, naming it", async () => {
      const t = await boot();
      const second = await publish(t, "Second", "news/page/2");
      const news = await publish(t, "News", "news");
      expect(
        await refusal(update(t, news, { content: listPage(true) }))
      ).toContain(`the page "Second" (${second})`);
      expect(await held(t)).toEqual([
        `address /news ${news}`,
        `address /news/page/2 ${second}`,
      ]);
    });

    it("writes no claim as a list grows, and gives up only the space when it stops paginating", async () => {
      const t = await boot();
      const news = await publish(t, "News", "news", listPage(true));
      const before = await held(t);
      await update(t, news, { content: listPage(true, 50) });
      expect(await held(t)).toEqual(before);
      await update(t, news, { content: listPage(false) });
      expect(await held(t)).toEqual([`address /news ${news}`]);
      // The later pages are free again.
      await publish(t, "Second", "news/page/2");
    });

    it("gives up every claim when the page is unpublished or deleted", async () => {
      const t = await boot();
      const news = await publish(t, "News", "news", listPage(true));
      await update(t, news, { status: "draft" });
      expect(await held(t)).toEqual([]);
      await update(t, news, { status: "published" });
      expect(await held(t)).toHaveLength(2);
      await t.nextly.delete({
        collection: "pages",
        id: news,
        overrideAccess: true,
      });
      expect(await held(t)).toEqual([]);
    });

    it("holds the address the host serves pages at", async () => {
      const t = await boot({ pagePreviewPath: "/blocks/{slug}" });
      const about = await publish(t, "About", "about");
      expect(await held(t)).toEqual([`address /blocks/about ${about}`]);
    });

    it("moves the address when a published page's slug changes", async () => {
      const t = await boot();
      const about = await publish(t, "About", "about");
      await update(t, about, { slug: "about-us" });
      expect(await held(t)).toEqual([`address /about-us ${about}`]);
    });

    it("refuses a clash between two pages saved in one transaction as a conflict", async () => {
      const t = await boot();
      const ctx = captured;
      if (ctx === undefined) throw new Error("the test plugin never started");
      const both = ctx.services.collections.withTransaction(async tx => {
        await ctx.services.collections.createEntryInTransaction(tx, "pages", {
          title: "News",
          slug: "news",
          content: listPage(true),
          status: "published",
        });
        await ctx.services.collections.createEntryInTransaction(tx, "pages", {
          title: "Second",
          slug: "news/page/2",
          content: PLAIN,
          status: "published",
        });
      });
      const error = (await both.then(
        () => undefined,
        (caught: unknown) => caught
      )) as { code?: unknown } | undefined;
      expect(error?.code).toBe("CONFLICT");
      expect(await held(t)).toEqual([]);
    });
  }
);
