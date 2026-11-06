/**
 * Which stored fields are many-to-many relationships with a junction table:
 * the ones a rename has to refuse over.
 */
import { describe, expect, it } from "vitest";

import { manyToManyLinks } from "../many-to-many-links";

const manyToMany = (name: string, target: string) => ({
  name,
  type: "relationship",
  options: { relationType: "manyToMany", target },
});

describe("manyToManyLinks", () => {
  it("lists a top-level many-to-many field with its collection and target", () => {
    expect(
      manyToManyLinks([{ slug: "posts", fields: [manyToMany("tags", "tags")] }])
    ).toEqual([{ collection: "posts", field: "tags", target: "tags" }]);
  });

  it("reads fields stored as JSON text, as SQLite returns them", () => {
    expect(
      manyToManyLinks([
        {
          slug: "posts",
          fields: JSON.stringify([manyToMany("tags", "tags")]),
        },
      ])
    ).toEqual([{ collection: "posts", field: "tags", target: "tags" }]);
  });

  it("leaves out relationships that have no junction table", () => {
    expect(
      manyToManyLinks([
        {
          slug: "posts",
          fields: [
            // One-to-many and many-to-one keep their ids on a row.
            {
              name: "author",
              type: "relationship",
              options: { relationType: "manyToOne", target: "users" },
            },
            // An upload never gets a junction, whatever its options say.
            {
              name: "cover",
              type: "upload",
              options: { relationType: "manyToMany", target: "media" },
            },
            // A many-to-many with no target creates no junction table.
            {
              name: "loose",
              type: "relationship",
              options: { relationType: "manyToMany" },
            },
            // Nested in a group, its ids live in the group's JSON.
            {
              name: "meta",
              type: "group",
              fields: [manyToMany("tags", "tags")],
            },
          ],
        },
      ])
    ).toEqual([]);
  });

  it("reads nothing from a row with no slug or no fields", () => {
    expect(
      manyToManyLinks([
        { slug: null, fields: [manyToMany("tags", "tags")] },
        { slug: "notes", fields: null },
      ])
    ).toEqual([]);
  });

  it("throws on fields it cannot read, rather than reading them as none", () => {
    expect(() =>
      manyToManyLinks([{ slug: "posts", fields: "{not json" }])
    ).toThrow(SyntaxError);
  });
});
