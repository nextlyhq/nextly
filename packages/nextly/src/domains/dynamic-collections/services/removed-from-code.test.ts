/**
 * Which registry rows describe an entity removed from code.
 *
 * Only a row whose source is the app's code, for a slug the configuration does
 * not declare. A Builder or plugin row absent from the configuration is not
 * removed from code: the Builder's entities never appear there, and a plugin's
 * are retired by uninstalling it.
 */
import { describe, expect, it } from "vitest";

import {
  declaredSlugsOf,
  isRemovedFromCode,
  withoutRemovedFromCode,
} from "./removed-from-code";

describe("isRemovedFromCode", () => {
  const declared = new Set(["posts"]);

  it("is true for a code row the configuration no longer declares", () => {
    expect(isRemovedFromCode({ slug: "pages", source: "code" }, declared)).toBe(
      true
    );
  });

  it("is false for a code row the configuration declares", () => {
    expect(isRemovedFromCode({ slug: "posts", source: "code" }, declared)).toBe(
      false
    );
  });

  it.each([
    ["a Schema Builder row", "ui"],
    ["a plugin's row", "plugin:acme-seo"],
    ["a built-in row", "built-in"],
    ["a row that records no source", undefined],
  ])("is false for %s absent from the configuration", (_label, source) => {
    expect(isRemovedFromCode({ slug: "pages", source }, declared)).toBe(false);
  });

  it("is false for a row without a slug", () => {
    expect(isRemovedFromCode({ source: "code" }, declared)).toBe(false);
  });
});

describe("withoutRemovedFromCode", () => {
  it("keeps every row but one removed from code, in order", () => {
    const rows = [
      { slug: "pages", source: "code", tableName: "dc_pages" },
      { slug: "posts", source: "code", tableName: "dc_posts" },
      { slug: "drafts", source: "ui", tableName: "dc_drafts" },
    ];
    expect(withoutRemovedFromCode(rows, new Set(["posts"]))).toEqual([
      rows[1],
      rows[2],
    ]);
  });
});

describe("declaredSlugsOf", () => {
  it("collects every slug the entities name, skipping an entry without one", () => {
    expect(
      [
        ...declaredSlugsOf([
          { slug: "posts" },
          {},
          { slug: "" },
          { slug: "tags" },
        ]),
      ].sort()
    ).toEqual(["posts", "tags"]);
  });

  it("is empty for a configuration that declares none", () => {
    expect(declaredSlugsOf(undefined).size).toBe(0);
  });
});
