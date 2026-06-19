/**
 * P7c — `seo({ collections })` adds its SEO fields to the target collections via
 * `contributes.extend` (D12). Proven end-to-end on a code-first collection: a
 * created entry carries the contributed `metaTitle`/`metaDescription` fields.
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { seo } from "../plugin";

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

describe("seo extend (P7c)", () => {
  it("adds metaTitle/metaDescription to the target collection", async () => {
    current = await createTestNextly({
      collections: [pages()],
      plugins: [
        seo({ collections: ["pages"], baseUrl: "https://example.com" }).plugin,
      ],
    });

    const created = await current.nextly.create({
      collection: "pages",
      data: {
        slug: "home",
        title: "Home",
        status: "published",
        metaTitle: "Home — Meta",
        metaDescription: "Welcome",
      },
    });

    const item = created.item as Record<string, unknown>;
    expect(item.metaTitle).toBe("Home — Meta");
    expect(item.metaDescription).toBe("Welcome");
  });
});
