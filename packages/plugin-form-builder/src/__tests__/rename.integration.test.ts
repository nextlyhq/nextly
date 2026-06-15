import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

let current: TestNextly | undefined;

beforeEach(() => {
  // Clear form-builder's dev-mode duplicate-hook guard for both slugs.
  const g = globalThis as Record<string, unknown>;
  delete g["__formBuilder_afterCreate_leads"];
  delete g["__formBuilder_afterCreate_form-submissions"];
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("form-builder framework .rename() (D54 / R4)", () => {
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
    expect(current.hooks.hasHooks("afterCreate", "leads")).toBe(true);
    expect(current.hooks.hasHooks("afterCreate", "form-submissions")).toBe(
      false
    );
  });
});
