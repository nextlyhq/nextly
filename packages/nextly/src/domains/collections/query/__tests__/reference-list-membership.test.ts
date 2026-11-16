import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  holdsReferenceList,
  referenceListCondition,
  referenceListFields,
} from "../reference-list-membership";

// Only a list of one collection's ids kept in the field's own column is matched by membership:
// one naming several collections keeps objects, and a many-to-many keeps no column.
describe("holdsReferenceList", () => {
  it("is a has-many relationship or upload naming one collection", () => {
    expect(
      holdsReferenceList({
        name: "tags",
        type: "relationship",
        hasMany: true,
        relationTo: "tags",
      })
    ).toBe(true);
    expect(
      holdsReferenceList({
        name: "gallery",
        type: "upload",
        hasMany: true,
        relationTo: "media",
      })
    ).toBe(true);
  });

  it("is not a single relationship, one naming several collections, a many-to-many or a has-many text", () => {
    expect(
      holdsReferenceList({
        name: "author",
        type: "relationship",
        relationTo: "users",
      })
    ).toBe(false);
    expect(
      holdsReferenceList({
        name: "links",
        type: "relationship",
        hasMany: true,
        relationTo: ["posts", "pages"],
      })
    ).toBe(false);
    expect(
      holdsReferenceList({
        name: "related",
        type: "relationship",
        hasMany: true,
        relationTo: "posts",
        options: { relationType: "manyToMany" },
      })
    ).toBe(false);
    expect(
      holdsReferenceList({ name: "keywords", type: "text", hasMany: true })
    ).toBe(false);
  });

  it("names the matching fields of a collection", () => {
    expect([
      ...referenceListFields([
        { name: "title", type: "text" },
        {
          name: "tags",
          type: "relationship",
          hasMany: true,
          relationTo: "tags",
        },
      ]),
    ]).toEqual(["tags"]);
  });
});

// A text operator over a list matched part of another id; it is refused before any query, naming
// the operator to use, as a 400 the caller can act on.
describe("referenceListCondition", () => {
  const refusalOf = (op: string, value: unknown = "a"): unknown => {
    try {
      referenceListCondition({
        dialect: "postgresql",
        column: sql`tags`,
        name: "tags",
        op,
        value,
      });
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it.each(["LIKE", "ILIKE", "ICONTAINS"])(
    "refuses %s, saying to use in",
    op => {
      const refused = refusalOf(op);
      expect(NextlyError.isValidation(refused)).toBe(true);
      const [problem] =
        (
          refused as {
            publicData?: { errors?: { code: string; message: string }[] };
          }
        ).publicData?.errors ?? [];
      expect(problem?.code).toBe("FILTER_OPERATOR_NOT_FOR_LIST");
      expect(problem?.message).toContain('"in"');
    }
  );

  it("refuses a comparison, which no list answers", () => {
    expect(NextlyError.isValidation(refusalOf(">"))).toBe(true);
  });

  it("refuses an empty in, which would otherwise match every entry", () => {
    expect(NextlyError.isValidation(refusalOf("IN", []))).toBe(true);
  });

  it("builds a condition for each membership operator", () => {
    for (const [op, value] of [
      ["=", "a"],
      ["!=", "a"],
      ["IN", ["a", "b"]],
      ["NOT IN", ["a"]],
      ["IS NULL", undefined],
      ["IS NOT NULL", undefined],
    ] as const) {
      expect(refusalOf(op, value)).toBeUndefined();
    }
  });
});
