import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("framework remap .rename()", () => {
  it("renames a collection end-to-end: table under the new slug, ctx.self resolves, hook fires on the renamed slug", async () => {
    const fired: string[] = [];
    const plugin = definePlugin({
      name: "@t/remap",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        collections: [
          defineCollection({
            slug: "widgets",
            fields: [text({ name: "title" })],
          }),
        ],
      },
      init(ctx) {
        // Reference the OWN entity via ctx.self (declared key → resolved slug).
        const slug = ctx.self.collections.widgets; // → "gadgets" after rename
        ctx.hooks.on("afterCreate", slug, () => {
          fired.push(slug);
        });
      },
    });

    current = await createTestNextly({
      plugins: [plugin.rename!({ widgets: "gadgets" })],
    });

    // Table exists under the RENAMED slug + CRUD works.
    const created = await current.nextly.create({
      collection: "gadgets",
      data: { title: "x" },
    });
    expect((created.item as { id: string }).id).toBeTruthy();

    // The hook (registered via ctx.self) fired on the renamed slug.
    expect(fired).toEqual(["gadgets"]);

    // The renamed entity is registered; the declared slug is not.
    const registry = current.getService("collectionRegistryService");
    expect(await registry.getCollectionBySlug("gadgets")).not.toBeNull();
    expect(await registry.getCollectionBySlug("widgets")).toBeNull();
  });

  it("renaming into an existing slug fails fast (slug collision)", async () => {
    const plugin = definePlugin({
      name: "@t/remap-collide",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        collections: [
          defineCollection({ slug: "widgets", fields: [text({ name: "t" })] }),
        ],
      },
    });

    await expect(
      createTestNextly({
        collections: [
          defineCollection({ slug: "gadgets", fields: [text({ name: "n" })] }),
        ],
        plugins: [plugin.rename!({ widgets: "gadgets" })],
      })
    ).rejects.toThrow(/Schema configuration is invalid/i);
  });
});
