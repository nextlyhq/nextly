import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../collections/config/define-collection";
import { text } from "../../collections/fields";
import { createTestNextly } from "../test-nextly";

// The auto-injected `slug` column is required + unique. Create derives it from
// the title before validation (WordPress/Ghost convention), deduping repeats.
describe("slug auto-generation on create", () => {
  let current: Awaited<ReturnType<typeof createTestNextly>> | undefined;

  afterEach(async () => {
    await current?.destroy();
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

  it("keeps an explicit slug verbatim instead of auto-incrementing it", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: [text({ name: "title" })],
    });
    current = await createTestNextly({ collections: [posts] });

    await current.nextly.create({
      collection: "posts",
      data: { title: "First", slug: "shared" },
    });
    const second = await current.nextly.create({
      collection: "posts",
      data: { title: "Second", slug: "shared" },
    });

    // Isolates the app-level slug decision: a generated slug would dedupe to
    // "shared-2", but an explicit slug bypasses that path and is kept verbatim.
    // Enforcing uniqueness on a duplicate is the DB unique index's job (the
    // production backstop), which surfaces the conflict there rather than
    // silently renaming the caller's canonical URL. This in-memory harness does
    // not enforce that index, so the assertion here checks only the no-dedupe
    // guarantee — never that a duplicate is accepted.
    expect((second.item as { slug?: string }).slug).toBe("shared");
    expect((second.item as { slug?: string }).slug).not.toBe("shared-2");
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

  it("falls back to a generated token when the title has no slug-safe characters", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: [text({ name: "title" })],
    });
    current = await createTestNextly({ collections: [posts] });

    // generateSlug strips everything outside [\w-], so a CJK/emoji/punctuation
    // -only title sanitizes to an empty base. The required, unique slug must
    // still be populated via the `entry-<ts>-<rand>` fallback instead of "".
    const created = await current.nextly.create({
      collection: "posts",
      data: { title: "你好世界" },
    });

    const slug = (created.item as { slug?: string }).slug;
    expect(slug).toBeTruthy();
    expect(slug).toMatch(/^entry-/);
  });

  it("re-sanitizes a slug set by a field beforeValidate hook", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: [
        text({ name: "title" }),
        text({
          name: "slug",
          unique: true,
          // A field hook runs after slug generation and can set an unsanitized
          // value; the create path must normalize it before storing.
          hooks: { beforeValidate: [() => "Hooked Slug Value"] },
        }),
      ],
    });
    current = await createTestNextly({ collections: [posts] });

    const created = await current.nextly.create({
      collection: "posts",
      data: { title: "Ignored" },
    });

    expect((created.item as { slug?: string }).slug).toBe("hooked-slug-value");
  });

  it("does not store a beforeValidate hook slug that sanitizes to empty", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: [
        text({ name: "title" }),
        text({
          name: "slug",
          unique: true,
          // A hook returning a CJK/emoji-only value sanitizes to "". It must be
          // replaced with a derived slug, never stored verbatim.
          hooks: { beforeValidate: [() => "你好世界"] },
        }),
      ],
    });
    current = await createTestNextly({ collections: [posts] });

    const created = await current.nextly.create({
      collection: "posts",
      data: { title: "Readable Title" },
    });

    // Derived from the title, not the un-sanitizable hook value.
    expect((created.item as { slug?: string }).slug).toBe("readable-title");
  });

  it("re-sanitizes a slug set by a field beforeChange hook", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: [
        text({ name: "title" }),
        text({
          name: "slug",
          unique: true,
          // A beforeChange hook runs after validation, right before storage;
          // its value must still be normalized.
          hooks: { beforeChange: [() => "Changed By Hook"] },
        }),
      ],
    });
    current = await createTestNextly({ collections: [posts] });

    const created = await current.nextly.create({
      collection: "posts",
      data: { title: "Ignored" },
    });

    expect((created.item as { slug?: string }).slug).toBe("changed-by-hook");
  });
});
