/**
 * A filter that is not well formed is refused, never run without its bad part.
 *
 * Each case below used to be SKIPPED by the translator that met it: the member
 * disappeared and its siblings decided alone, so the query answered a wider
 * question than the one asked. The property under test is therefore the
 * refusal itself — a typed error naming the problem — at the top level, inside
 * `and` and `or`, and on a component field. A translator that dropped the
 * member would return a clause (or `undefined`) rather than throw, so it fails
 * every case here.
 */
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { buildDrizzleCondition } from "../../../../services/collections/drizzle-condition";
import { FILTER_OPERATORS } from "../filter-shape";
import {
  buildWhereClause,
  extractComponentFieldConditions,
  extractGeoFilters,
  GEO_OPERATORS,
  getSupportedOperators,
  isValidOperator,
  type WhereFilter,
} from "../query-operators";

/** The codes a call refused with, or a failure when it did not refuse. */
function refusalCodes(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    expect(NextlyError.is(error), String(error)).toBe(true);
    const e = error as NextlyError;
    expect(e.statusCode).toBe(400);
    const errors = (e.publicData as { errors: { code: string }[] }).errors;
    return errors.map(x => x.code);
  }
  throw new Error("expected the filter to be refused, and it was accepted");
}

/** The malformed member, and the code its refusal carries. */
const MALFORMED: Array<[string, Record<string, unknown>, string]> = [
  ["an unknown operator", { title: { equal: "a" } }, "FILTER_UNKNOWN_OPERATOR"],
  [
    "a field whose only operator is unknown",
    { title: { startsWith: "a" } },
    "FILTER_UNKNOWN_OPERATOR",
  ],
  ["an undefined value", { title: undefined }, "FILTER_UNDEFINED_VALUE"],
  [
    "an undefined operand",
    { title: { equals: undefined } },
    "FILTER_UNDEFINED_VALUE",
  ],
  ["an empty in", { title: { in: [] } }, "FILTER_EMPTY_IN"],
  ["a non-list in", { title: { in: "a" } }, "FILTER_INVALID_OPERAND"],
  [
    "an object operand to equals",
    { title: { equals: { not: "a" } } },
    "FILTER_INVALID_OPERAND",
  ],
  ["a null shorthand", { title: null }, "FILTER_INVALID_OPERAND"],
  ["a list shorthand", { title: ["a", "b"] }, "FILTER_INVALID_OPERAND"],
  ["an empty condition", { title: {} }, "FILTER_NO_OPERATOR"],
  [
    "an exists that is not boolean",
    { title: { exists: "yes" } },
    "FILTER_INVALID_OPERAND",
  ],
];

/** The same member placed at each depth a filter can carry it. */
function placements(member: Record<string, unknown>): Array<[string, unknown]> {
  return [
    ["at the top level", member],
    ["inside and", { and: [{ status: { equals: "x" } }, member] }],
    ["inside or", { or: [{ status: { equals: "x" } }, member] }],
  ];
}

describe("the operators the shape check accepts", () => {
  it("are exactly those the translators implement", () => {
    // Two lists of one set. An operator accepted here and missing from the
    // translator would pass the check and then have no SQL to become.
    expect([...FILTER_OPERATORS].sort()).toEqual(
      [...getSupportedOperators(), ...GEO_OPERATORS].sort()
    );
  });

  it("are the only names isValidOperator accepts", () => {
    // An `in` check reaches Object.prototype, so `toString` passed the
    // operator check other callers use while the shape check refused it.
    for (const inherited of ["toString", "constructor", "hasOwnProperty"]) {
      expect(isValidOperator(inherited), inherited).toBe(false);
    }
    for (const operator of getSupportedOperators()) {
      expect(isValidOperator(operator), operator).toBe(true);
    }
  });
});

