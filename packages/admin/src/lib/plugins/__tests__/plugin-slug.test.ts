import { describe, expect, it } from "vitest";

import { pluginSlug } from "../plugin-slug";

/**
 * `pluginSlug` re-exports core's `pluginAdminSlug`, so these cases run against
 * the same implementation the server uses to namespace plugin admin routes and
 * to look up host `pluginOverrides`. There is nothing left to drift: a change
 * to core's derivation fails here, and there is no admin-side copy that could
 * be changed without failing here.
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
