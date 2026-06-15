import { afterEach, describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

const widgetsCollection = {
  slug: "p2-widgets",
  fields: [{ name: "title", type: "text" }],
} as unknown as CollectionConfig;

const widgetsPlugin: PluginDefinition = {
  name: "@test/widgets",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: { collections: [widgetsCollection] },
};

describe("plugin contributes.collections — runtime fold (D3/D50)", () => {
  let handle: TestNextly | undefined;

  afterEach(async () => {
    await handle?.destroy();
    handle = undefined;
  });

  it("registers a plugin's contributes collection in the collection registry at boot", async () => {
    handle = await createTestNextly({ plugins: [widgetsPlugin] });

    const registry = handle.getService("collectionRegistryService");
    const record = await registry.getCollectionBySlug("p2-widgets");

    expect(record).not.toBeNull();
    expect(record?.slug).toBe("p2-widgets");
  });
});
