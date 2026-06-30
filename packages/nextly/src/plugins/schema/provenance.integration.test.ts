import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("entity provenance", () => {
  it("tags a plugin-contributed collection source=plugin:<name> and keeps it locked", async () => {
    const widgets = defineCollection({
      slug: "p2_prov_plugin",
      fields: [text({ name: "title" })],
    });
    const plugin = definePlugin({
      name: "@t/prov",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: { collections: [widgets] },
    });

    current = await createTestNextly({ plugins: [plugin] });

    const record = (await current
      .getService("collectionRegistryService")
      .getCollectionBySlug("p2_prov_plugin")) as {
      source?: string;
      locked?: boolean | number;
    } | null;

    expect(record?.source).toBe("plugin:@t/prov");
    // Plugin collections are pipeline-managed → locked (not UI-editable).
    expect(Boolean(record?.locked)).toBe(true);
  });

  it("keeps a code-first collection source=code", async () => {
    const posts = defineCollection({
      slug: "p2_prov_code",
      fields: [text({ name: "title" })],
    });

    current = await createTestNextly({ collections: [posts] });

    const record = (await current
      .getService("collectionRegistryService")
      .getCollectionBySlug("p2_prov_code")) as { source?: string } | null;

    expect(record?.source).toBe("code");
  });
});