describe("buildWhereClause refuses a filter that is not well formed", () => {
  for (const [name, member, code] of MALFORMED) {
    for (const [where, filter] of placements(member)) {
      it(`refuses ${name} ${where}`, () => {
        expect(
          refusalCodes(() => buildWhereClause(filter as WhereFilter))
        ).toContain(code);
      });
    }
  }

  it("refuses an and that is not a list", () => {
    expect(
      refusalCodes(() =>
        buildWhereClause({
          and: { title: { equals: "a" } },
        } as unknown as WhereFilter)
      )
    ).toContain("FILTER_INVALID_LOGICAL");
  });

  it("refuses an or that is not a list", () => {
    expect(
      refusalCodes(() =>
        buildWhereClause({ or: "title" } as unknown as WhereFilter)
      )
    ).toContain("FILTER_INVALID_LOGICAL");
  });

  it("refuses a list member that is not a filter", () => {
    expect(
      refusalCodes(() =>
        buildWhereClause({ or: ["title"] } as unknown as WhereFilter)
      )
    ).toContain("FILTER_NOT_AN_OBJECT");
  });

  it("refuses a hole in an or list", () => {
    // A sparse list skips its holes under `forEach` and `map`, so a hole read
    // as "no condition" would make the `or` match every row.
    const members: WhereFilter[] = [];
    members[1] = { title: { equals: "a" } };
    expect(refusalCodes(() => buildWhereClause({ or: members }))).toContain(
      "FILTER_NOT_AN_OBJECT"
    );
  });

  it("refuses a geo operator the SQL builder cannot express", () => {
    // Geo operators are applied in memory by the list read, which lifts them
    // out first. One reaching the SQL builder would otherwise vanish.
    expect(
      refusalCodes(() =>
        buildWhereClause({
          location: { near: "-74,40,1000" },
        } as unknown as WhereFilter)
      )
    ).toContain("FILTER_GEO_NOT_HERE");
  });

  it("names every problem in one refusal", () => {
    const codes = refusalCodes(() =>
      buildWhereClause({
        title: { equal: "a" },
        and: [{ body: { in: [] } }],
      } as WhereFilter)
    );
    expect(codes).toEqual(
      expect.arrayContaining(["FILTER_UNKNOWN_OPERATOR", "FILTER_EMPTY_IN"])
    );
  });

  it("still builds a well-formed filter", () => {
    // The negative control: a builder that refused everything passes the
    // cases above.
    expect(
      buildWhereClause({
        title: { equals: "a" },
        or: [{ views: { greater_than: 3 } }, { tags: { in: ["x"] } }],
      })
    ).toEqual({
      and: [
        {
          or: [
            { and: [{ column: "views", op: ">", value: 3 }] },
            { and: [{ column: "tags", op: "IN", value: ["x"] }] },
          ],
        },
        { column: "title", op: "=", value: "a" },
      ],
    });
  });
});

describe("empty lists keep their meaning", () => {
  const dialect = new PgDialect();
  const table = pgTable("posts", {
    id: uuid("id").primaryKey(),
    title: text("title"),
  });
  const render = (where: WhereFilter) => {
    const condition = buildDrizzleCondition(
      buildWhereClause(where),
      table,
      "postgresql"
    );
    return condition ? dialect.sqlToQuery(condition).sql : undefined;
  };

  it("an empty or matches no entry", () => {
    // A rule writing `or: teams.map(...)` for a caller in no team means
    // "nothing". Dropping the empty list turned it into "everything".
    expect(render({ or: [] })).toBe("1 = 0");
  });

  it("an empty or beside another condition still matches nothing", () => {
    expect(render({ title: { equals: "a" }, or: [] })).toContain("1 = 0");
  });

  it("an empty not_in excludes nothing", () => {
    expect(render({ title: { not_in: [] } })).toBe("1 = 1");
  });

  it("an or holding an empty not_in matches every entry", () => {
    expect(
      render({ or: [{ title: { not_in: [] } }, { title: { equals: "a" } }] })
    ).toContain("1 = 1");
  });

  it("an or with an empty member matches every entry", () => {
    // `{}` is no condition, so an `or` holding one is true whatever its other
    // members say. Dropping the empty member made the `or` narrower instead.
    expect(render({ or: [{}, { title: { equals: "a" } }] })).toBeUndefined();
  });
});

