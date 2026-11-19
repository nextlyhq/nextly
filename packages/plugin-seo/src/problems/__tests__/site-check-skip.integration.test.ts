/**
 * On every configured dialect: a full check writes a page's row only where
 * it finds something about the page other than the time, so a second check
 * of a site nothing changed on writes no page's row. MySQL gives a JSON
 * column's keys back in its own order, which must not count as a change. The
 * site's own row still records every full check, and what the list shows is
 * the same as when every row is written.
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
import { rulesFromOptions } from "../../structured-data/rules";
import {
  checkSite,
  checkedInTurn,
  pageRefKey,
  problemList,
  type ProblemChecks,
  type Reader,
} from "../check";
import {
  PROBLEMS_SLUG,
  readPages,
  readSiteCheck,
  removePage,
  saveSiteCheck,
} from "../store";

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

/** A site with SEO on `posts`, in English and German. */
async function boot(dialect: TestDialect) {
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
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    plugins: [withContext],
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        localized: true,
        access: { read: () => true },
        fields: [
          text({ name: "title", localized: true }),
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
 * Publish pages `from` to `to` - 1, last first: each links to the next,
 * every fifth to a page that does not exist too, each pair shares a title,
 * and every third is in German too. Answers their ids, once each save's own
 * check has finished.
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
    const id = String(created.item.id);
    if (at % 3 === 0) {
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
    ids.push(id);
  }
  await Promise.all(ids.map(id => checkedInTurn("posts", id)));
  return ids.reverse();
}

/** Every page row as stored, by its key. */
async function storedRows(
  t: TestNextly
): Promise<Map<string, Record<string, unknown>>> {
  const { items } = await t.nextly.find({
    collection: PROBLEMS_SLUG,
    where: { kind: { equals: "page" } },
    limit: 1000,
    overrideAccess: true,
  });
  return new Map(
    (items as Record<string, unknown>[]).map(row => [String(row.rowKey), row])
  );
}

/** The keys of the rows whose `checkedAt` moved from `before` to `after`. */
function rewritten(
  before: Map<string, Record<string, unknown>>,
  after: Map<string, Record<string, unknown>>
): string[] {
  return [...after]
    .filter(([key, row]) => before.get(key)?.checkedAt !== row.checkedAt)
    .map(([, row]) => `${String(row.holderId)}:${String(row.locale)}`)
    .sort();
}

/** The statements of `statements` that write the list's own rows. */
function listWrites(statements: readonly string[]): string[] {
  return statements.filter(
    sql =>
      /^\s*(insert|update|delete)\b/i.test(sql) && /nx_seo_problems/i.test(sql)
  );
}

/** What the list shows, and every page row without when it was checked. */
async function findings(ctx: PluginContext): Promise<string> {
  const everything: Reader = {
    pages: async pages => new Set(pages.map(pageRefKey)),
    readsType: () => true,
    seesRedirects: true,
    count: type => ctx.services.collections.count(type, {}),
  };
  const {
    checkedAt: _checkedAt,
    due: _due,
    ...list
  } = await problemList(ctx, CHECKS, everything);
  const rows = (await readPages(ctx)).map(
    ({ checkedAt: _when, ...row }) => row
  );
  return JSON.stringify({ list, rows });
}

describe.each(getConfiguredTestDialects())(
  "the full SEO check's writes (%s)",
  dialect => {
    it("writes no page's row where nothing about the page changed, and still records the check", async () => {
      const { t, ctx } = await boot(dialect);
      await publish(t, 0, 12);
      await checkSite(ctx, CHECKS);
      const before = await storedRows(t);
      const site = await readSiteCheck(ctx);
      // A moment on, so a row written again shows a later `checkedAt`.
      await new Promise(resolve => setTimeout(resolve, 5));

      const statements = await statementsOf(dialect, () =>
        checkSite(ctx, CHECKS)
      );
      const after = await storedRows(t);
      expect(after.size).toBeGreaterThan(12);
      expect(rewritten(before, after)).toEqual([]);
      // The list's only writes are the site's own row's.
      const siteRow = await statementsOf(dialect, () =>
        saveSiteCheck(ctx, {
          startedAt: new Date().toISOString(),
          checkedAt: new Date().toISOString(),
          pagesChecked: after.size,
          problems: [],
        })
      );
      expect(listWrites(statements)).toHaveLength(listWrites(siteRow).length);
      // The site's row still says when the site was last checked in full.
      const again = await readSiteCheck(ctx);
      expect(String(again.checkedAt) > String(site.checkedAt)).toBe(true);
    }, 120_000);

    it("writes again only the row of the page whose check now finds something else", async () => {
      const { t, ctx } = await boot(dialect);
      const ids = await publish(t, 0, 12);
      await checkSite(ctx, CHECKS);
      const before = await storedRows(t);
      await new Promise(resolve => setTimeout(resolve, 5));

      // Page 5 goes: page 4's link to it now leads nowhere, which only the
      // full check finds, as no save of page 4 checks it.
      await t.nextly.delete({ collection: "posts", id: ids[5] ?? "" });
      await checkedInTurn("posts", ids[5] ?? "");
      await checkSite(ctx, CHECKS);
      const after = await storedRows(t);
      expect(rewritten(before, after)).toEqual([`${ids[4]}:en`]);
      const fourth = (await readPages(ctx)).find(
        row => row.subject.id === ids[4] && row.locale === "en"
      );
      expect(fourth?.problems.map(problem => problem.kind)).toContain(
        "brokenLink"
      );
    }, 120_000);

    it("finds what it finds when every row is written", async () => {
      const { t, ctx } = await boot(dialect);
      await publish(t, 0, 12);
      await checkSite(ctx, CHECKS);
      await checkSite(ctx, CHECKS);
      const skipping = await findings(ctx);

      // With no row kept, the check writes every page's row.
      for (const row of await readPages(ctx)) await removePage(ctx, row);
      await checkSite(ctx, CHECKS);
      expect(await findings(ctx)).toBe(skipping);
    }, 120_000);
  }
);
