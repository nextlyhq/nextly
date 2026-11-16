/**
 * The Lighthouse fixture is written whatever the page holds: a fixture never
 * read the page it replaces, so its write says so with `_overwrite` rather
 * than sending no version at all.
 */
import { describe, expect, it } from "vitest";

import { authoringBody } from "./author-dogfood-page.mjs";

describe("authoring the dogfood page", () => {
  it("writes the document into its field as an overwrite", () => {
    const document = { formatVersion: 1, nodes: [] };
    expect(authoringBody("layout", document)).toEqual({
      layout: document,
      _overwrite: true,
    });
  });
});
