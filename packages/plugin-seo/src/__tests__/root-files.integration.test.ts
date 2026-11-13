/**
 * The site's `/sitemap.xml` and `/robots.txt`, served by the SEO plugin at the
 * root on every configured dialect, and both read from each page's one
 * answer: a page hidden from search, alone or with its whole type, leaves the
 * sitemap in the same change that serves it `noindex`; a page whose canonical
 * points elsewhere is not listed; an address served by another page than the
 * one holding it is left out and listed as a problem; `lastmod` and the
 * images follow the published page only.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text, upload } from "nextly";
import {
  createDynamicHandlers,
  createPublicContentRoute,
  type ContentEntry,
} from "nextly/runtime";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { catchUp, lastCatchUp } from "../address-record/catch-up";
import { forgetNote } from "../address-record/__tests__/record-tables";
import { contentDatesSettled } from "../content-dates/hooks";
import type { ListedPagesService } from "../outputs/listing";
import { seoMetadata } from "../code-pages/metadata";
import { seoPlugin, type SeoPluginOptions } from "../plugin";
import { SEO_SETTINGS_SLUG } from "../settings/contract";

const SITE = "https://acme.example";

/** A 1x1 PNG, the smallest file the media library accepts as an image. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Where an upload lands, and the ignore file local storage writes beside it
 * on its first upload: both under the package this suite runs in, taken down
 * after the suite when the suite made them.
 */
const UPLOADS = path.resolve("public");
const IGNORE = path.resolve(".gitignore");
const madeHere = { uploads: !existsSync(UPLOADS), ignore: !existsSync(IGNORE) };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

afterAll(() => {
  if (madeHere.uploads) rmSync(UPLOADS, { recursive: true, force: true });
  if (madeHere.ignore) rmSync(IGNORE, { force: true });
});

/** A plugin that hands its context over. */
function contextOf() {
  const seen: { ctx?: PluginContext } = {};
  const plugin = definePlugin({
    name: "@test/root-files-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      seen.ctx = ctx;
    },
  });
  return { plugin, seen };
}

const open = { read: () => true };

async function boot(
  dialect: TestDialect,
  options: Partial<SeoPluginOptions> = {},
  languages?: string[]
) {
  const { plugin, seen } = contextOf();
  current = await createTestNextly({
    dialect,
    ...(languages === undefined
      ? {}
      : {
          localization: {
            locales: languages,
            defaultLocale: languages[0] ?? "en",
          },
        }),
    plugins: [
      seoPlugin({
        collections: ["pages", "posts", "tags"],
        baseUrl: SITE,
        ...options,
      }),
      plugin,
    ],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        // Edits to a published page are held as a working draft.
        versions: { drafts: true },
        access: open,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          upload({ name: "coverImage", relationTo: "media" }),
        ],
        publicAddress: "/{slug}",
      }),
      defineCollection({
        slug: "posts",
        status: true,
        access: open,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          // A cover under a name no share-image guess reads: structured
          // data reads it where the plugin's options map it.
          upload({ name: "picture", relationTo: "media" }),
        ],
        publicAddress: "/blog/{slug}",
      }),
      // A kind of listing page, with no draft state.
      defineCollection({
        slug: "tags",
        access: open,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/tags/{slug}",
      }),
      // Not public: no address is declared.
      defineCollection({
        slug: "notes",
        status: true,
        access: open,
        fields: [text({ name: "title" }), text({ name: "slug" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        fields: [text({ name: "title" })],
        publicAddress: "/",
      }),
      // A Single with Draft/Published, never published here.
      defineSingle({
        slug: "contact",
        status: true,
        fields: [text({ name: "title" })],
        publicAddress: "/contact",
      }),
    ],
  });
  const ctx = seen.ctx;
  if (!ctx) throw new Error("the probe plugin never started");
  await lastCatchUp();
  return { t: current, ctx };
}

/** A root file, as the site's rewrite reaches the API handler with it. */
async function rootFile(file: string, query = "", at = "http://localhost") {
  const response = await createDynamicHandlers().GET(
    new Request(`${at}/admin/api/${file}${query}`),
    { params: Promise.resolve({ params: [file] }) }
  );
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    retryAfter: response.headers.get("retry-after"),
    body: await response.text(),
  };
}

