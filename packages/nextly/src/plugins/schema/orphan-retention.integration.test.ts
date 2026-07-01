import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import type { CollectionRegistryService } from "../../domains/collections/services/collection-registry-service";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("orphan retention + detection", () => {
  it("flags a pipeline collection absent from the current config as orphaned, but retains it", async () => {
    const widgets = defineCollection({
      slug: "p2_orphan",
      fields: [text({ name: "title" })],
    });
    const plugin = definePlugin({
      name: "@t/orphan",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: { collections: [widgets] },
    });

    current = await createTestNextly({ plugins: [plugin] });
    const registry = current.getService(
      "collectionRegistryService"
    ) as CollectionRegistryService;

    // Simulate the plugin being removed: the current config no longer lists it.
    const orphans = await registry.findOrphanedCollections([]);
    expect(orphans.map(o => o.slug)).toContain("p2_orphan");

    // Retained — never auto-dropped.
    expect(await registry.getCollectionBySlug("p2_orphan")).not.toBeNull();
  });

  it("does NOT flag a collection that is still in the current config", async () => {
    const widgets = defineCollection({
      slug: "p2_kept",
      fields: [text({ name: "title" })],
    });
    const plugin = definePlugin({
      name: "@t/kept",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: { collections: [widgets] },
    });

    current = await createTestNextly({ plugins: [plugin] });
    const registry = current.getService(
      "collectionRegistryService"
    ) as CollectionRegistryService;

    const orphans = await registry.findOrphanedCollections(["p2_kept"]);
    expect(orphans.map(o => o.slug)).not.toContain("p2_kept");
  });
});
