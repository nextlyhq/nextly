/**
 * The `define*` functions record a problem rather than throw at import, so a configuration with
 * problems in several entities reaches the one check that names them all.
 */
import { describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { setupTransformerInput } from "../../../plugins/plugin-consent";
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

describe("a collection defineCollection finds a problem in", () => {
  // It is normalized all the same: a plugin's setup may repair the problem, and the collection
  // it leaves must be the one an equivalent valid declaration gives, system fields and all.
  it("is returned normalized, with its system fields", () => {
    const declared = defineCollection({ slug: "notes", fields: [] });

    expect(
      declared.fields.map(field => (field as { name?: string }).name)
    ).toEqual(["title", "slug"]);
    expect(declared.labels).toMatchObject({ singular: "Notes" });
  });
});

describe("an entity declared with no fields, through its define function", () => {
  // The system fields its function adds are not the author's: judged without them, a collection
  // breaks the rule that it declare a field, as it did when `defineCollection` threw.
  it("is reported for a collection, its system fields still added", () => {
    const declared = {
      collections: [defineCollection({ slug: "notes", fields: [] })],
    };

    expect(configurationProblems(declared)).toContainEqual(
      expect.objectContaining({
        path: "collections[0].fields",
        code: "FIELDS_EMPTY",
      })
    );
    expect(
      declared.collections[0].fields.map(
        field => (field as { name?: string }).name
      )
    ).toEqual(["title", "slug"]);
  });

  // A Single may declare no fields of its own (its rules never refused one, and `defineSingle`
  // never threw on it), so judging it without its system fields finds nothing.
  it("is accepted for a Single, as it always was", () => {
    const declared = {
      singles: [defineSingle({ slug: "home", fields: [] })],
    };

    expect(configurationProblems(declared)).toEqual([]);
    expect(
      declared.singles[0].fields.map(field => (field as { name?: string }).name)
    ).toEqual(["title", "slug"]);
  });

  it("is not reported once a plugin's setup gives it a field", () => {
    const declared = {
      collections: [defineCollection({ slug: "notes", fields: [] })],
    };
    const [notes] = declared.collections;
    const effective = {
      collections: [
        { ...notes, fields: [...notes.fields, { name: "body", type: "text" }] },
      ],
    };

    expect(configurationProblems(declared, effective)).toEqual([]);
  });
});

describe("an app's entity a plugin's setup renamed", () => {
  // Followed from the copy a setup is handed to the entity it returns, rather than by its slug,
  // which the setup may change: the renamed entity is the one the commands use.
  it("is judged as the setup left it, at the place the app declared it", () => {
    const declared = {
      collections: [
        { slug: "Blog Posts", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const handed = setupTransformerInput(declared, []);
    const effective = {
      collections: handed.collections.map(entity => ({
        ...entity,
        slug: "blog-posts",
      })),
    };

    expect(
      configurationProblems(declared).map(problem => problem.path)
    ).toEqual(["collections[0].slug"]);
    expect(configurationProblems(declared, effective)).toEqual([]);
  });
});

describe("a field with no type", () => {
  // The entity's own rules name it (`FIELD_TYPE_REQUIRED`); the field-type check, which asks only
  // whether something offers a type that was given, leaves it to them, so it is counted once.
  it.each([
    ["no type", { name: "score" }],
    ["an empty type", { name: "score", type: "" }],
  ])("with %s is reported once", (_, field) => {
    const problems = configurationProblems({
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }, field] },
      ],
    });

    expect(problems.map(problem => `${problem.path} ${problem.code}`)).toEqual([
      "collections[0].fields[1].type FIELD_TYPE_REQUIRED",
    ]);
  });
});
