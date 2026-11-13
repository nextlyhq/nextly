/**
 * How search results may show a page, on every configured dialect, through
 * the route helpers and the root files a site serves: every listed page asks
 * for large image previews unless the site switches that off, a page's own
 * choices in its `seo` group are stored and served, and a page whose date to
 * drop from search has passed is served `noindex` and leaves the sitemap and
 * llms.txt, while one whose date is still to come stays listed with it.
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
import {
  createDynamicHandlers,
  createPublicContentRoute,
  type ContentEntry,
} from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";

const SITE = "https://acme.example";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    plugins: [seoPlugin({ collections: ["pages"], baseUrl: SITE })],
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
  await lastCatchUp();
  return current;
}

async function page(
  t: TestNextly,
  slug: string,
  seo: Record<string, unknown> = {}
): Promise<void> {
  await t.nextly.create({
    collection: "pages",
    data: { title: `Page ${slug}`, slug, status: "published", seo },
  });
}

/** The head of the page at `slug`, as a public route serves it. */
async function robotsOf(t: TestNextly, slug: string) {
  const route = createPublicContentRoute({
    collections: ["pages"],
    nextly: t.nextly,
    render: (entry: ContentEntry) => entry.title,
  });
  return (await route.generateMetadata({ params: { slug: [slug] } })).robots;
}

/** A root file, as the site's rewrite reaches the API handler with it. */
async function rootFile(file: string): Promise<string> {
  const response = await createDynamicHandlers().GET(
    new Request(`${SITE}/admin/api/${file}`),
    { params: Promise.resolve({ params: [file] }) }
  );
  return response.text();
}

async function settings(
  t: TestNextly,
  data: Record<string, unknown>
): Promise<void> {
  await t.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: { _overwrite: true, siteName: "Acme", ...data },
  });
}

describe.each(getConfiguredTestDialects())(
  "how search results may show a page (%s)",
  dialect => {
    it("asks for large image previews by default, and not once the site turns them off", async () => {
      const t = await boot(dialect);
      await page(t, "about");

      expect(await robotsOf(t, "about")).toEqual({
        index: true,
        follow: true,
        "max-image-preview": "large",
      });

      await settings(t, { largeImagePreviews: false });
      expect(await robotsOf(t, "about")).toEqual({ index: true, follow: true });
    });

    it("reads settings stored empty as asking for large previews", async () => {
      const t = await boot(dialect);
      await page(t, "about");
      await settings(t, { largeImagePreviews: null });

      expect(await robotsOf(t, "about")).toMatchObject({
        "max-image-preview": "large",
      });
    });

    it("keeps asking for large previews on a database not migrated for the switch yet", async () => {
      const t = await boot(dialect);
      await page(t, "about");
      await settings(t, { description: "Acme makes rockets." });
      // As a site that upgraded and has not run its migration: the settings
      // table has no column for the switch. Raw SQL, and only in a test: no
      // API removes a column a Single declares.
      await t.adapter.executeQuery(
        "ALTER TABLE single_seo_settings DROP COLUMN large_image_previews"
      );

      expect(await robotsOf(t, "about")).toEqual({
        index: true,
        follow: true,
        "max-image-preview": "large",
      });
    });

    it("stores each of a page's own choices and serves them", async () => {
      const t = await boot(dialect);
      await page(t, "pricing", {
        maxImagePreview: "none",
        maxSnippet: 80,
        noimageindex: true,
        unavailableAfter: "2099-12-31T23:59:00.000Z",
        noarchive: true,
      });

      const stored = await t.nextly.find({
        collection: "pages",
        where: { slug: { equals: "pricing" } },
      });
      const seo = (stored.items[0] as { seo?: Record<string, unknown> }).seo;
      expect(seo).toMatchObject({
        maxImagePreview: "none",
        maxSnippet: 80,
        noimageindex: true,
        noarchive: true,
      });
      expect(Date.parse(String(seo?.unavailableAfter))).toBe(
        Date.parse("2099-12-31T23:59:00.000Z")
      );

      expect(await robotsOf(t, "pricing")).toEqual({
        index: true,
        follow: true,
        "max-image-preview": "none",
        "max-snippet": 80,
        noimageindex: true,
        unavailable_after: "2099-12-31T23:59:00.000Z",
        noarchive: true,
      });
    });

    it("refuses a size Google has no name for, and a snippet of no characters", async () => {
      const t = await boot(dialect);
      await expect(
        page(t, "odd", { maxImagePreview: "huge" })
      ).rejects.toThrow();
      await expect(page(t, "zero", { maxSnippet: 0 })).rejects.toThrow();
    });

    it("keeps a page listed before its date to drop from search, and hides it after", async () => {
      const t = await boot(dialect);
      await settings(t, { llmsTxt: true });
      await page(t, "sale", { unavailableAfter: "2099-01-01T00:00:00.000Z" });
      await page(t, "old-sale", {
        unavailableAfter: "2020-01-01T00:00:00.000Z",
      });

      expect(await robotsOf(t, "sale")).toMatchObject({
        index: true,
        unavailable_after: "2099-01-01T00:00:00.000Z",
      });
      expect(await robotsOf(t, "old-sale")).toEqual({
        index: false,
        follow: true,
      });

      const sitemap = await rootFile("sitemap.xml");
      expect(sitemap).toContain(`<loc>${SITE}/sale</loc>`);
      expect(sitemap).not.toContain(`${SITE}/old-sale`);
      const llms = await rootFile("llms.txt");
      expect(llms).toContain(`(${SITE}/sale)`);
      expect(llms).not.toContain(`${SITE}/old-sale`);
    });
  }
);
