/**
 * A page's sitemap date moves only when its published content changes, on
 * every configured dialect: an SEO-only change, a save that changes
 * nothing and a draft leave it; a content change moves it to that save. A
 * page with no date kept yet takes its own last save, and reading the
 * sitemap writes nothing. A deleted page's dates go, the full check prunes
 * any a page no longer holds, and a recording repeated, or two at once,
 * leave one row with one date.
 *
 * A described post's `dateModified` is the same date: the field its type
 * maps for it where that holds a date, else its content date, so neither an
 * SEO-only save nor an import of old SEO values moves it.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { eq, ne } from "@nextlyhq/plugin-sdk/db";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text } from "nextly";
import { date, defineFieldGroup, fieldGroup } from "nextly/config";
import {
  createDynamicHandlers,
  createPublicContentRoute,
  type ContentEntry,
} from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { statementsOf } from "../../__tests__/count-statements";
import { lastCatchUp } from "../../address-record/catch-up";
import { seoContext } from "../../address-record/__tests__/record-tables";
import { forgetNotes, readNotes } from "../../address-record/store";
import { siteActor } from "../../import/actor";
import { seoLastChanged } from "../../index";
import { documentsIn } from "../../languages/versions";
import { typeOf } from "../../outputs/listing";
import { applyImport, planImport, type ImportEngine } from "../../import/plan";
import { seoPlugin } from "../../plugin";
import { contentDates } from "../../schema/tables";
import { readSeoRules } from "../../settings/rules";
import { structuredDataFromSettings } from "../../settings/structured-data-rules";
import { noSocialCardRules } from "../../social/card";
import { rulesFromOptions } from "../../structured-data/rules";
import { contentFingerprint, earlierContentFingerprints } from "../fingerprint";
import { contentDatesSettled } from "../hooks";
import { recordSaved, refreshContentDates } from "../record";
import { pageDateKey, pruneContentDates, recordContentDate } from "../store";
import {
  FINGERPRINT_READING_KEY,
  lastFingerprintUpgrade,
  upgradeKeptFingerprints,
} from "../upgrade";

const SITE = "https://acme.example";
// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const PAGES = "seocd_pages";
const POSTS = "seocd_posts";
/** The old SEO group a post held before the plugin, as a site's import reads it. */
const OLD_SEO = defineFieldGroup({
  slug: "seocd_old_seo",
  fields: [text({ name: "seoTitle" })],
});
/** A post's cards, a repeatable field group: content kept in rows of its own. */
const CARD = defineFieldGroup({
  slug: "seocd_card",
  fields: [text({ name: "label" })],
});

let current: TestNextly | undefined;

afterEach(async () => {
  // Recordings still running would read a database already closed.
  await contentDatesSettled();
  await lastFingerprintUpgrade();
  await current?.destroy();
  current = undefined;
});

/**
 * The site with the plugin, naming its types, or, with `everyType`, naming
 * none, so SEO is on every type it defines. With `correctedOn`, posts are
 * described as last changed on that field, as a site maps a correction date.
 */
