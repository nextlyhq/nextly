/**
 * Which registry rows describe an entity removed from code.
 *
 * Only a row whose source is the app's code, or for a Single a plugin, for a slug
 * the configuration does not declare. A Builder row absent from the
 * configuration is not removed from code, since the Builder's entities never
 * appear there, and nor is a plugin's collection.
 */
import { describe, expect, it } from "vitest";

import {
  declaredSlugsOf,
  isRemovedFromCode,
  withoutRemovedFromCode,
} from "./removed-from-code";

describe.each(["collection", "single"] as const)(
  "isRemovedFromCode of a %s",
  kind => {
    const declared = new Set(["posts"]);

    it("is true for a code row the configuration no longer declares", () => {
      expect(
        isRemovedFromCode(kind, { slug: "pages", source: "code" }, declared)
      ).toBe(true);
    });

    it.each(["code", "plugin:acme-seo"])(
      "is false for a %s row the configuration declares",
      source => {
        expect(
          isRemovedFromCode(kind, { slug: "posts", source }, declared)
        ).toBe(false);
      }
    );

    it.each([
      ["a Schema Builder row", "ui"],
      ["a built-in row", "built-in"],
      ["a row that records no source", undefined],
    ])("is false for %s absent from the configuration", (_label, source) => {
      expect(isRemovedFromCode(kind, { slug: "pages", source }, declared)).toBe(
        false
      );
    });

    it("is for a departed plugin's row true of a Single and false of a collection", () => {
      expect(
        isRemovedFromCode(
          kind,
          { slug: "pages", source: "plugin:acme-seo" },
          declared
        )
      ).toBe(kind === "single");
    });

    it("is false for a row without a slug", () => {
      expect(isRemovedFromCode(kind, { source: "code" }, declared)).toBe(false);
    });
  }
);

describe("withoutRemovedFromCode", () => {
  it("keeps every row but one removed from code, in order", () => {
    const rows = [
      { slug: "pages", source: "code", tableName: "dc_pages" },
      { slug: "posts", source: "code", tableName: "dc_posts" },
      { slug: "drafts", source: "ui", tableName: "dc_drafts" },
      { slug: "shop", source: "plugin:acme-shop", tableName: "dc_shop" },
    ];
    expect(
      withoutRemovedFromCode("collection", rows, new Set(["posts"]))
    ).toEqual([rows[1], rows[2], rows[3]]);
    expect(withoutRemovedFromCode("single", rows, new Set(["posts"]))).toEqual([
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
