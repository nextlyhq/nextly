/**
 * A contribution's visibility rule: a small declared language over one row,
 * answered by one function on both sides of the wire. A field missing from the
 * row as the reader's read returned it is a field the reader may not read, so
 * a rule that needs it never matches, `exists` and `not` included: the answer
 * never depends on a value the reader could not see.
 */
import { describe, expect, it } from "vitest";

import {
  rowMatches,
  rowPredicateFields,
  rowPredicateProblems,
  type RowPredicate,
} from "../row-predicate";

const ROW = {
  status: "draft",
  priority: 3,
  archived: false,
  owner: { team: "support" },
  note: null,
};

describe("rowMatches", () => {
  it.each<[string, RowPredicate, boolean]>([
    ["equals a string", { field: "status", equals: "draft" }, true],
    ["equals another string", { field: "status", equals: "published" }, false],
    ["equals a number", { field: "priority", equals: 3 }, true],
    ["equals false", { field: "archived", equals: false }, true],
    ["equals null on a null field", { field: "note", equals: null }, true],
    ["notEquals", { field: "status", notEquals: "published" }, true],
    ["notEquals the value", { field: "status", notEquals: "draft" }, false],
    ["in", { field: "priority", in: [1, 3] }, true],
    ["not in", { field: "priority", in: [1, 2] }, false],
    ["exists on a value", { field: "status", exists: true }, true],
    ["exists on null", { field: "note", exists: true }, false],
    ["not exists on null", { field: "note", exists: false }, true],
    ["a dotted field", { field: "owner.team", equals: "support" }, true],
    [
      "and",
      {
        and: [
          { field: "status", equals: "draft" },
          { field: "priority", equals: 3 },
        ],
      },
      true,
    ],
    [
      "and with one false",
      {
        and: [
          { field: "status", equals: "draft" },
          { field: "priority", equals: 4 },
        ],
      },
      false,
    ],
    [
      "or",
      {
        or: [
          { field: "status", equals: "published" },
          { field: "priority", equals: 3 },
        ],
      },
      true,
    ],
    ["not", { not: { field: "status", equals: "published" } }, true],
    ["a strict comparison", { field: "priority", equals: "3" }, false],
  ])("%s", (_case, predicate, expected) => {
    expect(rowMatches(predicate, ROW)).toBe(expected);
  });

  describe("a field missing from the row never matches", () => {
    // The read leaves out a field the reader may not read, so it is absent
    // from the row, and every rule that needs it answers no.
    const READ = { status: "draft" };

    it.each<[string, RowPredicate]>([
      ["equals", { field: "secret", equals: "x" }],
      ["notEquals", { field: "secret", notEquals: "x" }],
      ["in", { field: "secret", in: ["x"] }],
      ["exists", { field: "secret", exists: true }],
      ["exists false", { field: "secret", exists: false }],
      ["not equals", { not: { field: "secret", equals: "x" } }],
      ["not exists", { not: { field: "secret", exists: true } }],
      ["a dotted path past it", { field: "secret.inner", exists: false }],
      [
        "inside an and",
        {
          and: [
            { field: "status", equals: "draft" },
            { not: { field: "secret", equals: "x" } },
          ],
        },
      ],
      [
        "not of an or",
        {
          not: {
            or: [
              { field: "secret", equals: "x" },
              { field: "status", equals: "published" },
            ],
          },
        },
      ],
    ])("%s", (_case, predicate) => {
      expect(rowMatches(predicate, READ)).toBe(false);
    });

    it("decides by the fields it can see when they alone settle it", () => {
      // An `or` true by a visible field, or an `and` false by one, answers the
      // same whatever the hidden field holds, so it discloses nothing.
      expect(
        rowMatches(
          {
            or: [
              { field: "secret", equals: "x" },
              { field: "status", equals: "draft" },
            ],
          },
          READ
        )
      ).toBe(true);
      expect(
        rowMatches(
          {
            not: {
              and: [
                { field: "secret", equals: "x" },
                { field: "status", equals: "published" },
              ],
            },
          },
          READ
        )
      ).toBe(true);
    });

    it("reads an own property only", () => {
      expect(rowMatches({ field: "toString", exists: true }, {})).toBe(false);
      expect(
        rowMatches({ field: "constructor", exists: false }, Object.create(null))
      ).toBe(false);
    });
  });
});

describe("rowPredicateProblems", () => {
  it("accepts a well-formed rule", () => {
    expect(
      rowPredicateProblems({
        and: [
          { field: "status", in: ["draft", "review"] },
          { not: { field: "owner.team", equals: null } },
          { or: [{ field: "priority", exists: true }] },
        ],
      })
    ).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["not an object", "status = draft"],
    ["an array", [{ field: "status", equals: "draft" }]],
    ["no operator", { field: "status" }],
    ["two operators", { field: "status", equals: "a", notEquals: "b" }],
    ["an unknown operator", { field: "status", like: "dr%" }],
    ["a stray key", { field: "status", equals: "a", note: "x" }],
    ["a field that is not a path", { field: "status..x", equals: "a" }],
    ["an empty field", { field: "", equals: "a" }],
    ["an object to compare with", { field: "status", equals: { a: 1 } }],
    ["in without a list", { field: "status", in: "draft" }],
    ["in with an object", { field: "status", in: [{}] }],
    ["exists without a boolean", { field: "status", exists: "yes" }],
    ["an empty and", { and: [] }],
    ["an or of a non-rule", { or: [7] }],
    ["not of a list", { not: [{ field: "status", equals: "a" }] }],
    ["a combinator beside a field", { and: [], field: "status" }],
    [
      "a rule nested past the bound",
      Array.from({ length: 40 }).reduce<unknown>(inner => ({ not: inner }), {
        field: "status",
        equals: "a",
      }),
    ],
  ])("refuses %s", (_case, predicate) => {
    expect(rowPredicateProblems(predicate).length).toBeGreaterThan(0);
  });
});

describe("rowPredicateFields", () => {
  it("lists every field a rule reads, once each", () => {
    expect(
      rowPredicateFields({
        and: [
          { field: "status", equals: "draft" },
          {
            or: [
              { field: "owner.team", exists: true },
              { not: { field: "status", in: ["a"] } },
            ],
          },
        ],
      })
    ).toEqual(["owner.team", "status"]);
  });
});
