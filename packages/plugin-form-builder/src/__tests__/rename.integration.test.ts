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
  it("renames the submissions collection; table + in-transaction handlers follow via ctx.self", async () => {
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

    // init() resolved the submissions slug via ctx.self, so the handlers
    // that queue its notifications and hold its form run inside writes to
    // the RENAMED slug, and none on the declared one: it has only the '*'
    // handlers every collection has, which the comparison discounts.
    const runners = (slug: string) =>
      current!.hooks.inTransactionRunners(slug).length;
    expect(runners("leads")).toBeGreaterThan(runners("not-a-collection"));
    expect(runners("form-submissions")).toBe(runners("not-a-collection"));
  });
});
