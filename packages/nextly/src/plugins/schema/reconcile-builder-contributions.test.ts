import { describe, expect, it } from "vitest";

import { tagPluginFields } from "./reconcile-builder-contributions";

describe("tagPluginFields", () => {
  it("stamps source/owner/locked on each field, non-mutating", () => {
    const input = [{ name: "meta_title", type: "text" }];
    const out = tagPluginFields(input as never, "@acme/seo");
    expect(out[0]).toMatchObject({
      name: "meta_title",
      source: "plugin",
      owner: "@acme/seo",
      locked: true,
    });
    // input untouched
    expect((input[0] as Record<string, unknown>).source).toBeUndefined();
  });
});
