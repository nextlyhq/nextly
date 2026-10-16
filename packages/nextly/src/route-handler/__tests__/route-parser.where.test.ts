/**
 * The bracket form of a REST filter (`where[title][equals]=…`) reaches the
 * read as the filter the caller wrote.
 *
 * Each case runs the request the way the dispatcher does: the route parser
 * forwards the bracket parameters unparsed, and `parseWhereParam` parses them
 * beside any JSON `where`, where a refusal answers 400.
 *
 * Three ways it used not to. Each key was read into a field name such as
 * `title]equals`, which matched no column, so the condition was dropped and
 * every row matched. Every value was split on commas, so `equals` with a comma
 * in its text became a list, and a `near` point a list of numbers the geo
 * filter ignored. And when a request carried both a JSON `where` and bracket
 * conditions, the bracket conditions were dropped without a word.
 */
import { describe, expect, it } from "vitest";

import { parseWhereParam } from "../../dispatcher/helpers/validation";
import { NextlyError } from "../../errors/nextly-error";
import { parseRestRoute } from "../route-parser";

function whereOf(query: string): unknown {
  const { routeParams } = parseRestRoute(
    ["collections", "posts", "entries"],
    "GET",
    new URLSearchParams(query)
  );
  return parseWhereParam(routeParams?.where, routeParams?.whereBrackets);
}

describe("bracket filters keep the value the caller wrote", () => {
  it("reads each bracketed segment as one level of the filter", () => {
    expect(whereOf("where[title][equals]=alpha")).toEqual({
      title: { equals: "alpha" },
    });
    expect(
      whereOf("where[or][0][title][equals]=a&where[or][1][views][less_than]=3")
    ).toEqual({
      or: [{ title: { equals: "a" } }, { views: { less_than: 3 } }],
    });
  });

  it("keeps a comma inside an equals value as text", () => {
    expect(whereOf("where[title][equals]=Hello, world")).toEqual({
      title: { equals: "Hello, world" },
    });
  });

  it("keeps a near point as the string the geo filter parses", () => {
    expect(whereOf("where[location][near]=-74.006,40.7128,1000")).toEqual({
      location: { near: "-74.006,40.7128,1000" },
    });
  });

  it("reads an in value as a list, even with one member", () => {
    expect(whereOf("where[tags][in]=news")).toEqual({
      tags: { in: ["news"] },
    });
    expect(whereOf("where[tags][in]=news,featured")).toEqual({
      tags: { in: ["news", "featured"] },
    });
  });

  it("still coerces a number and a boolean", () => {
    expect(
      whereOf("where[views][greater_than]=10&where[featured][equals]=true")
    ).toEqual({
      views: { greater_than: 10 },
      featured: { equals: true },
    });
  });
});

/** The refusal's errors, or a failure when the call was accepted. */
function refusedErrors(run: () => unknown): { code: string; path: string }[] {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(NextlyError.is(caught)).toBe(true);
  expect((caught as NextlyError).statusCode).toBe(400);
  return (
    (caught as NextlyError).publicData as {
      errors: { code: string; path: string }[];
    }
  ).errors;
}

