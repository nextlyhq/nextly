/**
 * A page's structured data reaches its render through the route helpers, on
 * every configured dialect: built from the same answer as its head, with an
 * author the route read through its relationship, as a visitor reads it,
 * linked to the author's own page,
 * written so that no value can end its script element, and a page's own
 * choice of type stored with the page.
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
import { defineCollection, relationship, text } from "nextly/config";
import { createPublicContentRoute, type ContentEntry } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    // The Public role a visitor is judged by, granted the reads whose rule
    // allows everyone, as a site's boot grants them.
    seedPublic: true,
    plugins: [
      seoPlugin({
        collections: ["posts", "authors"],
        baseUrl: "https://example.com",
        structuredData: {
          brand: { name: "Acme" },
          types: { posts: { type: "blogPosting" } },
        },
      }),
    ],
    collections: [
      defineCollection({
        slug: "authors",
        status: true,
        access: { read: () => true },
        fields: [text({ name: "name" }), text({ name: "slug" })],
        publicAddress: "/authors/{slug}",
      }),
      defineCollection({
        slug: "posts",
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          text({ name: "publishedAt" }),
          relationship({ name: "author", relationTo: "authors" }),
        ],
        publicAddress: "/blog/{slug}",
      }),
    ],
  });
  return current;
}

/** The structured data the post at `slug` is rendered with, as served. */
async function renderedWith(
  t: TestNextly,
  slug: string,
  title?: string
): Promise<string | undefined> {
  const route = createPublicContentRoute({
    collections: ["posts"],
    nextly: t.nextly,
    // The post's author read with it, as a page that shows its author reads
    // it: judged as a visitor, since the route trusts only its own posts.
    depth: 1,
    render: (_: ContentEntry, context) => context.structuredData,
    // The share image the route's code sets, which the article shows, and a
    // title, which the route's code sets as it likes: what a person saves is
    // cleaned of markup, so a value meant to break out comes from code.
    buildMetadata: () => ({
      ...(title === undefined ? {} : { title }),
      openGraph: { images: ["/media/cover.jpg"] },
    }),
  });
  return route.ContentPage({ params: { slug: [slug] } });
}

/** The graph's node of `type`. */
function nodeOf(text: string | undefined, type: string) {
  const graph = (JSON.parse(text ?? "{}") as { "@graph"?: unknown[] })[
    "@graph"
  ];
  return (graph ?? []).find(
    node => (node as { "@type"?: unknown })["@type"] === type
  ) as Record<string, unknown> | undefined;
}

describe.each(getConfiguredTestDialects())(
  "a page's structured data (%s)",
  dialect => {
    it("describes a post as its content type chose, its author read through", async () => {
      const t = await boot(dialect);
      const author = await t.nextly.create({
        collection: "authors",
        data: { name: "Sara Khan", slug: "sara", status: "published" },
      });
      await t.nextly.create({
        collection: "posts",
        data: {
          title: "Ship fast",
          slug: "ship-fast",
          publishedAt: "2026-11-10",
          author: (author.item as { id: string }).id,
          status: "published",
        },
      });

      const text = await renderedWith(
        t,
        "ship-fast",
        "Ship </script><script>alert(1)</script> fast"
      );

      // No value ends the script element the text is placed in.
      expect(text).not.toMatch(/<\/script/i);
      expect(nodeOf(text, "BlogPosting")).toMatchObject({
        "@id": "https://example.com/blog/ship-fast#blogPosting",
        headline: "Ship </script><script>alert(1)</script> fast",
        datePublished: "2026-11-10",
        author: {
          "@type": "Person",
          name: "Sara Khan",
          url: "https://example.com/authors/sara",
        },
        image: { url: "https://example.com/media/cover.jpg" },
        publisher: { "@id": "https://example.com/#organization" },
      });
    });

    it("names no author a visitor cannot see yet", async () => {
      const t = await boot(dialect);
      const author = await t.nextly.create({
        collection: "authors",
        data: { name: "Draft Writer", slug: "draft", status: "draft" },
      });
      await t.nextly.create({
        collection: "posts",
        data: {
          title: "Unsigned",
          slug: "unsigned",
          publishedAt: "2026-11-10",
          author: (author.item as { id: string }).id,
          status: "published",
        },
      });

      const text = await renderedWith(t, "unsigned");

      // The type's markup is left out rather than naming an unpublished author.
      expect(nodeOf(text, "BlogPosting")).toBeUndefined();
      expect(text).not.toContain("Draft Writer");
    });

    it("keeps a page's own choice of type with the page", async () => {
      const t = await boot(dialect);
      await t.nextly.create({
        collection: "posts",
        data: {
          title: "Changelog",
          slug: "changelog",
          status: "published",
          seo: { structuredDataType: "collectionPage" },
        },
      });

      const text = await renderedWith(t, "changelog");

      expect(nodeOf(text, "BlogPosting")).toBeUndefined();
      expect(nodeOf(text, "CollectionPage")).toMatchObject({
        "@id": "https://example.com/blog/changelog",
        name: "Changelog",
      });
    });
  }
);