/** The `<loc>` of every page the sitemap lists, in order. */
async function listed(query = ""): Promise<string[]> {
  const { body } = await rootFile("sitemap.xml", query);
  return [...body.matchAll(/<url><loc>([^<]*)<\/loc>/g)].map(m => m[1] ?? "");
}

/** The `<url>` entry of one page, as the sitemap writes it, once dates settle. */
async function entryOf(loc: string): Promise<string | undefined> {
  await contentDatesSettled();
  const { body } = await rootFile("sitemap.xml");
  return body.split("\n").find(line => line.includes(`<url><loc>${loc}</loc>`));
}

async function create(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>
): Promise<string> {
  const created = await t.nextly.create({ collection, data });
  return String(created.item.id);
}

/** The head a public route serves for the entry at `slug` of `collection`. */
async function headOf(t: TestNextly, collection: string, slug: string) {
  const route = createPublicContentRoute({
    collections: [collection],
    nextly: t.nextly,
    render: (entry: ContentEntry) => entry.title,
  });
  return route.generateMetadata({ params: { slug: [slug] } });
}

async function image(t: TestNextly, name: string) {
  const uploaded = await t.nextly.media.upload({
    file: { data: PNG, name, mimetype: "image/png", size: PNG.length },
  });
  return { id: String(uploaded.id), url: String(uploaded.url) };
}

/** Forget the fingerprint of the last catch-up, as a changed template would. */
async function forgetFingerprint(_t: TestNextly) {
  // The fingerprint alone; the list of site types beside it stays.
  await forgetNote("fingerprint");
}

