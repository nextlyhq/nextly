import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("form-builder framework .rename()", () => {
  it("renames the submissions collection; table + afterCreate hook follow via ctx.self", async () => {
    const { plugin } = formBuilder();

    current = await createTestNextly({
      plugins: [plugin.rename!({ "form-submissions": "leads" })],
    });

    const registry = current.getService("collectionRegistryService");

    // The renamed collection is registered; the declared slug is gone.
    expect(await registry.getCollectionBySlug("leads")).not.toBeNull();
    expect(await registry.getCollectionBySlug("form-submissions")).toBeNull();
    // The unrenamed forms collection is still present.
    expect(await registry.getCollectionBySlug("forms")).not.toBeNull();

    // init() resolved the submissions slug via ctx.self, so the afterCreate
    // hook is registered on the RENAMED slug — proving the canonical pattern.
    // Use getHookCount (specific-slug only) rather than hasHooks: the harness
    // now registers a global `afterCreate` "*" activity-log hook (matching
    // production), which hasHooks would conflate with a per-slug hook.
    expect(current.hooks.getHookCount("afterCreate", "leads")).toBeGreaterThan(
      0
    );
    expect(current.hooks.getHookCount("afterCreate", "form-submissions")).toBe(
      0
    );
  });
});
