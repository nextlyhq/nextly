/**
 * A REST `where` the server cannot use is refused with a 400, never read as
 * "no filter".
 *
 * Replaces the owner-column suite, which pinned the old behaviour: an owner
 * condition was STRIPPED, so `or: [{ createdBy: … }]` became no condition and
 * the read answered every row. The owner column stays unaddressable — it is
 * stripped from every response, so a caller must not target rows by it — but
 * naming it is now refused rather than silently ignored, for the reason every
 * other malformed member is.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { parseWhereParam, readClientWhere } from "../validation";

/** The 400's error codes, or a failure when the input was accepted. */
function refusal(run: () => unknown): { codes: string[]; paths: string[] } {
  try {
    run();
  } catch (error) {
    expect(NextlyError.is(error), String(error)).toBe(true);
    const e = error as NextlyError;
    expect(e.statusCode).toBe(400);
    const errors = (
      e.publicData as { errors: { code: string; path: string }[] }
    ).errors;
    return { codes: errors.map(x => x.code), paths: errors.map(x => x.path) };
  }
  throw new Error("expected the where to be refused, and it was accepted");
}

describe("parseWhereParam", () => {
  it("refuses JSON it cannot parse", () => {
    expect(refusal(() => parseWhereParam("{title:")).codes).toEqual([
      "FILTER_INVALID_JSON",
    ]);
  });

  it.each([
    ["a list", "[1,2]"],
    ["a string", '"title"'],
    ["null", "null"],
    ["a number", "3"],
  ])("refuses JSON that is %s rather than a filter", (_name, json) => {
    expect(refusal(() => parseWhereParam(json)).codes).toEqual([
      "FILTER_NOT_AN_OBJECT",
    ]);
  });

  it("refuses an unknown operator", () => {
    expect(
      refusal(() => parseWhereParam(JSON.stringify({ title: { equal: "a" } })))
        .codes
    ).toEqual(["FILTER_UNKNOWN_OPERATOR"]);
  });

  it("refuses an and that is not a list", () => {
    expect(
      refusal(() =>
        parseWhereParam(JSON.stringify({ and: { title: { equals: "a" } } }))
      ).codes
    ).toEqual(["FILTER_INVALID_LOGICAL"]);
  });

  it("refuses a malformed language filter", () => {
    expect(
      refusal(() =>
        parseWhereParam(
          JSON.stringify({ _translated: { locale: "fr", state: "done" } })
        )
      ).codes
    ).toEqual(["FILTER_INVALID_OPERAND"]);
  });

  it("refuses a __proto__ field key from JSON", () => {
    // JSON.parse makes `__proto__` an own key. Accepted, it was later
    // assigned onto a rebuilt filter, which set the prototype instead of a
    // key, so the condition vanished and an `or` holding it matched
    // everything.
    expect(
      refusal(() =>
        parseWhereParam(
          '{"or":[{"__proto__":{"equals":"x"}},{"title":{"equals":"a"}}]}'
        )
      ).codes
    ).toEqual(["FILTER_UNKNOWN_FIELD"]);
  });

  it("returns a well-formed filter unchanged", () => {
    const where = {
      price: { greater_than: 100 },
      or: [{ title: { contains: "hi" } }, { tags: { in: ["a"] } }],
      _translated: { locale: "fr", state: "missing" },
    };
    expect(parseWhereParam(JSON.stringify(where))).toEqual(where);
  });

  it("treats an absent or empty parameter as no filter", () => {
    expect(parseWhereParam(undefined)).toBeUndefined();
    expect(parseWhereParam("")).toBeUndefined();
  });
});

describe("the owner column cannot be filtered on", () => {
  it.each([
    ["created_by", { created_by: { equals: "u1" } }, "where.created_by"],
    ["createdBy", { createdBy: { equals: "u1" } }, "where.createdBy"],
    [
      "a dotted owner key",
      { "created_by.any": { equals: "u1" } },
      "where.created_by.any",
    ],
    [
      "a spelling that resolves to the owner column",
      { CreatedBy: { equals: "u1" } },
      "where.CreatedBy",
    ],
    [
      "an owner key inside or",
      { or: [{ createdBy: { equals: "u2" } }] },
      "where.or.0.createdBy",
    ],
    [
      "an owner key inside and",
      { and: [{ title: { equals: "a" } }, { created_by: { equals: "u1" } }] },
      "where.and.1.created_by",
    ],
  ])("refuses %s", (_name, where, path) => {
    const fromQuery = refusal(() => parseWhereParam(JSON.stringify(where)));
    expect(fromQuery.codes).toEqual(["FIELD_NOT_FILTERABLE"]);
    expect(fromQuery.paths).toEqual([path]);
    // The request-body path refuses the same filter the same way.
    expect(refusal(() => readClientWhere(where)).paths).toEqual([path]);
  });

  it("leaves owner-free filters untouched", () => {
    expect(readClientWhere({ price: { greater_than: 100 } })).toEqual({
      price: { greater_than: 100 },
    });
  });

  it("passes undefined through unchanged", () => {
    expect(readClientWhere(undefined)).toBeUndefined();
  });
});
