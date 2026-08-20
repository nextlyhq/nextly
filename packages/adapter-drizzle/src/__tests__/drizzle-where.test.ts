import {
  PgDialect,
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { buildDrizzleWhere } from "../drizzle-where";
import { WHERE_OPERATORS } from "../types";

import type { WhereClause, WhereCondition, WhereOperator } from "../types";

/**
 * Every assertion here compiles the returned condition to SQL text and parameters rather than
 * checking that a condition came back at all.
 *
 * The difference is not stylistic. A suite that asserts only "a condition was produced" passes
 * against an implementation whose `>` emits `<` and whose `or` emits `and` — both were tried
 * against the earlier form of these tests and both stayed green. What the adapter hands the
 * database is rendered SQL and a parameter list, so that is what is compared: an operator
 * mapped to the wrong drizzle helper, a parameter dropped, or a nested clause flattened all
 * change the text or the params, and none of them can hide behind a defined object.
 *
 * Compiling through `PgDialect` fixes one rendering for the comparison; the builder itself is
 * dialect-agnostic (it composes drizzle helpers and never emits text), and `drizzle-orm` is
 * pinned to an exact version repo-wide, so the rendered spellings below are stable.
 */

const testTable = pgTable("test_table", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age"),
  is_active: boolean("is_active"),
  created_at: timestamp("created_at"),
});

/**
 * Compiles a clause, refusing an absent condition rather than reporting it as empty SQL. A
 * builder that silently returned `undefined` would otherwise read here as "no filter", which is
 * the difference between selecting one row and selecting the whole table.
 */
function compile(where: WhereClause): { sql: string; params: unknown[] } {
  const condition = buildDrizzleWhere(testTable, where);
  if (condition === undefined) {
    throw new Error(
      `expected a condition for ${JSON.stringify(where)}, got undefined`
    );
  }
  const { sql, params } = new PgDialect().sqlToQuery(condition);
  return { sql, params };
}

/**
 * One case per operator the builder implements, each naming the SQL it must produce. A new
 * operator that is added to the switch without a row here shows up as an untested branch rather
 * than as a passing suite.
 */
const OPERATOR_CASES: ReadonlyArray<{
  operator: WhereOperator;
  condition: WhereCondition;
  sql: string;
  params: unknown[];
}> = [
  {
    operator: "=",
    condition: { column: "name", op: "=", value: "Mobeen" },
    sql: `"test_table"."name" = $1`,
    params: ["Mobeen"],
  },
  {
    operator: "!=",
    condition: { column: "name", op: "!=", value: "Mobeen" },
    sql: `"test_table"."name" <> $1`,
    params: ["Mobeen"],
  },
  {
    operator: ">",
    condition: { column: "age", op: ">", value: 18 },
    sql: `"test_table"."age" > $1`,
    params: [18],
  },
  {
    operator: "<",
    condition: { column: "age", op: "<", value: 100 },
    sql: `"test_table"."age" < $1`,
    params: [100],
  },
  {
    operator: ">=",
    condition: { column: "age", op: ">=", value: 18 },
    sql: `"test_table"."age" >= $1`,
    params: [18],
  },
  {
    operator: "<=",
    condition: { column: "age", op: "<=", value: 65 },
    sql: `"test_table"."age" <= $1`,
    params: [65],
  },
  {
    operator: "LIKE",
    condition: { column: "name", op: "LIKE", value: "%test%" },
    sql: `"test_table"."name" like $1`,
    params: ["%test%"],
  },
  {
    operator: "ILIKE",
    condition: { column: "name", op: "ILIKE", value: "%test%" },
    sql: `"test_table"."name" ilike $1`,
    params: ["%test%"],
  },
  {
    operator: "IN",
    condition: { column: "name", op: "IN", value: ["Alice", "Bob"] },
    sql: `"test_table"."name" in ($1, $2)`,
    params: ["Alice", "Bob"],
  },
  {
    operator: "NOT IN",
    condition: { column: "name", op: "NOT IN", value: ["Alice", "Bob"] },
    sql: `"test_table"."name" not in ($1, $2)`,
    params: ["Alice", "Bob"],
  },
  {
    operator: "IS NULL",
    condition: { column: "age", op: "IS NULL" },
    sql: `("test_table"."age" is null)`,
    params: [],
  },
  {
    operator: "IS NOT NULL",
    condition: { column: "age", op: "IS NOT NULL" },
    sql: `("test_table"."age" is not null)`,
    params: [],
  },
  {
    operator: "BETWEEN",
    condition: { column: "age", op: "BETWEEN", value: 18, valueTo: 65 },
    sql: `"test_table"."age" between $1 and $2`,
    params: [18, 65],
  },
  {
    operator: "NOT BETWEEN",
    condition: { column: "age", op: "NOT BETWEEN", value: 0, valueTo: 10 },
    sql: `"test_table"."age" not between $1 and $2`,
    params: [0, 10],
  },
  {
    // CONTAINS is deliberately not JSON containment: the builder degrades it to a substring
    // LIKE. The `escape` clause is part of that translation, not decoration — see the literal
    // matching cases below.
    operator: "CONTAINS",
    condition: { column: "name", op: "CONTAINS", value: "test" },
    sql: `"test_table"."name" like $1 escape '!'`,
    params: ["%test%"],
  },
];

