/**
 * The sitemap route serves published content as XML over the catch-all, proven
 * end-to-end against a real boot: a published entry appears, a draft and a
 * `noindex` entry do not, and publishing a draft makes it appear on the next
 * read. Drives the real `contributes.routes` handler through
 * `createDynamicHandlers` — the same path production serves.
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../plugin";

// Segments after `/api/`, matching how the catch-all splits the path. The
// plugin name `@nextlyhq/plugin-seo` is two segments (it contains a slash).
const SITEMAP_PARAMS = ["plugins", "@nextlyhq", "plugin-seo", "sitemap.xml"];

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

async function fetchSitemap(): Promise<{ status: number; body: string }> {
  const handlers = createDynamicHandlers();
  const res = await handlers.GET(
    new Request(
      "http://localhost/api/plugins/@nextlyhq/plugin-seo/sitemap.xml"
    ),
    { params: Promise.resolve({ params: SITEMAP_PARAMS }) }
  );
  return { status: res.status, body: await res.text() };
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
    current = await createTestNextly({
      collections: [pages()],
      plugins: [
        seoPlugin({ collections: ["pages"], baseUrl: "https://x.com" }),
      ],
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
    expect(body).toContain("<loc>https://x.com/pages/published</loc>");
    // A draft is not public, and a noindexed page must not be advertised.
    expect(body).not.toContain("/pages/draft");
    expect(body).not.toContain("/pages/hidden");
  });

  it("reflects a newly published entry on the next read", async () => {
    current = await createTestNextly({
      collections: [pages()],
      plugins: [
        seoPlugin({ collections: ["pages"], baseUrl: "https://x.com" }),
      ],
    });

    const created = await current.nextly.create({
      collection: "pages",
      data: { slug: "later", title: "L", status: "draft" },
    });
    const id = (created.item as { id: string }).id;

    // Not yet published: absent from the sitemap.
    expect((await fetchSitemap()).body).not.toContain("/pages/later");

    await current.nextly.update({
      collection: "pages",
      id,
      data: { status: "published" },
    });

    // Published now: present on the next read (the published filter responds to
    // the transition; F1 busts the tagged read in a Next runtime).
    expect((await fetchSitemap()).body).toContain(
      "<loc>https://x.com/pages/later</loc>"
    );
  });

  it("derives the origin from the request when baseUrl is not configured", async () => {
    current = await createTestNextly({
      collections: [pages()],
      plugins: [seoPlugin({ collections: ["pages"] })],
    });

    await current.nextly.create({
      collection: "pages",
      data: { slug: "home", title: "H", status: "published" },
    });

    const { body } = await fetchSitemap();
    expect(body).toContain("<loc>http://localhost/pages/home</loc>");
  });
});
