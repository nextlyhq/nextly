/**
 * The site's RSS feeds on every configured dialect: each holds the newest
 * pages of its collections that the sitemap lists and the public may read,
 * and its code sources' items, newest first; is valid by the W3C validator's
 * rules; keeps each item's guid when its address changes; and is linked from
 * the head of the pages it belongs to, and from llms.txt.
 *
 * In node, as every integration suite runs, with jsdom's XML parser for
 * reading each feed as a reader does.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text, textarea } from "nextly";
import { date } from "nextly/config";
import {
  contentPageMetadata,
  createDynamicHandlers,
  type ContentEntry,
} from "nextly/runtime";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";

import { rssProblems } from "./rss-rules";

const SITE = "https://acme.example";

/** An XML parser as a feed reader's: jsdom's, since node has none. */
const xml = new new JSDOM().window.DOMParser();

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const open = { read: () => true };

/** Release notes built in code, one of them missing the date it came out. */
const releases = () => [
  {
    id: "release:1.1.0",
    title: "Version 1.1",
    url: "/changelog#1.1.0",
    published: "2026-11-20T12:00:00Z",
    description: "Faster rockets.",
  },
  { id: "release:broken", title: "No date", url: "/changelog", published: "" },
];

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    // The Public role a real boot makes, which judges every visitor's read.
    seedPublic: true,
    plugins: [
      seoPlugin({
        collections: ["posts", "members"],
        singles: ["home", "blog"],
        baseUrl: SITE,
        // Posts are articles by default, dated by different fields for each
        // type a post may choose to be described as.
        structuredData: {
          types: {
            posts: {
              type: "article",
              details: {
                article: { datePublished: "publishedAt" },
                blogPosting: { datePublished: "writtenAt" },
              },
            },
          },
        },
        feeds: {
          site: { path: "/feed.xml", sources: ["posts", releases] },
          blog: {
            path: "/blog/feed.xml",
            title: "Acme blog",
            description: "What we write.",
            sources: ["posts", "members"],
            limit: 10,
          },
        },
      }),
    ],
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        access: open,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          textarea({ name: "excerpt" }),
          date({ name: "publishedAt" }),
          date({ name: "writtenAt" }),
          text({ name: "author" }),
          text({ name: "category" }),
          // Kept from the public, and so from every feed.
          textarea({ name: "internal", access: { read: () => false } }),
        ],
        publicAddress: "/blog/{slug}",
      }),
      // Pages the public may not read at all, though they have an address.
      defineCollection({
        slug: "members",
        status: true,
        access: { read: () => false },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/members/{slug}",
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        access: open,
        fields: [text({ name: "title" })],
        publicAddress: "/",
      }),
      defineSingle({
        slug: "blog",
        access: open,
        fields: [text({ name: "title" })],
        publicAddress: "/blog",
      }),
    ],
  });
  await lastCatchUp();
  await current.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: { _overwrite: true, siteName: "Acme", description: "Rockets." },
  });
  return current;
}

/** A feed, as the site's rewrite reaches the API handler with it. */
async function feed(path: string) {
  const parts = ["feed-files", ...path.split("/").filter(Boolean)];
  const response = await createDynamicHandlers().GET(
    new Request(`${SITE}/admin/api/${parts.join("/")}`),
    { params: Promise.resolve({ params: parts }) }
  );
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    cache: response.headers.get("cache-control"),
    body: await response.text(),
  };
}

/** Each item of a feed: its link, guid, title and the rest, as a reader parses them. */
function itemsOf(body: string) {
  const document = xml.parseFromString(body, "application/xml");
  return [...document.getElementsByTagName("item")].map(item => {
    const text = (name: string) =>
      item.getElementsByTagName(name)[0]?.textContent ?? undefined;
    return {
      link: text("link"),
      guid: text("guid"),
      title: text("title"),
      pubDate: text("pubDate"),
      description: text("description"),
      creator: text("dc:creator"),
      categories: [...item.getElementsByTagName("category")].map(
        category => category.textContent
      ),
    };
  });
}

async function post(
  t: TestNextly,
  slug: string,
  status: "published" | "draft",
  extra: Record<string, unknown> = {}
): Promise<ContentEntry> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { title: `Post ${slug}`, slug, status, ...extra },
  });
  return created.item as ContentEntry;
}

