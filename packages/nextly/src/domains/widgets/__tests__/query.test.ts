import { beforeEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { MAX_WIDGET_LIMIT, validateWidgetQuery } from "../query";
import { clearSources, registerSource } from "../sources";

/** The one message every source/op refusal answers with. */
const SOURCE_OR_OP_REFUSAL =
  "Invalid widget query: unavailable source or unsupported op";

/**
 * Runs `fn`, requiring it to throw a `NextlyError`, and hands the error back
 * so a test can read `logContext` -- the only place the source/op detail
 * survives now that the public message is shared.
 */
function caught(fn: () => unknown): NextlyError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(NextlyError);
    return err as NextlyError;
  }
  throw new Error("expected the call to throw, and it returned");
}

beforeEach(() => {
  clearSources();
  registerSource({
    id: "collection:posts",
    label: "Posts",
    kind: "collection",
    supports: ["count", "list"],
    fields: [
      { name: "title", type: "string" },
      { name: "status", type: "string" },
      { name: "updatedAt", type: "date" },
    ],
  });
});

describe("validateWidgetQuery", () => {
  it("accepts a query naming a registered source and declared fields, and returns every field unchanged", () => {
    // I5(a): assert the WHOLE returned object, not just `limit` -- a version
    // that silently dropped `select` or collapsed `sort`'s leading `-`
    // (reversing sort direction) would still pass a `limit`-only assertion.
    const input = {
      source: "collection:posts",
      op: "list",
      select: ["title"],
      sort: "-updatedAt",
      where: { status: { equals: "draft" } },
      limit: 5,
    };
    const q = validateWidgetQuery(input);
    expect(q).toEqual({
      source: "collection:posts",
      op: "list",
      select: ["title"],
      sort: "-updatedAt",
      where: { status: { equals: "draft" } },
      limit: 5,
    });
  });

  it("accepts a bare scalar under a field name as an implicit equality shorthand", () => {
    const q = validateWidgetQuery({
      source: "collection:posts",
      op: "count",
      where: { status: "draft" },
    });
    expect(q.where).toEqual({ status: "draft" });
  });

  it("refuses an unregistered source", () => {
    // The source id is resolved against the registry, so no caller-invented
    // table name can ever reach the compiler. Anchored to `logContext` rather
    // than to the message, because the message is deliberately identical for
    // every source/op refusal (an enumeration oracle otherwise) -- a catch-all
    // that refused everything would satisfy a match on the shared message and
    // could not produce this detail.
    const err = caught(() =>
      validateWidgetQuery({ source: "collection:secrets", op: "count" })
    );
    expect(err.publicMessage).toBe(SOURCE_OR_OP_REFUSAL);
    expect(err.logContext?.widgetQuery).toMatch(
      /unknown source "collection:secrets"/
    );
  });

  it("refuses an op the source does not support", () => {
    const err = caught(() =>
      validateWidgetQuery({ source: "collection:posts", op: "timeseries" })
    );
    expect(err.publicMessage).toBe(SOURCE_OR_OP_REFUSAL);
    expect(err.logContext?.widgetQuery).toMatch(
      /does not support op "timeseries"/
    );
  });

  it("gives an unknown source and an unsupported op the SAME public message", () => {
    // The oracle, stated directly: a caller who can tell the two apart can
    // walk collection names and learn which exist.
    const unknownSource = caught(() =>
      validateWidgetQuery({ source: "collection:secrets", op: "count" })
    );
    const unsupportedOp = caught(() =>
      validateWidgetQuery({ source: "collection:posts", op: "timeseries" })
    );
    expect(unknownSource.publicMessage).toBe(unsupportedOp.publicMessage);
  });

  it("refuses a where clause naming an undeclared field", () => {
    expect(() =>
      validateWidgetQuery({
        source: "collection:posts",
        op: "count",
        where: { secretScore: { equals: 1 } },
      })
    ).toThrow(/where references undeclared field "secretScore"/);
  });

  it("refuses a select naming an undeclared field", () => {
    expect(() =>
      validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        select: ["title", "secretScore"],
      })
    ).toThrow(/select references undeclared field "secretScore"/);
  });

  it("refuses a sort naming an undeclared field, with or without the minus", () => {
    expect(() =>
      validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        sort: "-secretScore",
      })
    ).toThrow(/sort references undeclared field "secretScore"/);
  });

  it("clamps the limit rather than trusting it", () => {
    const q = validateWidgetQuery({
      source: "collection:posts",
      op: "list",
      limit: 100000,
    });
    expect(q.limit).toBe(MAX_WIDGET_LIMIT);
  });

  it("refuses a where clause nested past the depth cap", () => {
    // Unbounded nesting is a cheap way to make validation itself the
    // expensive operation.
    let deep: Record<string, unknown> = { status: { equals: "draft" } };
    for (let i = 0; i < 12; i++) deep = { and: [deep] };
    expect(() =>
      validateWidgetQuery({
        source: "collection:posts",
        op: "count",
        where: deep,
      })
    ).toThrow(/nested too deeply/);
  });

  // ---------------------------------------------------------------------
  // C1: a non-array `and`/`or` value must not silently drop its subtree
  // from the field walk. Each shape below names the undeclared field
  // "secretScore" but through a combinator value the old code coerced to
  // `[]` (zero branches) via `Array.isArray(value) ? value : []` -- which
  // walked nothing, refused nothing, and let the query through.
  // ---------------------------------------------------------------------
  describe("C1: non-array and/or combinators fail closed", () => {
    it("refuses a non-array `and` value instead of treating it as zero branches", () => {
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { and: { secretScore: { equals: 1 } } },
        })
      ).toThrow(/where "and" must be an array/);
    });

    it("refuses a non-array `and` value even alongside a valid sibling condition", () => {
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: {
            status: { equals: "draft" },
            and: { secretScore: { equals: 1 } },
          },
        })
      ).toThrow(/where "and" must be an array/);
    });

    it("refuses an EMPTY `and` array, which matches every row", () => {
      // The same reason `null` and `{}` are refused under a field name: zero
      // branches compile to no condition at all, so an accepted query the
      // author wrote as filtered returns every row instead. Accepting `[]`
      // while refusing `null` and `{}` for that identical reason was the
      // inconsistency.
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { and: [] },
        })
      ).toThrow(/where "and" is empty, which matches every row/);
    });

    it("refuses an EMPTY `or` array too", () => {
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { or: [] },
        })
      ).toThrow(/where "or" is empty, which matches every row/);
    });

    it("still accepts a combinator with branches", () => {
      // The negative control: refusing every combinator would pass both tests
      // above and break every non-trivial widget.
      const q = validateWidgetQuery({
        source: "collection:posts",
        op: "count",
        where: { or: [{ status: { equals: "draft" } }] },
      });
      expect(q.where).toEqual({ or: [{ status: { equals: "draft" } }] });
    });

    it("refuses a non-object branch inside an `and` array", () => {
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { and: ["secretScore"] },
        })
      ).toThrow(/where "and" branch must be an object/);
    });
  });

  // ---------------------------------------------------------------------
  // I2: the returned query must be independent of the input, `where`
  // included -- not merely a fresh top-level envelope wrapped around a
  // shared `where` reference.
  // ---------------------------------------------------------------------
  it("returns a `where` independent of the input -- mutating the input afterward does not touch it", () => {
    const input: {
      source: string;
      op: string;
      where: Record<string, unknown>;
    } = {
      source: "collection:posts",
      op: "count",
      where: { status: { equals: "draft" } },
    };
    const q = validateWidgetQuery(input);
    expect(q.where).not.toBe(input.where);

    // Mutate the ORIGINAL input's `where` after validation returned. If the
    // returned query shares the reference, this mutation would smuggle an
    // undeclared field into an object that already passed the gate and that
    // a caller now treats as safe to compile.
    (input.where as Record<string, unknown>).secretScore = { equals: 1 };

    expect(q.where).toEqual({ status: { equals: "draft" } });
  });

  // ---------------------------------------------------------------------
  // I3: `limit` must clamp even when it is not a well-formed finite number.
  // ---------------------------------------------------------------------
  describe("I3: limit clamping survives non-finite and non-integer input", () => {
    it("falls back to a finite, in-range limit when the requested limit is NaN", () => {
      const q = validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        limit: Number.NaN,
      });
      expect(Number.isFinite(q.limit)).toBe(true);
      expect(q.limit).toBeGreaterThanOrEqual(1);
      expect(q.limit).toBeLessThanOrEqual(MAX_WIDGET_LIMIT);
    });

    it("truncates a non-integer limit to a whole number", () => {
      const q = validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        limit: 5.7,
      });
      expect(Number.isInteger(q.limit)).toBe(true);
      expect(q.limit).toBe(5);
    });

    it("still clamps a negative limit up to 1", () => {
      const q = validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        limit: -1,
      });
      expect(q.limit).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // I4: operator keys inside a field condition must be checked against the
  // known operator vocabulary -- the field-name check alone lets an
  // arbitrary operator key (and anything nested under it) through.
  // ---------------------------------------------------------------------
  describe("I4: where operators are checked against the known vocabulary", () => {
    it("refuses a where clause using an operator outside the known vocabulary", () => {
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { status: { $ne: null, notAnOperator: "x", $where: "1=1" } },
        })
      ).toThrow(/unknown operator "\$ne" on field "status"/);
    });

    it("refuses an unrecognised operator key even when it hides a nested condition", () => {
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { status: { some: { secretScore: { equals: 1 } } } },
        })
      ).toThrow(/unknown operator "some" on field "status"/);
    });

    it("refuses a nested object value under a recognised operator", () => {
      // "equals" IS a known operator; its VALUE should never be a plain
      // object (every real operator takes a scalar or an array), so this
      // is refused rather than walked -- see query.ts for why.
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { status: { equals: { secretScore: 1 } } },
        })
      ).toThrow(
        /operator "equals" on field "status" may not take a nested object/
      );
    });

    it("refuses a bare array as a field's condition", () => {
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { status: ["draft"] },
        })
      ).toThrow(/where condition for "status" must be an operator object/);
    });
  });

  // ---------------------------------------------------------------------
  // R2-1: `where` must be read exactly once. Cloning AFTER the walk let a
  // getter/Proxy answer benignly to the walker's read and hostilely to a
  // second, later read (structuredClone) -- a TOCTOU. Cloning FIRST and
  // validating (and returning) that clone means only one read ever happens,
  // so there is no second read left for a hostile answer to arrive on.
  // ---------------------------------------------------------------------
  describe("R2-1: where is read exactly once (clone-first closes the clone-after-walk TOCTOU)", () => {
    it("a getter on `and` cannot answer differently to the walk than to the returned value", () => {
      let reads = 0;
      const where = {
        get and() {
          reads++;
          // First (and, after the fix, ONLY) read is benign. A getter-based
          // TOCTOU relies on a second read landing after the first read was
          // approved -- that second read must never happen. The benign value
          // carries a real branch because an empty combinator is now refused
          // in its own right, which would end the test before the property
          // under test is reached.
          return reads === 1
            ? [{ status: { equals: "draft" } }]
            : [{ secretScore: { equals: 1 } }];
        },
      };
      const q = validateWidgetQuery({
        source: "collection:posts",
        op: "count",
        where,
      });
      expect(reads).toBe(1);
      expect(q.where).toEqual({ and: [{ status: { equals: "draft" } }] });
    });

    it("a getter on a declared field's condition cannot answer differently to the walk than to the returned value", () => {
      let reads = 0;
      const where = {
        get status() {
          reads++;
          return reads === 1 ? { equals: "draft" } : { $where: "1=1 OR 1=1" };
        },
      };
      const q = validateWidgetQuery({
        source: "collection:posts",
        op: "count",
        where,
      });
      expect(reads).toBe(1);
      expect(q.where).toEqual({ status: { equals: "draft" } });
    });

    it("wraps an uncloneable where value in NextlyError rather than a raw DOMException", () => {
      let caught: unknown;
      try {
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { status: () => "not clonable" },
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(NextlyError);
      expect((caught as Error).message).toMatch(
        /where contains a value that cannot be cloned/
      );
    });
  });

  // ---------------------------------------------------------------------
  // R2-2: an accepted query must mean what it says. `null` and `{}` under a
  // field name both compile to NO condition downstream (buildWhereClause
  // skips `null`; `{}` has no operator keys), so accepting them would let a
  // query the author wrote as filtered silently return every row instead.
  // ---------------------------------------------------------------------
  describe("R2-2: a condition that compiles to nothing is refused, not silently accepted", () => {
    it("refuses `null` as a field's condition", () => {
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { status: null },
        })
      ).toThrow(
        /where condition for "status" is null, which matches every row/
      );
    });

    it("refuses an empty object as a field's condition", () => {
      expect(() =>
        validateWidgetQuery({
          source: "collection:posts",
          op: "count",
          where: { status: {} },
        })
      ).toThrow(
        /where condition for "status" is empty, which matches every row/
      );
    });
  });

  // ---------------------------------------------------------------------
  // The read-once invariant covers the WHOLE query, not just `where`.
  // `validateWidgetQuery` is public API, so the caller's object may be a
  // Proxy or carry accessors. An earlier commit closed this for `where` and
  // left its four family members open: a `sort` getter answering "title" to
  // the guard and "-secretScore" to the return spread yields a certified
  // query whose sort was never checked.
  // ---------------------------------------------------------------------
  describe("every field is read exactly once, not just `where`", () => {
    /** Counts reads per property and hands back a different value after the first. */
    function hostile(benign: Record<string, unknown>, hostileValue: unknown) {
      const reads: Record<string, number> = {};
      const target: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(benign)) {
        reads[key] = 0;
        Object.defineProperty(target, key, {
          enumerable: true,
          get() {
            reads[key] += 1;
            return reads[key] === 1 ? value : hostileValue;
          },
        });
      }
      return { target, reads };
    }

    it("reads every property of the caller's object exactly once", () => {
      const { target, reads } = hostile(
        {
          source: "collection:posts",
          op: "count",
          where: { status: { equals: "draft" } },
          status: "draft",
          select: ["title"],
          sort: "-updatedAt",
          limit: 5,
        },
        "-secretScore"
      );

      validateWidgetQuery(target);

      expect(reads).toEqual({
        source: 1,
        op: 1,
        where: 1,
        status: 1,
        select: 1,
        sort: 1,
        limit: 1,
      });
    });

    it("returns the `sort` it validated, never a later answer from the same getter", () => {
      let reads = 0;
      const query = {
        source: "collection:posts",
        op: "count",
        get sort() {
          reads += 1;
          return reads === 1 ? "title" : "-secretScore";
        },
      };

      // Either outcome is acceptable SECURITY: refusing is fine. What is not
      // acceptable is certifying `title` and returning `-secretScore`.
      const q = validateWidgetQuery(query);
      expect(q.sort).toBe("title");
    });

    it("returns the `select` it validated, never a later answer from the same getter", () => {
      let reads = 0;
      const query = {
        source: "collection:posts",
        op: "list",
        get select() {
          reads += 1;
          return reads === 1 ? ["title"] : ["secretScore"];
        },
      };

      const q = validateWidgetQuery(query);
      expect(q.select).toEqual(["title"]);
    });

    it("returns the `status` it validated, never a later answer from the same getter", () => {
      let reads = 0;
      const query = {
        source: "collection:posts",
        op: "count",
        get status() {
          reads += 1;
          return reads === 1 ? "draft" : "everything";
        },
      };

      const q = validateWidgetQuery(query);
      expect(q.status).toBe("draft");
    });

    it("returns the `op` it validated, never a later answer from the same getter", () => {
      let reads = 0;
      const query = {
        source: "collection:posts",
        get op() {
          reads += 1;
          return reads === 1 ? "count" : "timeseries";
        },
      };

      const q = validateWidgetQuery(query);
      expect(q.op).toBe("count");
    });

    it("copies `select` so a later mutation of the caller's array cannot reach it", () => {
      // The array ELEMENTS are read once too: validating the caller's array
      // and returning a spread of it is two reads of each index.
      const select = ["title"];
      const q = validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        select,
      });
      select[0] = "secretScore";
      expect(q.select).toEqual(["title"]);
    });
  });
});

