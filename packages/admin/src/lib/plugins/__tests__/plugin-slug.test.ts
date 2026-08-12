import { describe, expect, it } from "vitest";

import { pluginSlug } from "../plugin-slug";

/**
 * The contract shared with `pluginAdminSlug` in core, which derives the same
 * slug server-side. The two cannot import one another, so this table is the
 * only thing that fails when either side drifts. Changing a row here without
 * changing core is the mistake it exists to catch.
 */
const CASES: Array<[string, string]> = [
  ["@acme/p", "acme-p"],
  ["@nextlyhq/plugin-page-builder", "nextlyhq-plugin-page-builder"],
  ["style-fixture", "style-fixture"],
  ["Weird__Name!!", "weird-name"],
  ["--leading-and-trailing--", "leading-and-trailing"],
  ["Form Builder", "form-builder"],
];

describe("pluginSlug", () => {
  it.each(CASES)("derives %s to %s", (input, expected) => {
    expect(pluginSlug(input)).toBe(expected);
  });

  it("is idempotent, so a slug fed back in is unchanged", () => {
    for (const [, expected] of CASES) {
      expect(pluginSlug(expected)).toBe(expected);
    }
  });
});