describe.each(getConfiguredTestDialects())("RSS feeds (%s)", dialect => {
  it("hold the newest pages the sitemap lists and the public may read, newest first, and are valid RSS 2.0", async () => {
    const t = await boot(dialect);
    await post(t, "older", "published", {
      publishedAt: "2026-10-01T09:00:00.000Z",
      excerpt: "An older post & more.",
      author: "Zoë Writer",
      category: "News",
      internal: "never in a feed",
    });
    await post(t, "newer", "published", {
      publishedAt: "2026-11-25T09:00:00.000Z",
    });
    await post(t, "unfinished", "draft", {
      publishedAt: "2026-11-26T09:00:00.000Z",
    });
    // Hidden from search on its own: the sitemap does not list it.
    await post(t, "hidden", "published", {
      publishedAt: "2026-11-26T09:00:00.000Z",
      seo: { noindex: true },
    });
    await t.nextly.create({
      collection: "members",
      data: { title: "Members only", slug: "club", status: "published" },
    });

    const blog = await feed("/blog/feed.xml");
    expect(blog.status).toBe(200);
    expect(blog.type).toBe("application/rss+xml; charset=utf-8");
    expect(blog.cache).toBe("public, max-age=300, s-maxage=300");
    expect(rssProblems(blog.body, `${SITE}/blog/feed.xml`, xml)).toEqual([]);
    const items = itemsOf(blog.body);
    // Not the draft, the page hidden from search, nor the members' page
    // the public may not read.
    expect(items.map(item => item.link)).toEqual([
      `${SITE}/blog/newer`,
      `${SITE}/blog/older`,
    ]);
    expect(items[1]).toMatchObject({
      title: "Post older",
      pubDate: "Thu, 01 Oct 2026 09:00:00 GMT",
      description: "An older post &amp; more.",
      creator: "Zoë Writer",
      categories: ["News"],
    });
    expect(blog.body).not.toContain("never in a feed");
    expect(blog.body).toContain("<title>Acme blog</title>");
    expect(blog.body).toContain(`<link>${SITE}/blog</link>`);
    expect(blog.body).toContain(
      "<lastBuildDate>" // the newest item's change, not the time asked
    );

    // The site's feed holds the posts and the release notes built in code,
    // newest first; the note with no date is left out.
    const site = await feed("/feed.xml");
    expect(rssProblems(site.body, `${SITE}/feed.xml`, xml)).toEqual([]);
    expect(itemsOf(site.body).map(item => item.guid)).toEqual([
      expect.stringMatching(/^https:\/\/acme\.example#posts:/),
      `${SITE}#release:1.1.0`,
      expect.stringMatching(/^https:\/\/acme\.example#posts:/),
    ]);
    expect(site.body).toContain("<title>Acme</title>");
  });

  it("dates a page by the field mapped for the type the page chooses to be described as", async () => {
    const t = await boot(dialect);
    await post(t, "as-article", "published", {
      publishedAt: "2026-11-10T09:00:00.000Z",
      writtenAt: "2026-01-01T09:00:00.000Z",
    });
    await post(t, "as-blog-posting", "published", {
      publishedAt: "2026-01-01T09:00:00.000Z",
      writtenAt: "2026-11-20T09:00:00.000Z",
      seo: { structuredDataType: "blogPosting" },
    });

    const items = itemsOf((await feed("/blog/feed.xml")).body);
    expect(items.map(item => [item.link, item.pubDate])).toEqual([
      [`${SITE}/blog/as-blog-posting`, "Fri, 20 Nov 2026 09:00:00 GMT"],
      [`${SITE}/blog/as-article`, "Tue, 10 Nov 2026 09:00:00 GMT"],
    ]);
  });

  it("answers not found where no feed is", async () => {
    await boot(dialect);
    expect((await feed("/news/feed.xml")).status).toBe(404);
  });

  it("keeps an item's guid when its page moves to a new address", async () => {
    const t = await boot(dialect);
    const hello = await post(t, "hello", "published");
    const [before] = itemsOf((await feed("/blog/feed.xml")).body);

    await t.nextly.update({
      collection: "posts",
      id: String(hello.id),
      data: { _overwrite: true, slug: "hello-again" },
    });
    await lastCatchUp();
    const [after] = itemsOf((await feed("/blog/feed.xml")).body);

    expect(before?.link).toBe(`${SITE}/blog/hello`);
    expect(after?.link).toBe(`${SITE}/blog/hello-again`);
    expect(after?.guid).toBe(`${SITE}#posts:${String(hello.id)}`);
    expect(after?.guid).toBe(before?.guid);
  });

  it("are linked from the head of the pages they belong to, and named in llms.txt", async () => {
    const t = await boot(dialect);
    const hello = await post(t, "hello", "published");
    const rss = (meta: { alternates?: unknown }) =>
      (meta.alternates as { types?: Record<string, unknown> } | undefined)
        ?.types?.["application/rss+xml"];
    const siteFeed = { url: `${SITE}/feed.xml`, title: "Acme" };
    const blogFeed = { url: `${SITE}/blog/feed.xml`, title: "Acme blog" };

    // A post: the site's feed, on every page, and the blog's, made from it.
    expect(
      rss(
        await contentPageMetadata(
          { buildMetadata: () => ({}) },
          hello,
          { collection: "posts", slug: "hello" },
          "/blog/hello"
        )
      )
    ).toEqual([siteFeed, blogFeed]);

    await t.nextly.updateSingle({
      slug: SEO_SETTINGS_SLUG,
      data: { _overwrite: true, siteName: "Acme", llmsTxt: true },
    });
    const response = await createDynamicHandlers().GET(
      new Request(`${SITE}/admin/api/llms.txt`),
      { params: Promise.resolve({ params: ["llms.txt"] }) }
    );
    expect(await response.text()).toContain(
      `What is new, as RSS: [Acme](${SITE}/feed.xml), [Acme blog](${SITE}/blog/feed.xml).`
    );
  });
});