describe("bracket filters that cannot be read", () => {
  it("refuses a key that is not a run of bracketed segments", () => {
    expect(
      refusedErrors(() => whereOf("where[title]equals=a")).map(e => e.code)
    ).toEqual(["FILTER_INVALID_KEY"]);
  });

  it("refuses a __proto__ segment without touching Object.prototype", () => {
    // Assigning through an inherited `__proto__` writes onto
    // Object.prototype, which every later request would then inherit.
    expect(
      refusedErrors(() =>
        whereOf("where[__proto__][polluted]=yes&where[title][equals]=a")
      ).map(e => e.code)
    ).toEqual(["FILTER_INVALID_KEY"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("walks constructor and prototype segments as own keys", () => {
    // A field may be named `constructor`, so the segment is read as a key of
    // the filter being built, never as the inherited property.
    expect(whereOf("where[constructor][equals]=x")).toEqual({
      constructor: { equals: "x" },
    });
    try {
      whereOf("where[constructor][prototype][polluted]=yes");
    } catch {
      // Refused for its unknown operator; what matters is what it touched.
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses a segment that nests under a value already given", () => {
    // Walking into the string "a" and assigning onto it threw a TypeError,
    // which answered 500 instead of naming the problem.
    expect(
      refusedErrors(() =>
        whereOf("where[title][equals]=a&where[title][equals][x]=b")
      ).map(e => e.code)
    ).toEqual(["FILTER_INVALID_KEY"]);
  });

  it("refuses a list index that is not written as a plain integer", () => {
    // `00` is not an array index, so it was set as a property the list's
    // length ignores, and the `and` was read as empty, dropping the tenant.
    expect(
      refusedErrors(() => whereOf("where[and][00][tenant][equals]=acme")).map(
        e => e.code
      )
    ).toEqual(["FILTER_INVALID_KEY"]);
  });

  it("refuses a named segment under a list, and an index under an object", () => {
    // A named key set on a list is ignored by everything that reads the
    // list, so the condition under it would vanish.
    expect(
      refusedErrors(() =>
        whereOf("where[or][0][a][equals]=1&where[or][b][equals]=2")
      ).map(e => e.code)
    ).toEqual(["FILTER_INVALID_KEY"]);
    expect(
      refusedErrors(() =>
        whereOf("where[title][equals]=a&where[title][0]=b")
      ).map(e => e.code)
    ).toEqual(["FILTER_INVALID_KEY"]);
  });

  it("refuses a scalar value given before a nested one at the same path", () => {
    expect(
      refusedErrors(() => whereOf("where[title]=x&where[title][equals]=x")).map(
        e => e.code
      )
    ).toEqual(["FILTER_INVALID_KEY"]);
  });

  it("refuses the same condition given twice rather than keeping the last", () => {
    expect(
      refusedErrors(() =>
        whereOf("where[title][equals]=a&where[title][equals]=b")
      ).map(e => e.code)
    ).toEqual(["FILTER_INVALID_KEY"]);
  });

  it("refuses a list index past the condition limit before building the list", () => {
    // A list built to this index has a billion slots, and walking them blocks
    // the server; the index has to be refused before any list exists.
    const started = Date.now();
    expect(
      refusedErrors(() =>
        whereOf("where[or][1000000000][title][equals]=x")
      ).map(e => e.code)
    ).toEqual(["FILTER_INVALID_KEY"]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("refuses an or list with a gap where a member should be", () => {
    // `where[or][1]` with no `[0]` builds a list whose first slot is empty. A
    // translator that skipped the hole read the empty member as "no
    // condition", which makes an or match every row.
    expect(
      refusedErrors(() => whereOf("where[or][1][title][equals]=a")).map(
        e => e.path
      )
    ).toEqual(["where.or.0"]);
  });
});

describe("a filter given twice", () => {
  it("is forwarded by the route parser rather than refused there", () => {
    // A refusal thrown while parsing the route escapes the dispatcher's error
    // mapping and answers 500, so the parser only forwards what it was given.
    const { routeParams } = parseRestRoute(
      ["collections", "posts", "entries"],
      "GET",
      new URLSearchParams("where=%7B%7D&where[status][equals]=draft")
    );
    expect(routeParams).toMatchObject({
      where: "{}",
      whereBrackets: "where%5Bstatus%5D%5Bequals%5D=draft",
    });
  });

  it("refuses JSON and bracket conditions in one request", () => {
    expect(
      refusedErrors(() =>
        whereOf(
          `where=${encodeURIComponent('{"title":{"equals":"a"}}')}&where[status][equals]=draft`
        )
      ).map(e => e.code)
    ).toEqual(["FILTER_GIVEN_TWICE"]);
  });
});
