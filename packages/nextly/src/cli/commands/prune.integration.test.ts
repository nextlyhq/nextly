import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import type { CollectionRegistryService } from "../../domains/collections/services/collection-registry-service";
import { definePlugin } from "../../plugins/plugin-context";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

import { runPrune } from "./prune";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const bootWithPluginCollection = async (slug: string) => {
  const plugin = definePlugin({
    name: "@t/prune",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      collections: [defineCollection({ slug, fields: [text({ name: "v" })] })],
    },
  });
  current = await createTestNextly({ plugins: [plugin] });
  return current.getService(
    "collectionRegistryService"
  ) as CollectionRegistryService;
};

describe("nextly prune (D14)", () => {
  it("dry-run lists orphans and drops nothing", async () => {
    const registry = await bootWithPluginCollection("p2_prune_dry");

    const result = await runPrune({
      registry,
      adapter: current!.adapter,
      currentSlugs: [], // plugin removed → its collection is orphaned
      force: false,
    });

    expect(result.orphans).toContain("p2_prune_dry");
    expect(result.dropped).toEqual([]);
    // Retained — dry-run never drops.
    expect(await registry.getCollectionBySlug("p2_prune_dry")).not.toBeNull();
  });

  it("--force drops the orphaned collection (metadata + physical table)", async () => {
    const registry = await bootWithPluginCollection("p2_prune_force");

    const result = await runPrune({
      registry,
      adapter: current!.adapter,
      currentSlugs: [],
      force: true,
    });

    expect(result.dropped).toContain("p2_prune_force");
    expect(await registry.getCollectionBySlug("p2_prune_force")).toBeNull();
  });
});
