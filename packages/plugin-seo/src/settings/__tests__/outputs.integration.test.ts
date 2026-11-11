/**
 * What the SEO settings save reaches the page's head on every configured
 * dialect, through a real content route: a content type hidden from search
 * in the settings is served `noindex`, over the plugin's own option, and the
 * saved site name finishes the default title pattern and names the site on
 * the social card and in structured data.
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
import { SEO_SETTINGS_SLUG } from "../contract";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const PAGES = "seoo_pages";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "the SEO settings in a page's head (%s)",
  (dialect: TestDialect) => {
    async function boot(hiddenTypes?: string[], siteName?: string) {
      current = await createTestNextly({
        dialect,
        plugins: [
          seoPlugin({
            collections: [PAGES],
            ...(hiddenTypes === undefined ? {} : { hiddenTypes }),
            ...(siteName === undefined ? {} : { socialCard: { siteName } }),
          }),
        ],
        collections: [
          defineCollection({
            slug: PAGES,
            status: true,
            access: { read: () => true },
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/{slug}",
          }),
        ],
      });
      await current.nextly.create({
        collection: PAGES,
        data: { title: "About", slug: "about", status: "published" },
      });
      return current;
    }

    /** The head of the page at `slug`, as a public route serves it. */
    async function headOf(t: TestNextly, slug: string) {
      const route = createPublicContentRoute({
        collections: [PAGES],
        nextly: t.nextly,
        render: (entry: ContentEntry) => entry.title,
      });
      return route.generateMetadata({ params: { slug: [slug] } });
    }

    it("serves a type the settings hide as noindex, and titles pages with the saved name", async () => {
      const t = await boot();
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: { _overwrite: true, siteName: "Acme", hiddenTypes: [PAGES] },
      });

      const head = await headOf(t, "about");

      expect(head.robots).toMatchObject({ index: false });
      expect(head.title).toBe("About | Acme");
    });

    it("names the site on the social card and in structured data as the title does", async () => {
      const t = await boot(undefined, "Old name");
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: { _overwrite: true, siteName: "Acme" },
      });

      const head = await headOf(t, "about");

      expect(head.title).toBe("About | Acme");
      expect(head.openGraph).toMatchObject({ siteName: "Acme" });
      expect(JSON.stringify(head)).not.toContain("Old name");
    });

    it("names the site on the social card by the plugin's option until the settings name it", async () => {
      const t = await boot(undefined, "Old name");

      expect((await headOf(t, "about")).openGraph).toMatchObject({
        siteName: "Old name",
      });
    });

    it("lets the settings show a type the plugin's options hide", async () => {
      const t = await boot([PAGES]);
      expect((await headOf(t, "about")).robots).toMatchObject({ index: false });

      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: { _overwrite: true, hiddenTypes: [] },
      });

      expect((await headOf(t, "about")).robots).toMatchObject({ index: true });
    });
  }
);
