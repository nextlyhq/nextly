/**
 * The SEO plugin answers every page's head through the route helpers, on
 * every configured dialect: what a person typed beats the route's code field
 * by field, the canonical is the page's declared address, and a page hidden
 * from search is served `noindex`.
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
import { defineCollection, text } from "nextly";
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
    plugins: [seoPlugin({ collections: ["pages"] })],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
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

      expect(head.title).toBe("About Acme");
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
      expect(head.title).toBe("Set in code");
    });
  }
);