describe("a geo filter means what it says or is refused", () => {
  // `near` and `within` were recognised as operators and their values only
  // shape-checked, so `"not-a-location"` passed. Downstream `extractGeoFilters`
  // parses the string, adds NO filter when parsing fails, and leaves nothing in
  // `cleanedWhere` either -- so an accepted query ran with no condition at all
  // and both `list` and `count` answered over the WHOLE collection. Validated
  // here with the canonical parsers the executor itself uses.
  beforeEach(() => {
    registerSource({
      id: "collection:places",
      label: "Places",
      kind: "collection",
      supports: ["count", "list"],
      fields: [{ name: "location", type: "string" }],
    });
  });

  const near = (value: unknown) => () =>
    validateWidgetQuery({
      source: "collection:places",
      op: "list",
      where: { location: { near: value } },
    });

  it("accepts a well-formed near value", () => {
    const query = near("-74.006,40.7128,10000")();
    expect(query.where).toEqual({
      location: { near: "-74.006,40.7128,10000" },
    });
  });

  it("accepts a well-formed near value carrying a unit", () => {
    expect(near("-74.006,40.7128,10,km")).not.toThrow();
  });

  it("accepts a well-formed within value", () => {
    expect(() =>
      validateWidgetQuery({
        source: "collection:places",
        op: "list",
        where: { location: { within: "-74.006,40.7128,5000" } },
      })
    ).not.toThrow();
  });

  it("refuses an unparseable near value", () => {
    expect(near("not-a-location")).toThrow(
      /where operator "near" on field "location" is not a valid near filter/
    );
  });

  it("refuses coordinates outside the world", () => {
    // The parser's own bounds, rather than a second opinion about latitude.
    expect(near("-999,40.7128,10000")).toThrow(/is not a valid near filter/);
  });

  it("refuses a near value missing its distance", () => {
    expect(near("-74.006,40.7128")).toThrow(/is not a valid near filter/);
  });

  it("refuses an unparseable within value", () => {
    expect(() =>
      validateWidgetQuery({
        source: "collection:places",
        op: "list",
        where: { location: { within: "-74.006,40.7128,0" } },
      })
    ).toThrow(/is not a valid within filter/);
  });

  it("refuses a non-string geo value", () => {
    // `extractGeoFilters` only looks at a geo operator whose value is a string,
    // so a number is dropped exactly as an unparseable string is.
    expect(near(10000)).toThrow(/is not a valid near filter/);
  });

  it("refuses a geo filter nested inside a combinator", () => {
    // The walk reaches every depth, so the guard has to as well.
    expect(() =>
      validateWidgetQuery({
        source: "collection:places",
        op: "list",
        where: { and: [{ location: { near: "not-a-location" } }] },
      })
    ).toThrow(/is not a valid near filter/);
  });
});

