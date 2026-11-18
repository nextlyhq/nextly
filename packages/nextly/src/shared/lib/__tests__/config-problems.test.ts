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
