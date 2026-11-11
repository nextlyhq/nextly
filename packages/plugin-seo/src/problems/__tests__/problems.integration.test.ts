/**
 * On every configured dialect: a saved page is checked and what was found is
 * kept, a fix clears its problem when the page is saved again, a deletion
 * forgets the page, a change marks the full check out of date, a full check
 * reads every public page, and serving a page checks nothing.
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
import { createPublicContentRoute, type ContentEntry } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import { lastCatchUp } from "../../address-record/catch-up";
import { putRedirect } from "../../redirects/store";
import { readSeoRules } from "../../settings/rules";
import { structuredDataFromSettings } from "../../settings/structured-data-rules";
import { noSocialCardRules } from "../../social/card";
import { rulesFromOptions } from "../../structured-data/rules";
import {
  checkSite,
  pageRefKey,
  problemList,
  type ProblemChecks,
  type Reader,
} from "../check";
import type { Problem } from "../contract";
import { PROBLEMS_SLUG, savePage } from "../store";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The SEO plugin's context the current test runs with. */
let seoContext: PluginContext | undefined;

/**
 * A reader who may read only the pages `allowed` names, of the types
 * `types` names, counting entries as the system does.
 */
function only(
  allowed: (page: { type: string; id: string }) => boolean,
  types: (type: string) => boolean = () => true
): Reader {
  return {
    pages: async pages => new Set(pages.filter(allowed).map(pageRefKey)),
    readsType: types,
    count: async type => {
      if (!seoContext) throw new Error("no SEO plugin context");
      return seoContext.services.collections.count(type, {});
    },
  };
}

/** A reader who may read every page. */
const everything: Reader = only(() => true);

/** The checks as the plugin runs them for `posts`, with nothing set. */
const CHECKS: ProblemChecks = {
  targets: ["posts", "notes"],
  readers: {
    readRules: readSeoRules,
    readStructuredDataRules: structuredDataFromSettings(
      rulesFromOptions(undefined, undefined)
    ),
    readSocialCardRules: noSocialCardRules,
  },
};

/**
 * The SEO plugin, handing over the context it starts with: its own, which
 * alone may read the rows its checks keep.
 */
function seoWithContext(
  seen: { ctx?: PluginContext },
  collections: string[] = ["posts", "notes"]
): PluginDefinition {
  const plugin = seoPlugin({ collections });
  return {
    ...plugin,
    init(ctx) {
      seen.ctx = ctx;
      return plugin.init?.(ctx);
    },
  };
}

async function boot(dialect: TestDialect) {
  const seen: { ctx?: PluginContext } = {};
  current = await createTestNextly({
    dialect,
    plugins: [seoWithContext(seen)],
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          text({ name: "excerpt" }),
          richText({ name: "body" }),
        ],
        publicAddress: "/blog/{slug}",
      }),
      // SEO is added to it, but it has no address of its own.
      defineCollection({
        slug: "notes",
        labels: { singular: "Note", plural: "Notes" },
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  if (!seen.ctx) throw new Error("the SEO plugin never started");
  seoContext = seen.ctx;
  return { t: current, ctx: seen.ctx };
}

/** Rich text holding one paragraph with a link to `href`, and one image. */
function body(href: string, alt: string) {
  return {
    root: {
      type: "root",
      version: 1,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: [
            {
              type: "link",
              url: href,
              version: 1,
              children: [{ type: "text", text: "read", version: 1 }],
            },
          ],
        },
        { type: "image", version: 1, src: "/uploads/chart.png", altText: alt },
      ],
    },
  };
}

async function publish(
  t: TestNextly,
  data: Record<string, unknown>,
  status = "published"
): Promise<string> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { ...data, status },
  });
  return String(created.item.id);
}

/** The rows the checks have kept, read directly. */
async function rows(t: TestNextly): Promise<Record<string, unknown>[]> {
  const { items } = await t.nextly.find({
    collection: PROBLEMS_SLUG,
    limit: 100,
    overrideAccess: true,
  });
  return items as Record<string, unknown>[];
}