describe("a geo filter cannot be counted", () => {
  // `countEntries` refuses a geo predicate unconditionally: it evaluates them in
  // memory over rows a count never fetches, and `buildWhereClause` emits no SQL
  // for them, so a total that ignored one would describe every candidate the
  // filter was meant to exclude. A VALID geo value therefore used to pass this
  // validator and fail its batch slot at execution -- the contract's promise is
  // that an accepted query is one the executor will run, so the refusal belongs
  // here.
  beforeEach(() => {
    registerSource({
      id: "collection:places",
      label: "Places",
      kind: "collection",
      supports: ["count", "list"],
      fields: [{ name: "location", type: "string" }],
    });
  });

  const counting = (where: unknown) => () =>
    validateWidgetQuery({
      source: "collection:places",
      op: "count",
      where,
    });

  it("refuses a valid near filter under count", () => {
    expect(counting({ location: { near: "-74.006,40.7128,10000" } })).toThrow(
      /where operator "near" on field "location" cannot be counted/
    );
  });

  it("refuses a valid within filter under count", () => {
    expect(counting({ location: { within: "-74.006,40.7128,5000" } })).toThrow(
      /where operator "within" on field "location" cannot be counted/
    );
  });

  it("refuses a geo filter a combinator hides under count", () => {
    expect(
      counting({ and: [{ location: { near: "-74.006,40.7128,10000" } }] })
    ).toThrow(/cannot be counted/);
  });

  // The controls. Without them the refusals above are satisfied by a validator
  // that refuses every geo operator, or every `count`.
  it("still accepts the same geo filter under list", () => {
    expect(() =>
      validateWidgetQuery({
        source: "collection:places",
        op: "list",
        where: { location: { near: "-74.006,40.7128,10000" } },
      })
    ).not.toThrow();
  });

  it("still accepts a non-geo filter under count", () => {
    expect(counting({ location: { equals: "here" } })).not.toThrow();
  });
});
