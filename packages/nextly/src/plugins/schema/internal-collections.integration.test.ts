import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("internal:true plugin collections (D30)", () => {
  it("is queryable via services but marked hidden from the admin nav", async () => {
    const secrets = defineCollection({
      slug: "p2_secrets",
      fields: [text({ name: "value" })],
      internal: true,
    });
    const plugin = definePlugin({
      name: "@t/internal",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: { collections: [secrets] },
    });

    current = await createTestNextly({ plugins: [plugin] });

    // Accessible via services (internal does NOT remove it from the schema —
    // it is also a valid relationTo target, since it is in the merged slug set).
    const created = await current.nextly.create({
      collection: "p2_secrets",
      data: { value: "x" },
    });
    expect((created.item as { id: string }).id).toBeTruthy();

    // Hidden from the content-admin nav: surfaced as admin.hidden in metadata.
    const registry = current.getService("collectionRegistryService");
    const record = await registry.getCollectionBySlug("p2_secrets");
    expect(
      (record as { admin?: { hidden?: boolean } } | null)?.admin?.hidden
    ).toBe(true);
  });
});