/**
 * Operators the builder does NOT implement, and refuses at runtime. They belong to the same
 * public union as the ones above, so a caller reaches them without a type error.
 */
const REFUSED_OPERATORS: readonly WhereOperator[] = ["OVERLAPS"];

describe("buildDrizzleWhere", () => {
  describe("a clause that asks for nothing, and one that asks and gets nothing", () => {
    // `undefined` is not a neutral return value here. `update` and `delete` take the where
    // clause as a REQUIRED argument and omit the WHERE entirely when none comes back, so
    // whatever produces `undefined` produces a whole-table statement. That makes the line
    // between the two groups below a data-safety boundary rather than a style question: a
    // caller who asked for no filter gets one, and a caller whose filter evaporated is refused.

    it("returns undefined for an empty where clause", () => {
      expect(buildDrizzleWhere(testTable, {})).toBeUndefined();
    });

    it("returns undefined when every branch is present but empty", () => {
      // No member was named, so nothing was dropped. This is still "no filter".
      expect(buildDrizzleWhere(testTable, { and: [], or: [] })).toBeUndefined();
    });

    it.each<[string, WhereClause]>([
      ["a not over an empty clause", { not: {} }],
      ["a not over an empty branch", { not: { and: [] } }],
      ["an and whose only member is empty", { and: [{}] }],
      ["an or whose only member is empty", { or: [{}] }],
      ["a nested branch that resolves to nothing", { and: [{ or: [] }] }],
      ["a nested not that resolves to nothing", { and: [{ not: {} }] }],
    ])("refuses %s rather than matching every row", (_label, where) => {
      expect(() => buildDrizzleWhere(testTable, where)).toThrow(
        /produced no condition/
      );
    });

    it("still drops a no-op member that sits beside a real one", () => {
      // The refusal is about a clause producing NOTHING, not about every member producing
      // something: an empty conjunct alongside a real condition contributes no constraint and
      // narrows nothing, so it stays a silent no-op rather than becoming an error.
      expect(
        compile({ and: [{}, { column: "age", op: ">", value: 1 }] })
      ).toEqual({
        sql: `"test_table"."age" > $1`,
        params: [1],
      });
    });
  });

  describe("operators", () => {
    it.each(OPERATOR_CASES)(
      "translates $operator to the matching SQL",
      ({ condition, sql, params }) => {
        expect(compile({ and: [condition] })).toEqual({ sql, params });
      }
    );

    it("describes every operator the package declares, as supported or as refused", () => {
      // Compared against `WHERE_OPERATORS` — the runtime array `WhereOperator` is derived from —
      // rather than against a count or a list retyped here. That is what makes this a guard
      // instead of a restatement: a hand-kept copy would have to be edited to fail, so it could
      // only ever agree with itself, whereas adding a member to the declared operators and
      // nowhere else fails this immediately.
      const described = [
        ...OPERATOR_CASES.map(entry => entry.operator),
        ...REFUSED_OPERATORS,
      ].sort();
      expect(described).toEqual([...WHERE_OPERATORS].sort());
    });

    // The metacharacter-free case is the operator table's `CONTAINS` row above, not repeated
    // here; the partition assertion keeps that row from being deleted, so it holds the control
    // for these.
    it.each([
      ["a percent", "a%b", "%a!%b%"],
      ["an underscore", "a_b", "%a!_b%"],
      ["the escape character itself", "a!b", "%a!!b%"],
      ["all of them at once", "100%_!", "%100!%!_!!%"],
    ])(
      "CONTAINS matches %s literally, escaping the LIKE metacharacters",
      (_label, value, pattern) => {
        // Without the escaping, `CONTAINS "a%b"` is the pattern `%a%b%`, which matches anything
        // with an a before a b. Verified against live engines rather than reasoned about: on
        // PostgreSQL 17, MySQL 8.4 and SQLite the escaped pattern matches 1 row of a 6-row
        // fixture and the unescaped one matches 5.
        expect(
          compile({ and: [{ column: "name", op: "CONTAINS", value }] })
        ).toEqual({
          sql: `"test_table"."name" like $1 escape '!'`,
          params: [pattern],
        });
      }
    );

    it("binds a value rather than inlining it", () => {
      // A Date reaching the statement text instead of the parameter list would be both a
      // formatting bug and an injection surface, and it renders as valid SQL either way.
      const at = new Date("2020-01-01T00:00:00.000Z");
      expect(
        compile({ and: [{ column: "created_at", op: ">", value: at }] })
      ).toEqual({
        sql: `"test_table"."created_at" > $1`,
        params: ["2020-01-01T00:00:00.000Z"],
      });
    });
  });

  describe("composition", () => {
    it("wraps in and only once there is more than one part, keeping their order", () => {
      // Two facts in one case on purpose. The single-part shortcut is a real branch, and every
      // row of the operator table above reads through it — asserting the unwrapped shape on its
      // own would just be a second copy of the `=` row, so what is asserted is the CONTRAST.
      expect(
        compile({ and: [{ column: "name", op: "=", value: "Mobeen" }] })
      ).toEqual({
        sql: `"test_table"."name" = $1`,
        params: ["Mobeen"],
      });
      expect(
        compile({
          and: [
            { column: "name", op: "=", value: "Mobeen" },
            { column: "age", op: ">", value: 18 },
          ],
        })
      ).toEqual({
        sql: `(("test_table"."name" = $1) and ("test_table"."age" > $2))`,
        params: ["Mobeen", 18],
      });
    });

    it("joins several OR conditions with or", () => {
      expect(
        compile({
          or: [
            { column: "name", op: "=", value: "Alice" },
            { column: "name", op: "=", value: "Bob" },
          ],
        })
      ).toEqual({
        sql: `(("test_table"."name" = $1) or ("test_table"."name" = $2))`,
        params: ["Alice", "Bob"],
      });
    });

    it("ANDs the or-branch onto the and-branch, never flattening the two together", () => {
      expect(
        compile({
          and: [{ column: "is_active", op: "=", value: true }],
          or: [
            { column: "name", op: "=", value: "Alice" },
            { column: "name", op: "=", value: "Bob" },
          ],
        })
      ).toEqual({
        sql:
          `(("test_table"."is_active" = $1) and ` +
          `((("test_table"."name" = $2) or ("test_table"."name" = $3))))`,
        params: [true, "Alice", "Bob"],
      });
    });

    it("recurses into a clause nested in an and array", () => {
      // Same meaning as the sibling-branch case above, written the other way round: a nested
      // clause must produce the grouped OR, not be mistaken for a condition and dropped by the
      // `column`/`op` type guard.
      expect(
        compile({
          and: [
            { column: "is_active", op: "=", value: true },
            {
              or: [
                { column: "name", op: "=", value: "Alice" },
                { column: "name", op: "=", value: "Bob" },
              ],
            },
          ],
        })
      ).toEqual({
        sql:
          `(("test_table"."is_active" = $1) and ` +
          `((("test_table"."name" = $2) or ("test_table"."name" = $3))))`,
        params: [true, "Alice", "Bob"],
      });
    });

    it("negates a single condition", () => {
      expect(
        compile({ not: { column: "name", op: "=", value: "Alice" } })
      ).toEqual({
        sql: `not ("test_table"."name" = $1)`,
        params: ["Alice"],
      });
    });

    it("negates a nested clause as a whole", () => {
      // The negation has to wrap the composed group. Negating the parts individually would
      // turn "not (A or B)" into "not A or not B", which selects a different set of rows.
      expect(
        compile({
          not: {
            or: [
              { column: "name", op: "=", value: "Alice" },
              { column: "age", op: ">", value: 5 },
            ],
          },
        })
      ).toEqual({
        sql: `not ((("test_table"."name" = $1) or ("test_table"."age" > $2)))`,
        params: ["Alice", 5],
      });
    });
  });

  describe("refusals", () => {
    it("refuses a column the table does not declare, and says which are available", () => {
      expect(() =>
        buildDrizzleWhere(testTable, {
          and: [{ column: "nonexistent", op: "=", value: "test" }],
        })
      ).toThrow(
        `Column "nonexistent" not found in table. Available: id, name, age, is_active, created_at`
      );
    });

    // A declared operator the builder does not implement type-checks at every call site and
    // throws at runtime, so the refusal is the behaviour callers actually get. Pinning it means
    // implementing one is a change that has to come here and move it into the table above,
    // rather than a gap that closes silently.
    it.each(REFUSED_OPERATORS)(
      "refuses the declared but unimplemented %s",
      op => {
        expect(() =>
          buildDrizzleWhere(testTable, {
            and: [{ column: "name", op, value: ["a"] }],
          })
        ).toThrow(`Unsupported operator: ${op}`);
      }
    );
  });
});
