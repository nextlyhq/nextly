/**
 * The sitemap route serves published content as XML over the catch-all, proven
 * end-to-end against a real boot: a published entry appears, a draft and a
 * `noindex` entry do not, only the configured subset is enumerated, and the
 * data provider reflects a publish. Drives the real `contributes.routes`
 * handler through `createDynamicHandlers` — the same path production serves.
 *
 * Each route test uses a DISTINCT `baseUrl` (or request host) so the assertions
 * stay independent, and publish-freshness is checked against the data provider
 * directly.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../plugin";
import { buildSitemapUrls, type SitemapServices } from "../sitemap";

// Segments after `/api/`, matching how the catch-all splits the path. The
// plugin name `@nextlyhq/plugin-seo` is two segments (it contains a slash).
const SITEMAP_PARAMS = ["plugins", "@nextlyhq", "plugin-seo", "sitemap.xml"];

// A distinct origin per test so the route's F1 cache key (which includes the
// baseUrl) never collides across boots in the same process.
let seq = 0;
const nextBase = (): string => `https://s${(seq += 1)}.example`;

const pages = () =>
  defineCollection({
    slug: "pages",
    // Built-in draft/published lifecycle: adds the NOT NULL `status` column the
    // sitemap filters on (`{ status: { equals: "published" } }`).
    status: true,
    fields: [text({ name: "slug" }), text({ name: "title" })],
  });

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function fetchSitemap(
  host = "localhost"
): Promise<{ status: number; body: string }> {
  const handlers = createDynamicHandlers();
  const res = await handlers.GET(
    new Request(`http://${host}/api/plugins/@nextlyhq/plugin-seo/sitemap.xml`),
    { params: Promise.resolve({ params: SITEMAP_PARAMS }) }
  );
  return { status: res.status, body: await res.text() };
}

/** A probe plugin that captures the real `ctx.services` for provider tests. */
function captureServices(): {
  probe: ReturnType<typeof definePlugin>;
  get(): SitemapServices;
} {
  let captured: SitemapServices | undefined;
  const probe = definePlugin({
    name: "@test/sitemap-probe",
    version: "0.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      captured = ctx.services;
    },
  });
  return {
    probe,
    get() {
      if (!captured) throw new Error("probe did not capture ctx.services");
      return captured;
    },
  };
}

describe("seo sitemap route (integration)", () => {
  it("declares a public GET /sitemap.xml route", () => {
    const route = seoPlugin({
      collections: ["pages"],
    }).contributes?.routes?.[0];
    expect(route).toMatchObject({
      method: "GET",
      path: "/sitemap.xml",
      public: true,
    });
  });

  it("serves published entries as XML and omits drafts + noindex", async () => {
    const base = nextBase();
    current = await createTestNextly({
      collections: [pages()],
      plugins: [seoPlugin({ collections: ["pages"], baseUrl: base })],
    });

    await current.nextly.create({
      collection: "pages",
      data: { slug: "published", title: "P", status: "published" },
    });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "draft", title: "D", status: "draft" },
    });
    await current.nextly.create({
      collection: "pages",
      data: {
        slug: "hidden",
        title: "H",
        status: "published",
        seo: { noindex: true },
      },
    });

    const { status, body } = await fetchSitemap();

    expect(status).toBe(200);
    expect(body).toContain(`<loc>${base}/pages/published</loc>`);
    // A draft is not public, and a noindexed page must not be advertised.
    expect(body).not.toContain("/pages/draft");
    expect(body).not.toContain("/pages/hidden");
  });

  it("reflects a newly published entry (uncached data provider)", async () => {
    const probe = captureServices();
    current = await createTestNextly({
      collections: [pages()],
      plugins: [seoPlugin({ collections: ["pages"] }), probe.probe],
    });

    const created = await current.nextly.create({
      collection: "pages",
      data: { slug: "later", title: "L", status: "draft" },
    });
    const id = (created.item as { id: string }).id;

    const build = () =>
      buildSitemapUrls(probe.get(), {
        collections: ["pages"],
        baseUrl: "https://x.com",
      });

    // Not yet published: absent from the sitemap.
    expect((await build()).map(u => u.loc)).not.toContain(
      "https://x.com/pages/later"
    );

    await current.nextly.update({
      collection: "pages",
      id,
      data: { status: "published" },
    });

    // Published now: the published filter responds to the transition.
    expect((await build()).map(u => u.loc)).toContain(
      "https://x.com/pages/later"
    );
  });

  it("pages through every published entry against the real service", async () => {
    // Run the pagination loop against the actual managed facade (which pages by
    // `page`, not `offset`). With a page size of one and three entries, an
    // offset-advancing loop would re-read page one forever; a page-advancing
    // loop collects all three and stops.
    const probe = captureServices();
    current = await createTestNextly({
      collections: [pages()],
      plugins: [seoPlugin({ collections: ["pages"] }), probe.probe],
    });

    for (const slug of ["a", "b", "c"]) {
      await current.nextly.create({
        collection: "pages",
        data: { slug, title: slug.toUpperCase(), status: "published" },
      });
    }

    const urls = await buildSitemapUrls(probe.get(), {
      collections: ["pages"],
      baseUrl: "https://x.com",
      pageSize: 1,
    });

    expect(urls.map(u => u.loc).sort()).toEqual([
      "https://x.com/pages/a",
      "https://x.com/pages/b",
      "https://x.com/pages/c",
    ]);
  });

  it("lists every entry of a status-less collection (no unpublished state)", async () => {
    // A collection without `status: true` has no draft/published lifecycle, so
    // the published filter is skipped and every (live) entry is listed.
    const base = nextBase();
    const notes = () =>
      defineCollection({
        slug: "notes",
        fields: [text({ name: "slug" }), text({ name: "title" })],
      });

    current = await createTestNextly({
      collections: [notes()],
      plugins: [seoPlugin({ collections: ["notes"], baseUrl: base })],
    });

    await current.nextly.create({
      collection: "notes",
      data: { slug: "one", title: "One" },
    });

    expect((await fetchSitemap()).body).toContain(
      `<loc>${base}/notes/one</loc>`
    );
  });

  it("advertises only the sitemap subset, keeping a private collection out", async () => {
    const base = nextBase();
    const posts = () =>
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "slug" }), text({ name: "title" })],
      });

    current = await createTestNextly({
      collections: [pages(), posts()],
      plugins: [
        // Both collections get SEO fields, but only `posts` is enumerated.
        seoPlugin({
          collections: ["pages", "posts"],
          baseUrl: base,
          sitemap: { collections: ["posts"] },
        }),
      ],
    });

    await current.nextly.create({
      collection: "pages",
      data: { slug: "secret", title: "S", status: "published" },
    });
    await current.nextly.create({
      collection: "posts",
      data: { slug: "hello", title: "H", status: "published" },
    });

    const { body } = await fetchSitemap();
    expect(body).toContain(`<loc>${base}/posts/hello</loc>`);
    expect(body).not.toContain("/pages/secret");
  });

  it("derives the origin from the request when baseUrl is not configured", async () => {
    // Distinct host so the origin-derived cache key is unique to this test.
    const host = `origin-${seq + 1}.test`;
    current = await createTestNextly({
      collections: [pages()],
      plugins: [seoPlugin({ collections: ["pages"] })],
    });

    await current.nextly.create({
      collection: "pages",
      data: { slug: "home", title: "H", status: "published" },
    });

    const { body } = await fetchSitemap(host);
    expect(body).toContain(`<loc>http://${host}/pages/home</loc>`);
  });
});
