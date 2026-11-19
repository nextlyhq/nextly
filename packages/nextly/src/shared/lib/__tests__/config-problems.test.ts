/**
 * The `define*` functions record a problem rather than throw at import, so a configuration with
 * problems in several entities reaches the one check that names them all.
 */
import { describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { defineSingle } from "../../../singles/config/define-single";
import { configurationProblems } from "../config-problems";

describe("a bad Single and a bad collection, each through its define function", () => {
  it("are both reported, neither stopping the import", () => {
    const declare = () => ({
      collections: [
        defineCollection({
          slug: "Blog Posts",
          fields: [{ name: "title", type: "text" }],
        }),
      ],
      singles: [
        defineSingle({
          slug: "home page",
          fields: [{ name: "heading", type: "text" }],
        }),
      ],
    });

    expect(declare).not.toThrow();
    const problems = configurationProblems(declare());
    expect(problems.map(problem => problem.path)).toEqual([
      "collections[0].slug",
      "singles[0].slug",
    ]);
    expect(problems.map(problem => problem.code)).toEqual([
      "SLUG_INVALID_FORMAT",
      "SLUG_INVALID_FORMAT",
    ]);
  });
});

describe("a relationship to a collection Nextly provides", () => {
  // `users` and `media` are relationship targets without the configuration declaring them; a
  // relationship's target is judged with every target known (the plugins' and the Schema
  // Builder's too) where the load and the start resolve them, not here.
  it("is no problem", () => {
    expect(
      configurationProblems({
        collections: [
          {
            slug: "posts",
            fields: [
              { name: "author", type: "relationship", relationTo: "users" },
              { name: "cover", type: "upload", relationTo: "media" },
            ],
          },
        ],
      })
    ).toEqual([]);
  });
});

describe("an app's entity a plugin's setup changed", () => {
  // The entity is judged as the commands will use it, after the plugins' setups, and placed
  // where the app declared it.
  it("is judged in its changed form, at the place the app declared it", () => {
    const declared = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const effective = {
      collections: [
        {
          slug: "notes",
          fields: [
            { name: "body", type: "text" },
            { name: "body", type: "text" },
          ],
        },
      ],
    };

    expect(configurationProblems(declared)).toEqual([]);
    expect(
      configurationProblems(declared, effective).map(problem => problem.path)
    ).toEqual(["collections[0].fields"]);
  });
});