describe.each(getConfiguredTestDialects())(
  "the sitemap and robots.txt at the site root (%s)",
  dialect => {
    it("lists each listable page at its own address, the homepage Single among them", async () => {
      const { t } = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "home",
        data: { title: "Acme", _overwrite: true },
      });
      await create(t, "pages", {
        title: "About",
        slug: "about",
        status: "published",
      });
      await create(t, "posts", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await create(t, "tags", { title: "News", slug: "news" });
      // Left out: a draft, a page hidden from search, a type with no address,
      // and canonicals pointing elsewhere on the site and off it.
      await create(t, "pages", {
        title: "Soon",
        slug: "soon",
        status: "draft",
      });
      await create(t, "pages", {
        title: "Ideas",
        slug: "ideas",
        status: "published",
        seo: { noindex: true },
      });
      await create(t, "notes", {
        title: "Private",
        slug: "private",
        status: "published",
      });
      await create(t, "pages", {
        title: "Copy",
        slug: "copy",
        status: "published",
        seo: { canonical: "/about" },
      });
      await create(t, "posts", {
        title: "Syndicated",
        slug: "syndicated",
        status: "published",
        seo: {
          canonical: "https://elsewhere.example/original",
          canonicalElsewhere: true,
        },
      });
      // An address off the site, not confirmed as the page's first home, is
      // not a canonical, so the page stays listed at its own address.
      await create(t, "posts", {
        title: "Unconfirmed",
        slug: "unconfirmed",
        status: "published",
        seo: { canonical: "https://elsewhere.example/copy" },
      });
      // A canonical typed as the page's own address keeps it listed.
      await create(t, "pages", {
        title: "Pricing",
        slug: "pricing",
        status: "published",
        seo: { canonical: `${SITE}/pricing` },
      });

      expect((await listed()).sort()).toEqual(
        [
          `${SITE}/`,
          `${SITE}/about`,
          `${SITE}/blog/hello`,
          `${SITE}/blog/unconfirmed`,
          `${SITE}/pricing`,
          `${SITE}/tags/news`,
        ].sort()
      );
      const { status, type } = await rootFile("sitemap.xml");
      expect(status).toBe(200);
      expect(type).toBe("application/xml; charset=utf-8");
    });

    it("lists a page at the address each of its languages is served at", async () => {
      // Several languages and no rule declared: every language under its
      // code. A type that is not translated is published in every language.
      const { t } = await boot(dialect, {}, ["en", "fr"]);
      await create(t, "posts", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      expect(await listed()).toEqual([
        `${SITE}/en/blog/hello`,
        `${SITE}/fr/blog/hello`,
      ]);
    });

    it("leaves out a Single never published, and does not count it as a problem", async () => {
      const { t, ctx } = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "contact",
        data: { title: "Write to us", status: "draft", _overwrite: true },
      });
      expect(await listed()).not.toContain(`${SITE}/contact`);
      const listing = ctx.services.plugins["@nextlyhq/plugin-seo"]
        ?.listedPages as ListedPagesService;
      expect((await listing.list(SITE)).problems).toEqual([]);
    });

    it("hiding a page leaves the sitemap and serves noindex in one change", async () => {
      const { t } = await boot(dialect);
      const id = await create(t, "posts", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      expect(await listed()).toEqual([`${SITE}/blog/hello`]);
      expect((await headOf(t, "posts", "hello")).robots).toMatchObject({
        index: true,
      });

      await t.nextly.update({
        collection: "posts",
        id,
        data: { seo: { noindex: true }, _overwrite: true },
      });

      expect(await listed()).toEqual([]);
      expect((await headOf(t, "posts", "hello")).robots).toMatchObject({
        index: false,
      });
    });

    it("hiding a whole type serves every page in it noindex and leaves all of them out, whatever each page says", async () => {
      {
        const { t } = await boot(dialect, { hiddenTypes: ["tags"] });
        await create(t, "tags", {
          title: "News",
          slug: "news",
          seo: { noindex: false },
        });
        await create(t, "posts", {
          title: "Hello",
          slug: "hello",
          status: "published",
        });

        expect(await listed()).toEqual([`${SITE}/blog/hello`]);
        expect((await headOf(t, "tags", "news")).robots).toMatchObject({
          index: false,
        });
        await current?.destroy();
        current = undefined;
      }
      // Shown again: each page is back to its own setting.
      const { t } = await boot(dialect);
      await create(t, "tags", { title: "News", slug: "news" });
      expect(await listed()).toEqual([`${SITE}/tags/news`]);
      expect((await headOf(t, "tags", "news")).robots).toMatchObject({
        index: true,
      });
    });

    it("leaves out an address served by another page than the one holding it, and lists it as a problem", async () => {
      const { t, ctx } = await boot(dialect);
      const page = await create(t, "pages", {
        title: "Blog page",
        slug: "blog",
        status: "published",
      });
      const tag = await create(t, "tags", { title: "Blog tag", slug: "x" });
      // Types are listed in the order the database names them.
      expect((await listed()).sort()).toEqual([
        `${SITE}/blog`,
        `${SITE}/tags/x`,
      ]);

      // The record gives `/blog` to the tag, as a clash a deploy made leaves
      // it: the page still resolves to `/blog`, and loses it.
      await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            { holder: { collection: "pages", id: page }, holds: [] },
            {
              holder: { collection: "tags", id: tag },
              holds: [
                { locale: "en", path: "/tags/x" },
                { locale: "en", path: "/blog" },
              ],
            },
          ],
          tx
        )
      );

      expect(await listed()).toEqual([`${SITE}/tags/x`]);
      const listing = ctx.services.plugins["@nextlyhq/plugin-seo"]
        ?.listedPages as ListedPagesService;
      const { problems } = await listing.list(SITE);
      expect(problems).toEqual([
        {
          kind: "held-by-another",
          path: "/blog",
          language: "en",
          holder: { collection: "pages", id: page },
          heldBy: expect.objectContaining({ collection: "tags", id: tag }),
        },
      ]);
    });

    it("sets lastmod only from a change to the published page", async () => {
      const { t } = await boot(dialect);
      const id = await create(t, "pages", {
        title: "About",
        slug: "about",
        status: "published",
      });
      const first = await entryOf(`${SITE}/about`);
      expect(first).toMatch(/<lastmod>[^<]+<\/lastmod>/);

      // Timestamps may be kept to the second: a later save is a later second.
      await new Promise(resolve => setTimeout(resolve, 1_100));
      // A save that names no status is held as the working draft.
      await t.nextly.update({
        collection: "pages",
        id,
        data: { title: "About us, rewritten", _overwrite: true },
      });
      expect(await entryOf(`${SITE}/about`)).toBe(first);

      await t.nextly.update({
        collection: "pages",
        id,
        data: {
          title: "About us, rewritten",
          status: "published",
          _overwrite: true,
        },
      });
      const published = await entryOf(`${SITE}/about`);
      expect(published).toMatch(/<lastmod>[^<]+<\/lastmod>/);
      expect(published).not.toBe(first);
    });

    it("holds an SEO change as a draft until the page is published, and never moves the page's lastmod", async () => {
      const { t } = await boot(dialect);
      const id = await create(t, "pages", {
        title: "About",
        slug: "about",
        status: "published",
        seo: { metaTitle: "About Acme" },
      });
      const titleOf = async () =>
        JSON.stringify((await headOf(t, "pages", "about")).title);
      expect(await titleOf()).toContain("About Acme");
      const first = await entryOf(`${SITE}/about`);
      expect(first).toMatch(/<lastmod>[^<]+<\/lastmod>/);

      // Timestamps may be kept to the second: a later save is a later second.
      await new Promise(resolve => setTimeout(resolve, 1_100));
      // An SEO change alone, saved with no status: held as the working draft.
      await t.nextly.update({
        collection: "pages",
        id,
        data: { seo: { metaTitle: "About Acme, rewritten" }, _overwrite: true },
      });
      expect(await titleOf()).not.toContain("rewritten");
      expect(await entryOf(`${SITE}/about`)).toBe(first);

      await t.nextly.update({
        collection: "pages",
        id,
        data: {
          seo: { metaTitle: "About Acme, rewritten" },
          status: "published",
          _overwrite: true,
        },
      });
      expect(await titleOf()).toContain("About Acme, rewritten");
      // Only the page's SEO changed: its content, and so its date, did not.
      expect(await entryOf(`${SITE}/about`)).toBe(first);
    });

    it("lists each page's main image from published content only", async () => {
      const { t } = await boot(dialect);
      const live = await image(t, "seo-live.png");
      const drafted = await image(t, "seo-drafted.png");
      const id = await create(t, "pages", {
        title: "About",
        slug: "about",
        status: "published",
        coverImage: live.id,
      });
      await t.nextly.update({
        collection: "pages",
        id,
        data: { coverImage: drafted.id, _overwrite: true },
      });

      const entry = await entryOf(`${SITE}/about`);
      expect(entry).toContain(
        `<image:loc>${new URL(live.url, SITE).href}</image:loc>`
      );
      expect(entry).not.toContain(new URL(drafted.url, SITE).pathname);
    });

    it("lists a post's mapped cover, and never the site's default share image", async () => {
      const { t } = await boot(dialect, {
        structuredData: {
          types: {
            posts: {
              type: "article",
              details: { article: { image: "picture" } },
            },
          },
        },
      });
      const card = await image(t, "seo-site-card.png");
      const cover = await image(t, "seo-post-cover.png");
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: { _overwrite: true, image: card.id },
      });
      await create(t, "posts", {
        title: "Hello",
        slug: "hello",
        status: "published",
        picture: cover.id,
      });
      // A page whose own card is the site's default one, and a page with no
      // image of its own.
      await create(t, "pages", {
        title: "About",
        slug: "about",
        status: "published",
        seo: { ogImage: card.id },
      });
      await create(t, "tags", { title: "News", slug: "news" });

      const post = await entryOf(`${SITE}/blog/hello`);
      expect(post).toContain(
        `<image:loc>${new URL(cover.url, SITE).href}</image:loc>`
      );
      const cardPath = new URL(card.url, SITE).pathname;
      expect(post).not.toContain(cardPath);
      expect(await entryOf(`${SITE}/about`)).not.toContain("<image:");
      expect(await entryOf(`${SITE}/tags/news`)).not.toContain("<image:");
    });

    it("lists a cover mapped for a type a route chooses, which the listing can't see", async () => {
      // Only the route's code says these posts are tech articles, while it
      // renders; the listing reads the field the type maps an image from.
      const { t } = await boot(dialect, {
        structuredData: {
          types: { posts: { details: { techArticle: { image: "picture" } } } },
        },
      });
      const cover = await image(t, "seo-tech-cover.png");
      await create(t, "posts", {
        title: "Hooks",
        slug: "hooks",
        status: "published",
        picture: cover.id,
      });
      expect(await entryOf(`${SITE}/blog/hooks`)).toContain(
        `<image:loc>${new URL(cover.url, SITE).href}</image:loc>`
      );
    });

    // Each limit crossed on its own: two addresses a file, or room in a file
    // for its wrapper and two of these entries but not three.
    it.each([
      ["the addresses one file holds", { maxUrlsPerFile: 2 }],
      ["the size one file may have", { maxBytesPerFile: 400 }],
    ])(
      "serves a sitemap index past %s, each file at its page",
      async (_, sitemap) => {
        await boot(dialect, { sitemap });
        const t = current as TestNextly;
        for (const slug of ["a", "b", "c"]) {
          await create(t, "posts", { title: slug, slug, status: "published" });
        }
        const index = await rootFile("sitemap.xml");
        expect(index.body).toContain("<sitemapindex ");
        expect(index.body).toContain(`<loc>${SITE}/sitemap.xml?page=2</loc>`);
        const first = await listed("?page=1");
        const second = await listed("?page=2");
        expect([first.length, second.length]).toEqual([2, 1]);
        expect([...first, ...second].sort()).toEqual([
          `${SITE}/blog/a`,
          `${SITE}/blog/b`,
          `${SITE}/blog/c`,
        ]);
        expect((await rootFile("sitemap.xml", "?page=3")).status).toBe(404);
      }
    );

    it("answers the sitemap as not ready while the address record catches up, and lets nothing cache it", async () => {
      const { t } = await boot(dialect);
      await create(t, "posts", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await forgetFingerprint(t);
      let reached!: () => void;
      const listing = new Promise<void>(resolve => {
        reached = resolve;
      });
      let release!: () => void;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      // A deploy's catch-up, held once it has read every page.
      const run = catchUp({
        afterListing: () => {
          reached();
          return held;
        },
      });
      await listing;

      const busy = await rootFile("sitemap.xml");
      expect(busy.status).toBe(503);
      expect(busy.cacheControl).toBe("no-store");
      expect(busy.retryAfter).toBe("120");

      release();
      await run;
      expect(await listed()).toEqual([`${SITE}/blog/hello`]);
    });

    it("stays not ready after a catch-up fails, and tries the catch-up again", async () => {
      const { t } = await boot(dialect);
      await create(t, "posts", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      await forgetFingerprint(t);
      // A catch-up that fails part-way, as a dropped connection would.
      await catchUp({
        afterListing: () => Promise.reject(new Error("connection reset")),
      });

      const failed = await rootFile("sitemap.xml");
      expect(failed.status).toBe(503);
      expect(failed.cacheControl).toBe("no-store");

      // The request started the catch-up again; once it succeeds, the
      // sitemap is served.
      await lastCatchUp();
      expect(await listed()).toEqual([`${SITE}/blog/hello`]);
    });

    it("names its own files in the index it serves at the plugin's own address", async () => {
      await boot(dialect, { sitemap: { maxUrlsPerFile: 2 } });
      const t = current as TestNextly;
      for (const slug of ["a", "b", "c"]) {
        await create(t, "posts", { title: slug, slug, status: "published" });
      }
      const own = "/admin/api/plugins/@nextlyhq/plugin-seo/sitemap.xml";
      const read = async (query = "") => {
        const response = await createDynamicHandlers().GET(
          new Request(`http://localhost${own}${query}`),
          {
            params: Promise.resolve({
              params: ["plugins", "@nextlyhq", "plugin-seo", "sitemap.xml"],
            }),
          }
        );
        return { status: response.status, body: await response.text() };
      };
      const index = await read();
      expect(index.body).toContain(`<loc>${SITE}${own}?page=1</loc>`);
      expect(index.body).toContain(`<loc>${SITE}${own}?page=2</loc>`);
      expect(index.body).not.toContain(`${SITE}/sitemap.xml?page=`);
      const second = await read("?page=2");
      expect(second.status).toBe(200);
      expect(second.body).toContain("<urlset ");
    });

    it("serves robots.txt naming the sitemap by its absolute address", async () => {
      await boot(dialect, { aiCrawlers: "search" });
      const robots = await rootFile("robots.txt");
      expect(robots.status).toBe(200);
      expect(robots.type).toBe("text/plain; charset=utf-8");
      expect(robots.body).toContain("User-agent: GPTBot\nDisallow: /\n");
      expect(
        robots.body.trimEnd().endsWith(`Sitemap: ${SITE}/sitemap.xml`)
      ).toBe(true);
    });

    it("names the site's production address, the one asked at where it is among them", async () => {
      process.env.NEXTLY_PRODUCTION_ADDRESSES =
        "https://acme.example, https://acme.de";
      try {
        const { t } = await boot(dialect, { baseUrl: undefined });
        await create(t, "posts", {
          title: "Hello",
          slug: "hello",
          status: "published",
        });
        const robots = await rootFile("robots.txt");
        expect(robots.body).toContain(
          "Sitemap: https://acme.example/sitemap.xml"
        );
        // A fixed list of addresses, not whatever a request says.
        expect(robots.cacheControl).toBeNull();
        expect((await rootFile("sitemap.xml")).body).toContain(
          "<loc>https://acme.example/blog/hello</loc>"
        );
        const second = await rootFile("robots.txt", "", "https://acme.de");
        expect(second.body).toContain("Sitemap: https://acme.de/sitemap.xml");
      } finally {
        delete process.env.NEXTLY_PRODUCTION_ADDRESSES;
      }
    });

    it("takes the site's address from the request where none is configured, and lets nothing cache it", async () => {
      const { t } = await boot(dialect, { baseUrl: undefined });
      await create(t, "posts", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      const sitemap = await rootFile("sitemap.xml");
      expect(sitemap.body).toContain("<loc>http://localhost/blog/hello</loc>");
      expect(sitemap.cacheControl).toBe("no-store");
      const robots = await rootFile("robots.txt");
      expect(robots.body).toContain("Sitemap: http://localhost/sitemap.xml");
      expect(robots.cacheControl).toBe("no-store");
    });

    it("serves the site's own rules after the plugin's lines, and says the file is the plugin's", async () => {
      const { t } = await boot(dialect, { aiCrawlers: "search" });
      const before = await rootFile("robots.txt");
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: {
          _overwrite: true,
          robotsRules: {
            text: "User-agent: *\nDisallow: /search\nContent-Signal: search=yes, ai-train=no",
          },
        },
      });
      const response = await createDynamicHandlers().GET(
        new Request("http://localhost/admin/api/robots.txt"),
        { params: Promise.resolve({ params: ["robots.txt"] }) }
      );
      const body = await response.text();
      expect(response.headers.get("x-nextly-robots")).toBe("plugin-seo");
      expect(body.startsWith(before.body)).toBe(true);
      expect(body.slice(before.body.length)).toBe(
        "\n# Your own rules, from the SEO settings\nUser-agent: *\nDisallow: /search\nContent-Signal: search=yes, ai-train=no\n"
      );
    });

    it("refuses to save an own rule that keeps every crawler from the whole site", async () => {
      const { t } = await boot(dialect);
      await expect(
        t.nextly.updateSingle({
          slug: SEO_SETTINGS_SLUG,
          data: {
            _overwrite: true,
            robotsRules: { text: "User-agent: *\nDisallow: /" },
          },
        })
      ).rejects.toThrow();
      expect((await rootFile("robots.txt")).body).not.toContain(
        "Your own rules"
      );
    });

    it("keeps answering robots.txt, the sitemap and each head until the own rules' column is migrated", async () => {
      const { t } = await boot(dialect, { aiCrawlers: "search" });
      await create(t, "posts", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      const before = await rootFile("robots.txt");
      const headBefore = await headOf(t, "posts", "hello");
      // A database the upgrade has not been migrated for: the settings'
      // newest column is missing, so core refuses every read of them.
      await t.adapter.executeQuery(
        "ALTER TABLE single_seo_settings DROP COLUMN robots_rules"
      );
      const robots = await rootFile("robots.txt");
      expect(robots.status).toBe(200);
      expect(robots.body).toBe(before.body);
      const sitemap = await rootFile("sitemap.xml");
      expect(sitemap.status).toBe(200);
      expect(sitemap.body).toContain(`<loc>${SITE}/blog/hello</loc>`);
      // Off until switched on, as for a site with nothing set.
      expect((await rootFile("llms.txt")).status).toBe(404);
      // The page's head is still the plugin's answer, read from the rest of
      // the settings.
      expect((await headOf(t, "posts", "hello")).title).toEqual(
        headBefore.title
      );
    });

    it("keeps answering robots.txt and the home page's head until the verification codes' column is migrated", async () => {
      const { t } = await boot(dialect, { aiCrawlers: "search" });
      await create(t, "posts", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      const before = await rootFile("robots.txt");
      const headBefore = await headOf(t, "posts", "hello");
      // A database the upgrade has not been migrated for: the verification
      // codes' column is missing, so it reads as unset, the rest as stored.
      await t.adapter.executeQuery(
        "ALTER TABLE single_seo_settings DROP COLUMN verification_codes"
      );
      const robots = await rootFile("robots.txt");
      expect(robots.status).toBe(200);
      expect(robots.body).toBe(before.body);
      const home = await seoMetadata("/");
      expect(home.verification).toBeUndefined();
      expect((await headOf(t, "posts", "hello")).title).toEqual(
        headBefore.title
      );
    });
  }
);