describe("the condition builder refuses a key it cannot resolve", () => {
  const table = pgTable("posts", {
    id: uuid("id").primaryKey(),
    title: text("title"),
    author: uuid("author"),
  });
  const build = (where: WhereFilter) => () =>
    buildDrizzleCondition(buildWhereClause(where), table, "postgresql");

  it("refuses an unknown field", () => {
    expect(refusalCodes(build({ titel: { equals: "a" } }))).toContain(
      "FILTER_UNKNOWN_FIELD"
    );
  });

  it("refuses an unknown field inside or", () => {
    expect(
      refusalCodes(
        build({ or: [{ title: { equals: "a" } }, { titel: { equals: "a" } }] })
      )
    ).toContain("FILTER_UNKNOWN_FIELD");
  });

  it("refuses a key that names no column but exists on the table object", () => {
    // A lookup by property name reaches the prototype, so `constructor` or
    // `getSQL` would otherwise resolve to something that is not a column.
    expect(refusalCodes(build({ constructor: { equals: "a" } }))).toContain(
      "FILTER_UNKNOWN_FIELD"
    );
  });

  it("refuses a dot path into a relationship", () => {
    // `author.name` used to compare the `author` column itself with "Ada".
    expect(refusalCodes(build({ "author.name": { equals: "Ada" } }))).toContain(
      "FILTER_UNFILTERABLE_PATH"
    );
  });

  it("refuses an unknown field whose only condition is an empty not_in", () => {
    // The condition excludes nothing, and dropping it before the field was
    // resolved let a misspelt field through as an unfiltered read.
    expect(refusalCodes(build({ titel: { not_in: [] } }))).toContain(
      "FILTER_UNKNOWN_FIELD"
    );
    expect(refusalCodes(build({ "author.name": { not_in: [] } }))).toContain(
      "FILTER_UNFILTERABLE_PATH"
    );
  });

  it("still resolves a real column", () => {
    expect(build({ title: { equals: "a" } })()).toBeDefined();
  });
});

describe("component fields refuse the same malformed conditions", () => {
  const fields = [
    { name: "title", type: "text" },
    { name: "seo", type: "component", component: "seo" },
  ];
  for (const [name, member, code] of MALFORMED) {
    const value = Object.values(member)[0];
    const componentMember =
      member.title === undefined && "title" in member
        ? { "seo.metaTitle": undefined }
        : { "seo.metaTitle": value };
    for (const [where, filter] of placements(componentMember)) {
      if (where === "inside or") continue;
      it(`refuses ${name} on a component field ${where}`, () => {
        expect(
          refusalCodes(() =>
            extractComponentFieldConditions(filter as WhereFilter, fields)
          )
        ).toContain(code);
      });
    }
  }

  it("refuses a component path inside or", () => {
    // Component conditions are lifted out and AND-ed with the rest, so one
    // written inside an `or` would silently change meaning.
    expect(
      refusalCodes(() =>
        extractComponentFieldConditions(
          {
            or: [
              { title: { equals: "a" } },
              { "seo.metaTitle": { equals: "b" } },
            ],
          },
          fields
        )
      )
    ).toContain("FILTER_NOT_IN_OR");
  });

  it("still extracts a well-formed component condition", () => {
    const { componentFilters, cleanedWhere } = extractComponentFieldConditions(
      { title: { equals: "a" }, "seo.metaTitle": { contains: "b" } },
      fields
    );
    expect(componentFilters).toHaveLength(1);
    expect(cleanedWhere).toEqual({ title: { equals: "a" } });
  });
});

describe("geo conditions refuse what they cannot apply", () => {
  it("tells a caller the within format the parser reads", () => {
    // The parser reads a circle only; describing a box or polygon would send
    // a caller following the message straight into a second refusal.
    let message = "";
    try {
      extractGeoFilters({
        location: { within: "a,b" },
      } as unknown as WhereFilter);
    } catch (error) {
      message = JSON.stringify((error as NextlyError).publicData);
    }
    expect(message).toContain("longitude,latitude,radius");
    expect(message).not.toContain("polygon");
  });

  it("refuses an unparseable near", () => {
    expect(
      refusalCodes(() =>
        extractGeoFilters({
          location: { near: "here" },
        } as unknown as WhereFilter)
      )
    ).toContain("FILTER_INVALID_OPERAND");
  });

  it("refuses a geo condition inside or", () => {
    // Geo conditions run in memory as an extra AND, so inside an `or` they
    // would narrow the read instead of offering an alternative.
    expect(
      refusalCodes(() =>
        extractGeoFilters({
          or: [
            { title: { equals: "a" } },
            { location: { near: "-74,40,1000" } },
          ],
        } as unknown as WhereFilter)
      )
    ).toContain("FILTER_NOT_IN_OR");
  });

  it("keeps a malformed non-geo member for the SQL builder to refuse", () => {
    // Extraction used to DROP a value with no operator, so the builder never
    // saw it. Whatever extraction leaves, the builder must still be able to
    // refuse.
    expect(
      refusalCodes(() =>
        buildWhereClause(
          extractGeoFilters({
            location: { near: "-74,40,1000" },
            title: { startsWith: "a" },
          } as unknown as WhereFilter).cleanedWhere as WhereFilter
        )
      )
    ).toContain("FILTER_UNKNOWN_OPERATOR");
  });
});
