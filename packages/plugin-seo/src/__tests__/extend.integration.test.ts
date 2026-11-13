/**
 * `seoPlugin({ collections })` adds its SEO field group to the named collections
 * via `contributes.extend`, proven end-to-end on a real code-first collection:
 * a created entry round-trips the nested `seo` fields, and the same collection
 * booted WITHOUT the plugin has no `seo` (so the plugin is what adds them).
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../plugin";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pages = () =>
  defineCollection({
    slug: "pages",
    fields: [text({ name: "slug" }), text({ name: "title" })],
  });

describe("seoPlugin extend (integration)", () => {
  it("adds the seo group so entries round-trip SEO data", async () => {
    current = await createTestNextly({
      collections: [pages()],
      plugins: [seoPlugin({ collections: ["pages"] })],
    });

    const created = await current.nextly.create({
      collection: "pages",
      data: {
        slug: "home",
        title: "Home",
        seo: {
          metaTitle: "Home — Meta",
          metaDescription: "Welcome to the site.",
          canonical: "https://example.com/",
          noindex: true,
        },
      },
    });

    const seo = (created.item as { seo?: Record<string, unknown> }).seo;
    expect(seo).toBeDefined();
    expect(seo?.metaTitle).toBe("Home — Meta");
    expect(seo?.metaDescription).toBe("Welcome to the site.");
    expect(seo?.canonical).toBe("https://example.com/");
    expect(seo?.noindex).toBe(true);

    // Read it back through the public API so persistence + serialization
    // (not just the write response) is covered.
    const id = (created.item as { id: string }).id;
    const fetched = await current.nextly.findByID({ collection: "pages", id });
    const persisted = (fetched as { seo?: Record<string, unknown> } | null)
      ?.seo;
    expect(persisted?.metaTitle).toBe("Home — Meta");
    expect(persisted?.metaDescription).toBe("Welcome to the site.");
    expect(persisted?.canonical).toBe("https://example.com/");
    expect(persisted?.noindex).toBe(true);
  });

  it("saves a title and description longer than Google shows", async () => {
    current = await createTestNextly({
      collections: [pages()],
      plugins: [seoPlugin({ collections: ["pages"] })],
    });
    // rext.ai's longest live title (83 characters) and a 190-character
    // description: search engines cut them by width, they never refuse them.
    const title =
      "Best AI SEO tools for small businesses: from keywords to published content | Rext AI";
    const description = `${"A description longer than Google shows. ".repeat(4)}It runs on.`;
    expect(title.length).toBeGreaterThan(60);
    expect(description.length).toBeGreaterThan(160);

    const created = await current.nextly.create({
      collection: "pages",
      data: {
        slug: "long",
        title: "Long",
        seo: { metaTitle: title, metaDescription: description },
      },
    });

    const seo = (created.item as { seo?: Record<string, unknown> }).seo;
    expect(seo?.metaTitle).toBe(title);
    expect(seo?.metaDescription).toBe(description);
  });

  it("refuses a longer title where the site asks for hard limits", async () => {
    current = await createTestNextly({
      collections: [pages()],
      plugins: [seoPlugin({ collections: ["pages"], hardLengthLimits: true })],
    });

    await expect(
      current.nextly.create({
        collection: "pages",
        data: {
          slug: "long",
          title: "Long",
          seo: { metaTitle: "x".repeat(61) },
        },
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does not add seo when the plugin is absent (proves the plugin adds it)", async () => {
    current = await createTestNextly({ collections: [pages()] });

    // Without the plugin the collection has no `seo` column, so the same write
    // that succeeds above is rejected here — proof the plugin is what adds it.
    //
    // What rejects it is the database refusing an unknown column, so the text
    // naming `seo` is the driver's own. That text is withheld from the caller
    // and reported to the operator instead, which is where this reads it from:
    // asserting it on the public message would be asserting that raw driver
    // output reaches a caller.
    await expect(
      current.nextly.create({
        collection: "pages",
        data: { slug: "home", title: "Home", seo: { metaTitle: "ignored" } },
      })
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: { legacyMessage: expect.stringMatching(/seo/i) },
    });
  });
});
