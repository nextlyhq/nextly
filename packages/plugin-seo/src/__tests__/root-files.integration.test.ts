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
import { ADDRESS_RECORD_SLUG } from "../address-record/collection";
import type { ListedPagesService } from "../outputs/listing";
import { seoPlugin, type SeoPluginOptions } from "../plugin";

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
        fields: [text({ name: "title" }), text({ name: "slug" })],
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

/** The `<url>` entry of one page, as the sitemap writes it. */
async function entryOf(loc: string): Promise<string | undefined> {
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
async function forgetFingerprint(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: ADDRESS_RECORD_SLUG,
    limit: 500,
  });
  for (const row of items as Record<string, unknown>[]) {
    // The fingerprint alone; the list of site types beside it stays.
    if (row.kind === "meta" && !String(row.path).startsWith("[")) {
      await t.nextly.delete({
        collection: ADDRESS_RECORD_SLUG,
        id: String(row.id),
      });
    }
  }
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
  }
);
