import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../collections/config/define-collection";
import { text } from "../../collections/fields";
import { createTestNextly } from "../test-nextly";

// The auto-injected `slug` column is required + unique. Create derives it from
// the title before validation (WordPress/Ghost convention), deduping repeats.
describe("slug auto-generation on create", () => {
  let current: Awaited<ReturnType<typeof createTestNextly>> | undefined;

  afterEach(async () => {
    await current?.teardown?.();
    current = undefined;
  });

  it("derives the slug from the title when none is provided", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: [text({ name: "title" })],
    });
    current = await createTestNextly({ collections: [posts] });

    const created = await current.nextly.create({
      collection: "posts",
      data: { title: "Hello World" },
    });

    expect((created.item as { slug?: string }).slug).toBe("hello-world");
  });

  it("dedupes a repeated title (hello-world, hello-world-2)", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: [text({ name: "title" })],
    });
    current = await createTestNextly({ collections: [posts] });

    const first = await current.nextly.create({
      collection: "posts",
      data: { title: "Hello World" },
    });
    const second = await current.nextly.create({
      collection: "posts",
      data: { title: "Hello World" },
    });

    expect((first.item as { slug?: string }).slug).toBe("hello-world");
    expect((second.item as { slug?: string }).slug).toBe("hello-world-2");
  });

  it("keeps and sanitizes an explicitly provided slug", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: [text({ name: "title" })],
    });
    current = await createTestNextly({ collections: [posts] });

    const created = await current.nextly.create({
      collection: "posts",
      data: { title: "Third", slug: "Custom Slug" },
    });

    expect((created.item as { slug?: string }).slug).toBe("custom-slug");
  });
});
