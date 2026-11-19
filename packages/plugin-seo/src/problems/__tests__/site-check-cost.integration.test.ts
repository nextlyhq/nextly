/**
 * On every configured dialect: the full check reads what it reads for a
 * page a batch at a time, the address record, the settings and the content
 * dates, so twice the pages cost no more of those reads; and it finds on
 * each page, in each language, what that page's own check found.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { PluginContext, PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, richText, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { statementsOf } from "../../__tests__/count-statements";
import { seoPlugin } from "../../plugin";
import { readSeoRules } from "../../settings/rules";
import { structuredDataFromSettings } from "../../settings/structured-data-rules";
import { noSocialCardRules } from "../../social/card";
import { putRedirect } from "../../redirects/store";
import { rulesFromOptions } from "../../structured-data/rules";
import { checkSite, checkedInTurn, type ProblemChecks } from "../check";
import { linkedPageKey } from "../link-graph";
import { readPages, readVersions, removePage, savePage } from "../store";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The checks as the plugin runs them for `posts`, with nothing set. */
const CHECKS: ProblemChecks = {
  targets: ["posts"],
  singles: [],
  readers: {
    readRules: readSeoRules,
    readStructuredDataRules: structuredDataFromSettings(
      rulesFromOptions(undefined, undefined)
    ),
    readSocialCardRules: noSocialCardRules,
  },
};

/** Rich text holding one paragraph for each link in `hrefs`. */
function body(hrefs: readonly string[]) {
  return {
    root: {
      type: "root",
      version: 1,
      children: hrefs.map(href => ({
        type: "paragraph",
        version: 1,
        children: [
          {
            type: "link",
            url: href,
            version: 1,
            children: [{ type: "text", text: "read on", version: 1 }],
          },
        ],
      })),
    },
  };
}

/** A site with SEO on `posts`, in German too where `translated`. */
async function boot(dialect: TestDialect, translated: boolean) {
  const seen: { ctx?: PluginContext } = {};
  const plugin = seoPlugin({ collections: ["posts"] });
  const withContext: PluginDefinition = {
    ...plugin,
    init(ctx) {
      seen.ctx = ctx;
      return plugin.init?.(ctx);
    },
  };
  current = await createTestNextly({
    dialect,
    ...(translated
      ? { localization: { locales: ["en", "de"], defaultLocale: "en" } }
      : {}),
    plugins: [withContext],
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        ...(translated ? { localized: true } : {}),
        access: { read: () => true },
        fields: [
          text({ name: "title", ...(translated ? { localized: true } : {}) }),
          text({ name: "slug" }),
          richText({ name: "body" }),
        ],
        publicAddress: "/blog/{slug}",
      }),
    ],
  });
  if (!seen.ctx) throw new Error("the SEO plugin never started");
  return { t: current, ctx: seen.ctx };
}

/**
 * Publish pages `from` to `to` - 1, last first, so the page each links to
 * is there when it is saved: each links to the next, every fifth to a page
 * that does not exist too, and each pair shares a title. Answers their ids,
 * once each save's own check has finished.
 */
async function publish(
  t: TestNextly,
  from: number,
  to: number
): Promise<string[]> {
  const ids: string[] = [];
  for (let at = to - 1; at >= from; at--) {
    const links = [`/blog/p${at + 1}`];
    if (at % 5 === 0) links.push(`/blog/gone-${at}`);
    const created = await t.nextly.create({
      collection: "posts",
      data: {
        title: `Page ${Math.floor(at / 2)}`,
        slug: `p${at}`,
        body: body(links),
        status: "published",
      },
    });
    ids.push(String(created.item.id));
  }
  await Promise.all(ids.map(id => checkedInTurn("posts", id)));
  return ids;
}

/** The statements of `statements` that read the record, the settings or the dates, or look a row up. */
function pageReads(statements: readonly string[]): string[] {
  return statements.filter(
    sql =>
      /^\s*select\b/i.test(sql) &&
      (/seo__addresses|seo__content_dates|single_seo_settings/i.test(sql) ||
        /\bwhere\b[\s\S]*row_key/i.test(sql))
  );
}

/** The kept page rows, each without when it was checked, in one order. */
async function keptRows(ctx: PluginContext) {
  return (await readPages(ctx))
    .map(({ checkedAt: _checkedAt, ...row }) => row)
    .sort((a, b) =>
      `${a.subject.id}|${a.locale}`.localeCompare(`${b.subject.id}|${b.locale}`)
    );
}

describe.each(getConfiguredTestDialects())(
  "the full SEO check's reads (%s)",
  dialect => {
    it("reads the record, the settings and the content dates a batch at a time", async () => {
      const { t, ctx } = await boot(dialect, false);
      await publish(t, 30, 60);
      const fewer = await statementsOf(dialect, () => checkSite(ctx, CHECKS));
      await publish(t, 0, 30);
      const more = await statementsOf(dialect, () => checkSite(ctx, CHECKS));
      // Thirty more pages, and no more of these reads: each is made once for
      // a batch of pages, not once for each page.
      expect(
        pageReads(more).length - pageReads(fewer).length
      ).toBeLessThanOrEqual(2);
    }, 120_000);

    it("finds on each page, in each language, what its own check found", async () => {
      const { t, ctx } = await boot(dialect, true);
      const ids = await publish(t, 0, 24);
      // A redirect carrying the rest across, and one to a single page.
      for (const [source, target] of [
        ["/old/*", "/blog/*"],
        ["/moved", "/blog/p3"],
      ]) {
        await ctx.services.collections.withTransaction(tx =>
          putRedirect(ctx, tx, {
            locale: "en",
            origin: "person",
            source,
            target,
          })
        );
      }
      // A page reaching others through each redirect.
      const linking = await t.nextly.create({
        collection: "posts",
        data: {
          title: "Linking",
          slug: "linking",
          body: body(["/old/p5", "/moved", "/blog/p1"]),
          status: "published",
        },
      });
      ids.push(String(linking.item.id));
      // Every third page in German too.
      for (const [at, id] of ids.entries()) {
        if (at % 3 !== 0) continue;
        await t.nextly.update({
          collection: "posts",
          id,
          locale: "de",
          data: {
            title: `Seite ${Math.floor(at / 2)}`,
            status: "published",
            _overwrite: true,
          },
        });
      }
      await Promise.all(ids.map(id => checkedInTurn("posts", id)));
      const own = await keptRows(ctx);
      expect(own.some(row => row.locale === "de")).toBe(true);
      // Reached through the redirects: p3 and p5, made 21st and 19th.
      const reached = own.find(
        row => row.subject.id === ids.at(-1) && row.locale === "en"
      )?.links?.to;
      expect(reached).toEqual(
        expect.arrayContaining([
          linkedPageKey("posts", ids[20] ?? "", "en"),
          linkedPageKey("posts", ids[18] ?? "", "en"),
        ])
      );
      await checkSite(ctx, CHECKS);
      expect(await keptRows(ctx)).toEqual(own);
    }, 120_000);

    it("writes a page's row again where it was removed after it was read", async () => {
      const { t, ctx } = await boot(dialect, false);
      const [id = ""] = await publish(t, 0, 1);
      const [read] = await readVersions(ctx, "posts", id);
      if (read === undefined) throw new Error("the page's check kept no row");
      await removePage(ctx, read);
      const again = { ...read, checkedAt: "2026-01-02T03:04:05.000Z" };
      await savePage(ctx, again, read);
      expect(await readVersions(ctx, "posts", id)).toEqual([again]);
    }, 120_000);
  }
);
