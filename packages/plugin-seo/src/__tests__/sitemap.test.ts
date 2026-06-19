/**
 * P7c — sitemap generation: published-only via the D56 `where` query, correct
 * `<loc>`/`<lastmod>`, XML-escaped. Unit (mock service: covers lastmod +
 * escaping + the exact query) + integration (real published filter on a
 * code-first collection — harness entries have null `updatedAt`, so lastmod is
 * covered by the unit test).
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seo } from "../plugin";
import { generateSitemap, type SitemapServices } from "../sitemap";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pages = () =>
  defineCollection({
    slug: "pages",
    fields: [
      text({ name: "slug" }),
      text({ name: "title" }),
      text({ name: "status" }),
    ],
  });

describe("generateSitemap (P7c, unit)", () => {
  it("queries published entries and renders escaped loc + lastmod", async () => {
    const listEntries = vi.fn().mockResolvedValue({
      data: [{ slug: "a&b", updatedAt: "2026-01-02T03:04:05.000Z" }],
    });

    const xml = await generateSitemap(
      { collections: { listEntries } } as unknown as SitemapServices,
      { collections: ["pages"], baseUrl: "https://x.com" }
    );

    expect(listEntries).toHaveBeenCalledWith(
      "pages",
      {
        where: { status: { equals: "published" } },
        depth: 0,
        pagination: { limit: 1000 },
      },
      { as: "system" }
    );
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    expect(xml).toContain("<loc>https://x.com/pages/a&amp;b</loc>");
    expect(xml).toContain("<lastmod>2026-01-02T03:04:05.000Z</lastmod>");
  });
});

describe("generateSitemap (P7c, integration)", () => {
  it("lists only published entries end-to-end", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let services: any;
    const probe = definePlugin({
      name: "@test/seo-probe",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init: c => {
        services = c.services;
      },
    });
    current = await createTestNextly({
      collections: [pages()],
      plugins: [
        seo({ collections: ["pages"], baseUrl: "https://x.com" }).plugin,
        probe,
      ],
    });

    await current.nextly.create({
      collection: "pages",
      data: { slug: "live", title: "Live", status: "published" },
    });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "wip", title: "WIP", status: "draft" },
    });

    const xml = await generateSitemap(services as SitemapServices, {
      collections: ["pages"],
      baseUrl: "https://x.com",
    });

    expect(xml).toContain("<loc>https://x.com/pages/live</loc>");
    expect(xml).not.toContain("/pages/wip");
  });
});
