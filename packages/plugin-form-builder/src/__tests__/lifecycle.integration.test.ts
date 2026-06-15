import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

let current: TestNextly | undefined;

beforeEach(() => {
  // form-builder's init guards against duplicate hook registration in dev mode
  // via a globalThis flag; clear it so each boot re-registers the hook.
  delete (globalThis as Record<string, unknown>)[
    "__formBuilder_afterCreate_form-submissions"
  ];
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("form-builder on the reshaped PluginContext (R4 / D46)", () => {
  it("boots via contributes.collections — registers its collections + afterCreate hook", async () => {
    const { plugin, collections } = formBuilder();

    // Booting with ONLY the plugin (no opts.collections) proves the P2 fold
    // routes contributes.collections through the merged pipeline. init() reads
    // ctx.logger/ctx.hooks, so a clean boot also proves the reshaped context.
    current = await createTestNextly({ plugins: [plugin] });

    // Both contributed collections are registered via the fold (R4 proof).
    const registry = current.getService("collectionRegistryService");
    for (const col of collections) {
      expect(await registry.getCollectionBySlug(col.slug)).not.toBeNull();
    }

    expect(current.hooks.hasHooks("afterCreate", "form-submissions")).toBe(
      true
    );
  });
});