/** Waits until `ready` holds of the kept rows, which a save's check writes after it. */
async function until(
  t: TestNextly,
  ready: (found: Record<string, unknown>[]) => boolean
): Promise<Record<string, unknown>[]> {
  for (let tries = 0; tries < 100; tries++) {
    const found = await rows(t);
    if (ready(found)) return found;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("the page's check never finished");
}

/** The kinds of problem the list holds for one page, in the list's order. */
function kindsOf(problems: Problem[], id: string): string[] {
  return problems.filter(p => p.subject.id === id).map(p => p.kind);
}

/** A page's row, once its check has written `checkedAt` past `after`. */
const checkedSince =
  (id: string, after = "") =>
  (found: Record<string, unknown>[]) =>
    found.some(
      row =>
        row.holderId === id &&
        typeof row.checkedAt === "string" &&
        row.checkedAt > after
    );

describe.each(getConfiguredTestDialects())(
  "the SEO problem list (%s)",
  dialect => {
    it("checks a saved page, and a fix clears its problem on the next save", async () => {
      const { t, ctx } = await boot(dialect);
      const id = await publish(t, {
        title:
          "A walk along the harbour at dawn, with every boat named and drawn",
        slug: "harbour",
        body: body("/blog/missing", ""),
      });
      const [first] = await until(t, checkedSince(id));

      let list = await problemList(ctx, CHECKS, everything);
      expect(kindsOf(list.problems, id)).toEqual([
        "brokenLink",
        "noDescription",
        "longTitle",
        "shareImage",
        "imageAlt",
      ]);
      const link = list.problems.find(p => p.kind === "brokenLink");
      expect(link).toMatchObject({
        subject: { type: "posts", id, detail: "/blog/harbour" },
        what: "Links to /blog/missing, which is not found",
        fix: { place: "page", tab: "content", field: "body" },
      });

      // The fixes: a shorter title, a description, a link to a page that
      // exists and alt text for the image.
      const other = await publish(t, { title: "Boats", slug: "boats" });
      await until(t, checkedSince(other));
      await t.nextly.update({
        collection: "posts",
        id,
        data: {
          title: "Harbour at dawn",
          excerpt: "A walk along the harbour.",
          body: body("/blog/boats", "A chart of the tides"),
          _overwrite: true,
        },
      });
      await until(t, checkedSince(id, String(first?.checkedAt)));

      list = await problemList(ctx, CHECKS, everything);
      expect(kindsOf(list.problems, id)).toEqual(["shareImage"]);
    });

    it("shows a reader only the pages they may read, compared among those", async () => {
      const { t, ctx } = await boot(dialect);
      const a = await publish(t, { title: "Harbour", slug: "a" });
      const b = await publish(t, { title: "Harbour", slug: "b" });
      await until(t, found => checkedSince(a)(found) && checkedSince(b)(found));

      const list = await problemList(
        ctx,
        CHECKS,
        only(page => page.id === a)
      );
      expect(list.problems.some(p => p.subject.id === b)).toBe(false);
      // The title it shares is with a page the reader may not see.
      expect(kindsOf(list.problems, a)).not.toContain("sharedTitle");
    });

    it("lists a shared title on both pages, and forgets a deleted page", async () => {
      const { t, ctx } = await boot(dialect);
      const a = await publish(t, { title: "Harbour", slug: "a" });
      const b = await publish(t, { title: "Harbour", slug: "b" });
      await until(t, found => checkedSince(a)(found) && checkedSince(b)(found));

      let list = await problemList(ctx, CHECKS, everything);
      expect(kindsOf(list.problems, a)).toContain("sharedTitle");
      expect(kindsOf(list.problems, b)).toContain("sharedTitle");

      await t.nextly.delete({ collection: "posts", id: b });
      await until(t, found => !found.some(row => row.holderId === b));

      list = await problemList(ctx, CHECKS, everything);
      expect(kindsOf(list.problems, a)).not.toContain("sharedTitle");
      expect(kindsOf(list.problems, b)).toEqual([]);
    });

    it("keeps no row for a draft, which is not a public page", async () => {
      const { t, ctx } = await boot(dialect);
      const draft = await publish(t, { title: "Soon", slug: "soon" }, "draft");
      const live = await publish(t, { title: "Now", slug: "now" });
      await until(t, checkedSince(live));
      // The draft was saved first, and its check ran before the live one's.
      const list = await problemList(ctx, CHECKS, everything);
      expect(kindsOf(list.problems, draft)).toEqual([]);
      expect((await rows(t)).some(row => row.holderId === draft)).toBe(false);
    });

    it("lists what belongs to the whole site, and only the pages a reader may read", async () => {
      const { t, ctx } = await boot(dialect);
      const id = await publish(t, { title: "Harbour", slug: "harbour" });
      await until(t, checkedSince(id));

      const list = await problemList(ctx, CHECKS, everything);
      const site = list.problems.filter(p => p.subject.id === undefined);
      expect(site.map(p => [p.kind, p.subject.label, p.what])).toEqual([
        ["productionAddress", "Whole site", expect.any(String)],
        ["noAddress", "Notes", expect.any(String)],
        // With no site address, no page's structured data can be stated:
        // said once, of the whole site, not on every page.
        ["structuredData", "Whole site", "Missing: the site's address."],
      ]);

      const hidden = await problemList(
        ctx,
        CHECKS,
        only(page => page.type !== "posts")
      );
      expect(kindsOf(hidden.problems, id)).toEqual([]);
      expect(hidden.problems.map(p => p.kind)).toEqual([
        "productionAddress",
        "noAddress",
      ]);
      // A type with no address is named only to a reader of that type.
      const notNotes = await problemList(
        ctx,
        CHECKS,
        only(
          () => true,
          type => type !== "notes"
        )
      );
      expect(notNotes.problems.some(p => p.kind === "noAddress")).toBe(false);
    });

    it("a full check reads every public page, and a later change marks it out of date", async () => {
      const { t, ctx } = await boot(dialect);
      const id = await publish(t, { title: "Harbour", slug: "harbour" });
      await until(t, checkedSince(id));

      let list = await problemList(ctx, CHECKS, everything);
      expect(list.checkedAt).toBeUndefined();
      expect(list.due).toBe(true);

      await checkSite(ctx, CHECKS);
      list = await problemList(ctx, CHECKS, everything);
      expect(list).toMatchObject({
        pagesChecked: 1,
        outOfDate: false,
        due: false,
      });
      const checkedAt = String(list.checkedAt);

      // A day and a minute later, the list is due a full check again.
      const later = Date.parse(checkedAt) + 24 * 60 * 60 * 1000 + 60_000;
      expect((await problemList(ctx, CHECKS, everything, later)).due).toBe(
        true
      );

      const [before] = await rows(t).then(found =>
        found.filter(row => row.holderId === id)
      );
      await t.nextly.update({
        collection: "posts",
        id,
        data: { title: "Harbour at dawn", _overwrite: true },
      });
      await until(t, checkedSince(id, String(before?.checkedAt)));
      list = await problemList(ctx, CHECKS, everything);
      expect(list.outOfDate).toBe(true);
    });

    it("serving a page runs no check", async () => {
      const { t } = await boot(dialect);
      const id = await publish(t, { title: "Harbour", slug: "harbour" });
      const kept = await until(t, checkedSince(id));

      const route = createPublicContentRoute({
        collections: ["posts"],
        nextly: t.nextly,
        render: (entry: ContentEntry) => entry.title,
      });
      for (let served = 0; served < 3; served++) {
        const head = await route.generateMetadata({
          params: { slug: ["harbour"] },
        });
        expect(head.title).toBeDefined();
      }
      // Given a moment, as a save's check would have had.
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(await rows(t)).toEqual(kept);
    });

    it("a full check reports a redirect that takes more than one hop", async () => {
      const { ctx } = await boot(dialect);
      const save = (source: string, target: string) =>
        ctx.services.collections.withTransaction(tx =>
          putRedirect(ctx, tx, {
            locale: "en",
            origin: "person",
            source,
            target,
          })
        );
      // A redirect to an address a pattern added after it moves on again.
      await save("/a", "/new/x");
      await save("/b", "/elsewhere");
      await save("/new/*", "/newer/*");

      await checkSite(ctx, CHECKS);
      const list = await problemList(ctx, CHECKS, everything);
      expect(
        list.problems.filter(p => p.kind === "redirectChain").map(p => p.what)
      ).toEqual(["/a → /new/x → /newer/x"]);
    });

    it("a full check reports a page left out of the sitemap because another holds its address", async () => {
      const { t, ctx } = await boot(dialect);
      const id = await publish(t, { title: "Harbour", slug: "harbour" });
      await until(t, checkedSince(id));
      // As a deploy that moved another page onto /blog/harbour left it.
      await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            { holder: { collection: "posts", id }, holds: [] },
            {
              holder: { collection: "posts", id: "p9", label: "Boats" },
              holds: [{ locale: "en", path: "/blog/harbour" }],
            },
          ],
          tx
        )
      );

      await checkSite(ctx, CHECKS);
      // Not shown to a reader who may not read the page left out.
      const hidden = await problemList(
        ctx,
        CHECKS,
        only(page => page.id !== id)
      );
      expect(hidden.problems.some(p => p.kind === "notListed")).toBe(false);
      const list = await problemList(ctx, CHECKS, everything);
      const left = list.problems.filter(p => p.kind === "notListed");
      expect(left.map(p => [p.subject.id, p.what])).toEqual([
        [
          id,
          "Its address /blog/harbour is held by another page, so it has no official address and isn't in the sitemap",
        ],
      ]);
    });

    it("a full check keeps a page it did not reach while the page is still public", async () => {
      const { t, ctx } = await boot(dialect);
      const id = await publish(t, { title: "Harbour", slug: "harbour" });
      await until(t, checkedSince(id));
      // A full check whose walk reached no page of posts, as one that
      // passed posts before this page was published.
      const publicAddresses = Object.create(ctx.publicAddresses, {
        held: { value: async () => ({ items: [] }) },
      }) as PluginContext["publicAddresses"];
      const walkedPast = Object.create(ctx, {
        publicAddresses: { value: publicAddresses },
      }) as PluginContext;
      await checkSite(walkedPast, CHECKS);
      expect((await rows(t)).some(row => row.holderId === id)).toBe(true);
    });

    it("checks each language a page is published in", async () => {
      const seen: { ctx?: PluginContext } = {};
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        languageAddresses: { by: "prefix" },
        plugins: [seoWithContext(seen, ["posts"])],
        collections: [
          defineCollection({
            slug: "posts",
            localized: true,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title", localized: true }),
              text({ name: "slug", localized: true }),
              text({ name: "excerpt", localized: true }),
            ],
            publicAddress: "/blog/{slug}",
          }),
        ],
      });
      const t = current;
      const ctx = seen.ctx;
      if (!ctx) throw new Error("the SEO plugin never started");
      seoContext = ctx;
      // With no description in English, and one in German.
      const both = await t.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Harbour", slug: "harbour", status: "published" },
      });
      const id = String(both.item.id);
      await t.nextly.update({
        collection: "posts",
        id,
        locale: "de",
        data: {
          title: "Hafen",
          slug: "hafen",
          excerpt: "Ein Spaziergang am Hafen.",
          status: "published",
          _overwrite: true,
        },
      });
      await lastCatchUp();

      await checkSite(ctx, { ...CHECKS, targets: ["posts"] });
      const list = await problemList(ctx, CHECKS, everything);
      // Each language checked on its own, at its own address.
      const versions = list.problems
        .filter(p => p.subject.id === id && p.kind === "shareImage")
        .map(p => p.subject.detail)
        .sort();
      expect(versions).toEqual(["/blog/harbour", "/de/blog/hafen"]);
      const missing = list.problems
        .filter(p => p.kind === "noDescription")
        .map(p => [p.subject.id, p.subject.detail]);
      expect(missing).toEqual([[id, "/blog/harbour"]]);
    });

    it("a full check reads a batch of pages' entries together, not one by one", async () => {
      const { t, ctx } = await boot(dialect);
      // One after another: three saves at once can deadlock on MySQL.
      const ids: string[] = [];
      for (const slug of ["a", "b", "c"]) {
        ids.push(await publish(t, { title: slug, slug }));
      }
      await until(t, found => ids.every(id => checkedSince(id)(found)));
      // The plugin's context, with its reads of collections counted.
      const read: unknown[] = [];
      const collections = ctx.services.collections;
      const counted = Object.create(collections, {
        listEntries: {
          value: (...args: Parameters<typeof collections.listEntries>) => {
            if (args[0] === "posts") read.push(args[1]?.where);
            return collections.listEntries(...args);
          },
        },
      }) as typeof collections;
      const services = Object.create(ctx.services, {
        collections: { value: counted },
      }) as PluginContext["services"];
      const watched = Object.create(ctx, {
        services: { value: services },
      }) as PluginContext;

      await checkSite(watched, CHECKS);
      // The checks' reads of the entries: none of one entry alone, and one
      // of all three. (The sitemap's listing makes reads of its own.)
      const byId = read.filter(
        where => typeof where === "object" && where !== null && "id" in where
      ) as { id: { equals?: unknown; in?: unknown[] } }[];
      expect(byId.filter(where => where.id.equals !== undefined)).toEqual([]);
      expect(byId.filter(where => where.id.in !== undefined)).toHaveLength(1);
    });

    it("a full check forgets the rows of a collection that is no longer checked", async () => {
      const { t, ctx } = await boot(dialect);
      const id = await publish(t, { title: "Harbour", slug: "harbour" });
      await until(t, checkedSince(id));
      await savePage(ctx, {
        subject: { type: "removed", id: "9", label: "Gone" },
        locale: "en",
        problems: [],
        checkedAt: new Date().toISOString(),
      });
      await checkSite(ctx, CHECKS);
      const kept = await rows(t);
      expect(kept.some(row => row.holderCollection === "removed")).toBe(false);
      expect(kept.some(row => row.holderId === id)).toBe(true);
    });
  }
);
