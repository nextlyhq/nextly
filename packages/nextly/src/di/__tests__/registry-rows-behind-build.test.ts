/**
 * Which registry rows a production start finds behind the build: a declared
 * type with no row, or whose row lacks a declared field, read from the rows
 * as the start's `SELECT *` returns them (fields as JSON text on SQLite and
 * MySQL, as parsed JSON on PostgreSQL).
 */
import { describe, expect, it } from "vitest";

import {
  rowBehindBuildLine,
  rowsBehindBuild,
} from "../registry-rows-behind-build";

const posts = {
  kind: "collection" as const,
  slug: "posts",
  fields: [{ name: "title" }, { name: "seo" }],
};
const home = {
  kind: "single" as const,
  slug: "home",
  fields: [{ name: "headline" }],
};

describe("rowsBehindBuild", () => {
  it("names a row lacking a declared field, whether its fields are text or parsed", () => {
    for (const fields of [
      JSON.stringify([{ name: "title" }, { name: "slug" }]),
      [{ name: "title" }, { name: "slug" }],
    ]) {
      expect(
        rowsBehindBuild(
          [posts],
          new Map([["collection", [{ slug: "posts", fields }]]])
        )
      ).toEqual([
        {
          kind: "collection",
          slug: "posts",
          missingFields: ["seo"],
          row: "lacks-fields",
        },
      ]);
    }
  });

  it("names a declared type with no row, and nothing for a row holding every declared field", () => {
    expect(
      rowsBehindBuild(
        [posts, home],
        new Map<"collection" | "single", Record<string, unknown>[]>([
          [
            "collection",
            [
              {
                slug: "posts",
                fields: [{ name: "title" }, { name: "seo" }, { name: "slug" }],
              },
            ],
          ],
          ["single", []],
        ])
      )
    ).toEqual([
      { kind: "single", slug: "home", missingFields: [], row: "missing" },
    ]);
  });

  it("judges nothing of a kind whose rows were not read", () => {
    expect(rowsBehindBuild([posts, home], new Map())).toEqual([]);
  });
});

describe("rowBehindBuildLine", () => {
  it("names the row and says to run nextly migrate", () => {
    expect(
      rowBehindBuildLine({
        kind: "collection",
        slug: "posts",
        missingFields: ["seo", "og"],
        row: "lacks-fields",
      })
    ).toBe(
      'collection "posts": the build declares fields "seo", "og", which its registry row lacks. Run `nextly migrate` to bring the row up to date.'
    );
    expect(
      rowBehindBuildLine({
        kind: "single",
        slug: "home",
        missingFields: [],
        row: "missing",
      })
    ).toBe(
      'single "home": the build declares it, but it has no registry row. Run `nextly migrate` to write it.'
    );
  });
});
