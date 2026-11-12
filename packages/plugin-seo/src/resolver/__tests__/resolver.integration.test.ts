/**
 * The SEO plugin answers every page's head through the route helpers, on
 * every configured dialect: what a person typed beats the route's code field
 * by field, the canonical is the page's declared address, and a page hidden
 * from search is served `noindex`. The route's own robots are a floor and
 * keep their other directives; a page whose type declares no address keeps
 * the route's canonical; and a Single a site renders itself is answered as a
 * Single route answers it, at the address it was served.
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
import { defineCollection, defineSingle, text } from "nextly";
import {
  contentPageMetadata,
  createPublicContentRoute,
  singlePageMetadata,
  singlePageStructuredData,
  type ContentEntry,
} from "nextly/runtime";
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
    plugins: [
      seoPlugin({
        collections: ["pages", "features"],
        singles: ["blog-page"],
        baseUrl: "https://acme.example",
      }),
    ],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
      // No public address: the site's routes decide where its pages live.
      defineCollection({
        slug: "features",
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "blog-page",
        label: { singular: "Blog" },
        fields: [text({ name: "title" })],
        publicAddress: "/blog",
      }),
    ],
  });
  return current;
}

/** The head of the page at `slug`, as a public route with its own code serves it. */
async function headOf(t: TestNextly, slug: string) {
  const route = createPublicContentRoute({
    collections: ["pages"],
    nextly: t.nextly,
    render: (entry: ContentEntry) => entry.title,
    buildMetadata: () => ({
      title: "Set in code",
      description: "Described in code",
    }),
  });
  return route.generateMetadata({ params: { slug: [slug] } });
}

describe.each(getConfiguredTestDialects())(
  "the SEO plugin answers each page's head (%s)",
  dialect => {
    it("what a person typed wins over code, field by field, at the page's own address", async () => {
      const t = await boot(dialect);
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "About",
          slug: "about",
          status: "published",
          seo: { metaTitle: "About Acme" },
        },
      });

      const head = await headOf(t, "about");

      // Typed for the page, so its whole title, past a layout's template.
      expect(head.title).toEqual({ absolute: "About Acme" });
      expect(head.description).toBe("Described in code");
      expect(head.alternates?.canonical).toBe("/about");
      expect(head.robots).toMatchObject({ index: true, follow: true });
    });

    it("a page hidden from search is served noindex", async () => {
      const t = await boot(dialect);
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "Ideas",
          slug: "ideas",
          status: "published",
          seo: { noindex: true },
        },
      });

      const head = await headOf(t, "ideas");

      expect(head.robots).toMatchObject({ index: false, follow: true });
      // The route's own title, served as the route gave it.
      expect(head.title).toBe("Set in code");
    });

    it("keeps a page the route hides hidden, with the preview limits the route sets", async () => {
      const t = await boot(dialect);
      const entry = (
        await t.nextly.create({
          collection: "pages",
          data: { title: "Tag", slug: "tag", status: "published" },
        })
      ).item as ContentEntry;
      const previews = {
        "max-image-preview": "large",
        "max-snippet": -1,
      } as const;
      const headWith = (robots: Record<string, unknown>) =>
        contentPageMetadata(
          { buildMetadata: () => ({ robots }) },
          entry,
          { collection: "pages", slug: "tag" },
          "/tag"
        );

      expect(
        (await headWith({ index: false, follow: true, ...previews })).robots
      ).toEqual({ index: false, follow: true, ...previews });
      expect(
        (await headWith({ index: true, follow: true, ...previews })).robots
      ).toEqual({ index: true, follow: true, ...previews });
    });

    it("keeps the route's canonical for a page whose type declares no address", async () => {
      const t = await boot(dialect);
      const entry = (
        await t.nextly.create({
          collection: "features",
          data: { title: "Brand voice", slug: "brand-voice" },
        })
      ).item as ContentEntry;

      const head = await contentPageMetadata(
        {
          buildMetadata: () => ({
            alternates: { canonical: "/brand-voice" },
            openGraph: { url: "/brand-voice" },
          }),
        },
        entry,
        { collection: "features", slug: "brand-voice" },
        "/brand-voice"
      );

      expect(head.alternates?.canonical).toBe("/brand-voice");
      expect(head.openGraph?.url).toBe("/brand-voice");
    });

    it("answers a Single a site renders itself at its address, and a later page of its list at its own", async () => {
      const t = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "blog-page",
        data: { _overwrite: true, title: "Blog" },
      });
      const document = await t.nextly.findSingle({ slug: "blog-page" });
      const own = { buildMetadata: () => ({ description: "Every post." }) };
      const context = { slug: "blog-page" };

      const first = await singlePageMetadata(own, document, context);
      const later = await singlePageMetadata(
        own,
        document,
        context,
        "/blog/page/2"
      );

      expect(first.alternates?.canonical).toBe("/blog");
      expect(first.description).toBe("Every post.");
      expect(later.alternates?.canonical).toBe("/blog/page/2");
      const text = await singlePageStructuredData(
        own,
        document,
        context,
        "/blog/page/2"
      );
      expect(text).toContain("https://acme.example/blog/page/2");
    });
  }
);