async function boot(
  dialect: TestDialect,
  { everyType = false, described = false, correctedOn = false } = {}
) {
  current = await createTestNextly({
    dialect,
    // With `described`, posts are described as blog posts, read by a visitor
    // through the Public role a site's boot grants.
    ...(described ? { seedPublic: true } : {}),
    plugins: [
      seoPlugin(
        everyType
          ? { baseUrl: SITE }
          : {
              collections: [PAGES, POSTS],
              singles: ["seocd_home"],
              baseUrl: SITE,
              ...(described
                ? {
                    structuredData: {
                      brand: { name: "Acme" },
                      types: {
                        [POSTS]: {
                          type: "blogPosting" as const,
                          ...(correctedOn
                            ? {
                                details: {
                                  blogPosting: { dateModified: "correctedOn" },
                                },
                              }
                            : {}),
                        },
                      },
                    },
                  }
                : {}),
            }
      ),
    ],
    ...(described ? { fieldGroups: [OLD_SEO, CARD] } : {}),
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
          // A correction date, filled in only when a post is corrected, and
          // the old SEO group an import reads.
          ...(described
            ? [
                date({ name: "correctedOn" }),
                fieldGroup({ name: "oldSeo", component: OLD_SEO.slug }),
                fieldGroup({
                  name: "cards",
                  component: CARD.slug,
                  repeatable: true,
                }),
              ]
            : []),
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
  await lastCatchUp();
  // The SEO plugin's own context: a plugin's tables are its own to read.
  return { t: current, ctx: seoContext() };
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

/** A date as the instant it names, so two spellings of one instant agree. */
const instant = (value: unknown) => Date.parse(String(value));

/** The `dateModified` the page at `/blog/<slug>` is described with, as served. */
async function dateModifiedOf(t: TestNextly, slug: string): Promise<unknown> {
  await contentDatesSettled();
  const route = createPublicContentRoute({
    collections: [POSTS],
    nextly: t.nextly,
    render: (_: ContentEntry, context) => context.structuredData,
  });
  const text = await route.ContentPage({ params: { slug: [slug] } });
  const graph = (JSON.parse(String(text ?? "{}")) as { "@graph"?: unknown[] })[
    "@graph"
  ];
  // The page's own node, whichever type it is described as: a post missing
  // a detail its type needs is described as a web page.
  const page = (graph ?? []).find(
    node =>
      (node as { "@id"?: unknown })["@id"] === `${SITE}/blog/${slug}#webpage`
  ) as Record<string, unknown> | undefined;
  if (page === undefined) throw new Error(`${slug} is not described`);
  return page.dateModified;
}

/** The rows kept, as stored. */
async function rows(ctx: PluginContext): Promise<Record<string, unknown>[]> {
  return (await ctx.db.select(contentDates).all()) as unknown as Record<
    string,
    unknown
  >[];
}

/** Forget every kept date, as a site saved before they were kept has none. */
async function clearDates(ctx: PluginContext): Promise<void> {
  const columns = ctx.db.table(contentDates);
  await ctx.db.delete(contentDates).where(ne(columns.pageKey, ""));
}

/** The import as the site, as a command run on the server makes it. */
function siteImport(ctx: PluginContext): ImportEngine {
  return {
    ctx,
    actor: siteActor(ctx),
    setup: {
      targets: [POSTS],
      readRules: readSeoRules,
      checks: {
        targets: [POSTS],
        singles: [],
        readers: {
          readRules: readSeoRules,
          readStructuredDataRules: structuredDataFromSettings(
            rulesFromOptions(undefined, undefined)
          ),
          readSocialCardRules: noSocialCardRules,
        },
      },
      pagePermissions: false,
    },
  };
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
        data: { seo: { metaTitle: "Hello, world" }, _overwrite: true },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { title: "Hello", body: "First words.", _overwrite: true },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { status: "published", _overwrite: true },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      const savedAt = Date.now();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { body: "Rewritten.", _overwrite: true },
      });
      // Moved to the save that changed the content.
      const moved = Date.parse(String(await lastmodOf(loc)));
      expect(moved).toBeGreaterThan(Date.parse(String(first)));
      expect(Math.abs(moved - savedAt)).toBeLessThan(5_000);
    });

    it("keeps the dates where SEO is on every type, the site naming none", async () => {
      const { t } = await boot(dialect, { everyType: true });
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
      // An SEO-only change leaves the date, which only a kept date can do.
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { seo: { metaTitle: "Hello, world" }, _overwrite: true },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { body: "Rewritten.", _overwrite: true },
      });
      expect(Date.parse(String(await lastmodOf(loc)))).toBeGreaterThan(
        Date.parse(String(first))
      );
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
        data: {
          title: "Acme",
          seo: { metaTitle: "Acme, home" },
          _overwrite: true,
        },
      });
      expect(await lastmodOf(loc)).toBe(first);

      await nextSecond();
      await t.nextly.updateSingle({
        slug: "seocd_home",
        data: { title: "Acme, welcome", _overwrite: true },
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
      await clearDates(ctx);
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
      await clearDates(ctx);

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { seo: { metaTitle: "Hello, world" }, _overwrite: true },
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
      await clearDates(ctx);
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

    it("keeps the date it already had only for the version the save left unchanged", async () => {
      const { t, ctx } = await boot(dialect);
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await contentDatesSettled();
      await clearDates(ctx);
      const holder = { collection: POSTS, id: post.id };
      const earlier = new Date("2026-01-01T00:00:00.000Z");

      // A later save committed before this recording read the page: the
      // date kept is the one the page has now, not the earlier one.
      await recordSaved(ctx, holder, {
        date: earlier,
        version: new Date("2026-01-02T00:00:00.000Z"),
      });
      expect(second((await rows(ctx))[0]?.changedAt)).toBe(
        second(post.updatedAt)
      );

      await clearDates(ctx);
      // The version the save left unchanged keeps the date it had.
      await recordSaved(ctx, holder, {
        date: earlier,
        version: new Date(post.updatedAt),
      });
      expect(second((await rows(ctx))[0]?.changedAt)).toBe(second(earlier));
    });

    it("catches up a page whose save no hook recorded, at the full check", async () => {
      const { t, ctx } = await boot(dialect);
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await contentDatesSettled();
      // As a publish no save hook was told of: the kept fingerprint is not
      // the content the page shows.
      const columns = ctx.db.table(contentDates);
      await ctx.db
        .update(contentDates, {
          fingerprint: "0".repeat(64),
          changedAt: new Date("2026-01-01T00:00:00.000Z"),
        })
        .where(ne(columns.holderId, ""));

      await refreshContentDates(ctx, [
        { holder: { collection: POSTS, id: post.id }, language: "en" },
      ]);

      expect(second(await lastmodOf(`${SITE}/blog/hello`))).toBe(
        second(post.updatedAt)
      );
    });

    it("describes a post as changed when its content last changed, as the sitemap dates it, not at an SEO-only save", async () => {
      const { t } = await boot(dialect, { described: true });
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        body: "First words.",
        status: "published",
      });
      const loc = `${SITE}/blog/hello`;
      const first = await lastmodOf(loc);
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(instant(first));

      // An SEO-only save, as the import makes: the save's own stamp moves,
      // the content's date does not.
      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { seo: { metaTitle: "Hello, world" }, _overwrite: true },
      });
      expect(await lastmodOf(loc)).toBe(first);
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(instant(first));

      // A content change moves both, to the same date.
      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { body: "Rewritten.", _overwrite: true },
      });
      const moved = await lastmodOf(loc);
      expect(Date.parse(String(moved))).toBeGreaterThan(
        Date.parse(String(first))
      );
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(instant(moved));
    });

    it("describes a post as changed at its content date where the field its type maps for the date is empty", async () => {
      const { t } = await boot(dialect, { described: true, correctedOn: true });
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        body: "First words.",
        status: "published",
      });
      const loc = `${SITE}/blog/hello`;
      const first = await lastmodOf(loc);
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(instant(first));

      // An SEO-only save moves the row's own save stamp, which an empty
      // correction date must not hand the description.
      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { seo: { metaTitle: "Hello, world" }, _overwrite: true },
      });
      expect(await lastmodOf(loc)).toBe(first);
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(instant(first));

      // A content change moves both, to the same date.
      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { body: "Rewritten.", _overwrite: true },
      });
      const moved = await lastmodOf(loc);
      expect(Date.parse(String(moved))).toBeGreaterThan(
        Date.parse(String(first))
      );
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(instant(moved));
    });

    it("describes a post as changed on the date its mapped field holds, over its content date", async () => {
      const { t } = await boot(dialect, { described: true, correctedOn: true });
      const correctedOn = "2026-01-05T00:00:00.000Z";
      await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        body: "First words.",
        correctedOn,
        status: "published",
      });
      const first = await lastmodOf(`${SITE}/blog/hello`);
      expect(instant(first)).not.toBe(instant(correctedOn));
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(
        instant(correctedOn)
      );
    });

    it("leaves the sitemap date and dateModified where an import of old SEO values left the content as it was", async () => {
      const { t, ctx } = await boot(dialect, { described: true });
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        body: "First words.",
        oldSeo: { seoTitle: "Hello from the old site" },
        status: "published",
      });
      const loc = `${SITE}/blog/hello`;
      const first = await lastmodOf(loc);
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(instant(first));

      await nextSecond();
      const engine = siteImport(ctx);
      const plan = await planImport(engine, {
        source: { kind: "group", field: "oldSeo" },
        types: [POSTS],
        mapping: { seoTitle: "title" },
      });
      await applyImport(plan);
      // The import saved the post: its value is in, and its save stamp moved.
      const saved = (await t.nextly.findByID({
        collection: POSTS,
        id: post.id,
      })) as { seo?: { metaTitle?: unknown }; updatedAt?: unknown } | null;
      expect(saved?.seo?.metaTitle).toBe("Hello from the old site");
      expect(instant(saved?.updatedAt)).toBeGreaterThan(
        instant(post.updatedAt)
      );

      expect(await lastmodOf(loc)).toBe(first);
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(instant(first));
      // The full check's catch-up finds the content it keeps, and keeps it.
      await refreshContentDates(ctx, [
        { holder: { collection: POSTS, id: post.id }, language: "en" },
      ]);
      expect(await lastmodOf(loc)).toBe(first);
      expect(instant(await dateModifiedOf(t, "hello"))).toBe(instant(first));
    });

    it("leaves the date where an SEO-only save sends its field groups back, their rows rewritten", async () => {
      const { t, ctx } = await boot(dialect, { described: true });
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        body: "First words.",
        oldSeo: { seoTitle: "Hello from the old site" },
        cards: [{ label: "One" }, { label: "Two" }],
        status: "published",
      });
      const loc = `${SITE}/blog/hello`;
      const first = await lastmodOf(loc);
      const [kept] = await rows(ctx);
      const read = async () =>
        (await t.nextly.findByID({ collection: POSTS, id: post.id })) as {
          title?: unknown;
          slug?: unknown;
          body?: unknown;
          oldSeo?: unknown;
          cards?: { id?: unknown }[];
        };

      // As the admin saves a page: every field as it was read, each field
      // group row with its id, and only the SEO changed. The rows are
      // updated in place, which moves their own stamps.
      await nextSecond();
      const before = await read();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: {
          title: before.title,
          slug: before.slug,
          body: before.body,
          oldSeo: before.oldSeo,
          cards: before.cards,
          seo: { metaTitle: "Hello, world" },
          _overwrite: true,
        },
      });
      expect(await lastmodOf(loc)).toBe(first);
      expect((await rows(ctx))[0]?.fingerprint).toBe(kept?.fingerprint);

      // As an API client saves it: the cards' values alone, without their
      // ids, so each is stored again under a new one.
      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: {
          cards: [{ label: "One" }, { label: "Two" }],
          seo: { metaTitle: "Hello, again" },
          _overwrite: true,
        },
      });
      const renewed = (await read()).cards?.map(card => card.id);
      expect(renewed).toHaveLength(2);
      for (const id of renewed ?? []) {
        expect(before.cards?.map(card => card.id)).not.toContain(id);
      }
      expect(await lastmodOf(loc)).toBe(first);
      expect((await rows(ctx))[0]?.fingerprint).toBe(kept?.fingerprint);

      // The full check's catch-up reads the page again, and keeps the date.
      await refreshContentDates(ctx, [
        { holder: { collection: POSTS, id: post.id }, language: "en" },
      ]);
      expect(await lastmodOf(loc)).toBe(first);

      // A card's own text is content: changing it moves the date.
      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: {
          cards: [{ label: "One" }, { label: "Two, rewritten" }],
          _overwrite: true,
        },
      });
      expect(Date.parse(String(await lastmodOf(loc)))).toBeGreaterThan(
        Date.parse(String(first))
      );
    });

    it("keeps the date of a row an earlier release fingerprinted, bringing its fingerprint up to date", async () => {
      const { t, ctx } = await boot(dialect, { described: true });
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        body: "First words.",
        oldSeo: { seoTitle: "Hello from the old site" },
        cards: [{ label: "One" }],
        status: "published",
      });
      await contentDatesSettled();
      const holder = { collection: POSTS, id: post.id };
      const published = async () => {
        const type = await typeOf(ctx, holder);
        if (type === undefined) throw new Error("posts are not a type");
        const found = (await documentsIn(ctx, type, [post.id], "en")).get(
          post.id
        );
        if (found === undefined) throw new Error("the post is not published");
        return found;
      };
      const columns = ctx.db.table(contentDates);
      const earlierDate = new Date("2026-01-01T00:00:00.000Z");
      /** The row as an earlier release kept it for the content now shown. */
      const keptByEarlierRelease = async () => {
        const [earlier] = earlierContentFingerprints(await published());
        // The page's field groups make the two readings differ, which is
        // what this case is about.
        expect(earlier).toBeDefined();
        await ctx.db
          .update(contentDates, {
            fingerprint: String(earlier),
            changedAt: earlierDate,
          })
          .where(ne(columns.holderId, ""));
      };
      const loc = `${SITE}/blog/hello`;

      // Caught up at the full check.
      await keptByEarlierRelease();
      await refreshContentDates(ctx, [{ holder, language: "en" }]);
      expect(second(await lastmodOf(loc))).toBe(second(earlierDate));
      expect((await rows(ctx))[0]?.fingerprint).toBe(
        contentFingerprint(await published())
      );

      // Recorded after a save that changed only the page's SEO.
      await keptByEarlierRelease();
      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { seo: { metaTitle: "Hello, world" }, _overwrite: true },
      });
      expect(second(await lastmodOf(loc))).toBe(second(earlierDate));
      expect((await rows(ctx))[0]?.fingerprint).toBe(
        contentFingerprint(await published())
      );

      // Brought up to date at the first start after the upgrade, before an
      // admin save sends the field groups back and rewrites their rows: the
      // stamps the earlier fingerprint was taken from are gone after it.
      await keptByEarlierRelease();
      await forgetNotes(ctx, [FINGERPRINT_READING_KEY]);
      await upgradeKeptFingerprints(ctx);
      expect((await rows(ctx))[0]?.fingerprint).toBe(
        contentFingerprint(await published())
      );
      await nextSecond();
      const read = (await t.nextly.findByID({
        collection: POSTS,
        id: post.id,
      })) as Record<string, unknown>;
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: {
          title: read.title,
          slug: read.slug,
          body: read.body,
          oldSeo: read.oldSeo,
          cards: read.cards,
          seo: { metaTitle: "Hello, again" },
          _overwrite: true,
        },
      });
      expect(second(await lastmodOf(loc))).toBe(second(earlierDate));

      // Once noted, a start reads the note and nothing else.
      await keptByEarlierRelease();
      const [noted] = await rows(ctx);
      await upgradeKeptFingerprints(ctx);
      expect((await rows(ctx))[0]?.fingerprint).toBe(noted?.fingerprint);

      // A content change still moves it.
      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { body: "Rewritten.", _overwrite: true },
      });
      expect(Date.parse(String(await lastmodOf(loc)))).toBeGreaterThan(
        earlierDate.getTime()
      );
    });

    it("brings the kept fingerprints up to date when the plugin starts, and notes it", async () => {
      await boot(dialect);
      // Started by the plugin's start, after the boot.
      await lastFingerprintUpgrade();
      const { notes } = await readNotes(seoContext(), [
        FINGERPRINT_READING_KEY,
      ]);
      expect(notes.get(FINGERPRINT_READING_KEY)).toBeTruthy();
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "seoLastChanged, a page's last change for site code (%s)",
  dialect => {
    /**
     * A stamp as ISO text to the millisecond, as Nextly read it: a `Date` on
     * PostgreSQL, text elsewhere. `String()` of a `Date` drops its
     * milliseconds.
     */
    const isoOf = (value: unknown) =>
      (value instanceof Date ? value : new Date(String(value))).toISOString();

    /** The post with `id` as site code reads it. */
    async function read(t: TestNextly, id: string) {
      await contentDatesSettled();
      const { items } = await t.nextly.find({ collection: POSTS });
      const found = items.find(item => String(item.id) === id);
      if (found === undefined) throw new Error(`${id} is not found`);
      return found as { id: string; updatedAt?: unknown };
    }

    it("dates an entry by its content, so an SEO-only save leaves it and a content change moves it", async () => {
      const { t } = await boot(dialect);
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        body: "First words.",
        status: "published",
      });
      const first = await seoLastChanged({
        collection: POSTS,
        entry: await read(t, post.id),
      });
      expect(second(first)).toBe(second(post.updatedAt));
      // The sitemap's own date for the page, the same answer.
      expect(first).toBe(await lastmodOf(`${SITE}/blog/hello`));

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { seo: { metaTitle: "Hello, world" }, _overwrite: true },
      });
      const afterSeo = await read(t, post.id);
      // The row's own date moved; the content date did not.
      expect(instant(afterSeo.updatedAt)).toBeGreaterThan(instant(first));
      expect(await seoLastChanged({ collection: POSTS, entry: afterSeo })).toBe(
        first
      );

      await nextSecond();
      await t.nextly.update({
        collection: POSTS,
        id: post.id,
        data: { body: "Rewritten.", _overwrite: true },
      });
      const moved = await seoLastChanged({
        collection: POSTS,
        entry: await read(t, post.id),
      });
      expect(instant(moved)).toBeGreaterThan(instant(first));
      expect(moved).toBe(await lastmodOf(`${SITE}/blog/hello`));
    });

    it("dates a batch of entries in one read, each by its own content date or else its own last save", async () => {
      const { t, ctx } = await boot(dialect);
      const posts = [];
      for (const slug of ["one", "two", "three"]) {
        posts.push(
          await create(t, POSTS, {
            title: slug,
            slug,
            body: `About ${slug}.`,
            status: "published",
          })
        );
      }
      await contentDatesSettled();
      // The second's content changed on a known date, and the third is as a
      // page saved before content dates were kept: no row.
      const columns = ctx.db.table(contentDates);
      const [one, two, three] = posts;
      if (one === undefined || two === undefined || three === undefined) {
        throw new Error("three posts were not created");
      }
      await ctx.db
        .delete(contentDates)
        .where(
          eq(
            columns.pageKey,
            pageDateKey({ collection: POSTS, id: three.id }, "en")
          )
        );
      await recordContentDate(ctx, {
        holder: { collection: POSTS, id: two.id },
        locale: "en",
        fingerprint: "f".repeat(64),
        changedAt: new Date("2026-01-02T03:04:05.000Z"),
      });
      const { items } = await t.nextly.find({ collection: POSTS });

      let dates = new Map<unknown, string>();
      const statements = await statementsOf(dialect, async () => {
        dates = await seoLastChanged({ collection: POSTS, entries: items });
      });

      expect(second(dates.get(one.id))).toBe(second(one.updatedAt));
      expect(dates.get(two.id)).toBe("2026-01-02T03:04:05.000Z");
      // No row: its own last save, as the sitemap dates it.
      expect(dates.get(three.id)).toBe(
        isoOf(items.find(item => item.id === three.id)?.updatedAt)
      );
      // One read for the batch of content dates, whatever its size.
      expect(statements.filter(sql => /content_dates/i.test(sql))).toHaveLength(
        1
      );
    });

    it("reads the date kept in the language asked for, else the site's default language", async () => {
      const { t, ctx } = await boot(dialect);
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await contentDatesSettled();
      await recordContentDate(ctx, {
        holder: { collection: POSTS, id: post.id },
        locale: "fr",
        fingerprint: "f".repeat(64),
        changedAt: new Date("2026-03-04T05:06:07.000Z"),
      });
      const entry = await read(t, post.id);

      expect(
        await seoLastChanged({ collection: POSTS, entry, locale: "fr" })
      ).toBe("2026-03-04T05:06:07.000Z");
      // The site's default language, English on a site naming none.
      expect(second(await seoLastChanged({ collection: POSTS, entry }))).toBe(
        second(post.updatedAt)
      );
      // A language with no date kept: the entry's own last save.
      expect(
        await seoLastChanged({ collection: POSTS, entry, locale: "de" })
      ).toBe(isoOf(entry.updatedAt));
    });

    it("gives an entry with no date kept its own last save, and none where it has neither", async () => {
      const { t, ctx } = await boot(dialect);
      const post = await create(t, POSTS, {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await contentDatesSettled();
      await clearDates(ctx);
      const entry = await read(t, post.id);

      expect(await seoLastChanged({ collection: POSTS, entry })).toBe(
        isoOf(entry.updatedAt)
      );
      expect(
        await seoLastChanged({ collection: POSTS, entry: { id: post.id } })
      ).toBeUndefined();
      expect(await rows(ctx)).toEqual([]);
    });

    it("dates a Single by its content, as the sitemap does", async () => {
      const { t } = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "seocd_home",
        data: { title: "Acme", _overwrite: true },
      });
      await contentDatesSettled();
      const home = (await t.nextly.findSingle({ slug: "seocd_home" })) as {
        id: string;
        updatedAt?: unknown;
      };
      const first = await seoLastChanged({ single: "seocd_home", entry: home });
      expect(first).toBe(await lastmodOf(`${SITE}/`));

      await nextSecond();
      await t.nextly.updateSingle({
        slug: "seocd_home",
        data: {
          title: "Acme",
          seo: { metaTitle: "Acme, home" },
          _overwrite: true,
        },
      });
      await contentDatesSettled();
      const saved = (await t.nextly.findSingle({ slug: "seocd_home" })) as {
        id: string;
        updatedAt?: unknown;
      };
      expect(instant(saved.updatedAt)).toBeGreaterThan(instant(first));
      expect(await seoLastChanged({ single: "seocd_home", entry: saved })).toBe(
        first
      );
    });
  }
);
