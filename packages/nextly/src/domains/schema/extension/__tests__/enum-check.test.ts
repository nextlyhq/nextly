/**
 * An enum column's values have to be enforced by something.
 *
 * `col.enum()` renders as text on every dialect, which is honest about the
 * storage and said nothing about the values: the column accepted any string.
 * The values were carried as far as the DSL's resolved column and read by
 * nothing.
 */
import { describe, expect, it } from "vitest";

import { normalizeCheckExpression } from "../../pipeline/diff/normalize-check";
import { toTableSpec } from "../compile";
import { col, defineTable } from "../dsl";
import {
  enumCheckName,
  enumCheckSql,
  enumValuesIn,
  removedEnumValues,
} from "../enum-check";
import type { ExtensionTable } from "../types";

const table = (values: readonly string[]): ExtensionTable => ({
  name: "fx__orders",
  authored: "orders",
  owner: { kind: "plugin", id: "fx" },
  columns: defineTable("orders", {
    id: col.id(),
    state: col.enum(values as [string, ...string[]]),
  }).columns.map(c => ({ ...c })),
  indexes: [],
});

describe("an enum column's permitted values", () => {
  it("become a CHECK on every dialect", () => {
    // One mechanism, three dialects. A native PostgreSQL enum type, MySQL's
    // inline ENUM and SQLite's nothing-at-all would be three lifecycles; the
    // pipeline already diffs, emits and introspects checks everywhere.
    const quoted = {
      postgresql: '"state"',
      mysql: "`state`",
      sqlite: '"state"',
    };
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const spec = toTableSpec(table(["open", "closed"]), dialect);
      expect(spec.checks).toContainEqual({
        name: "ck_fx__orders_state_enum",
        sql: `${quoted[dialect]} IN ('open', 'closed')`,
      });
    }
  });

  it("names the constraint from the table and column", () => {
    // Derived, not invented: live introspection reads the name off the
    // server, and a differently generated name reads as a constraint to drop
    // and another to add, on every comparison.
    expect(enumCheckName("fx__orders", { name: "state" })).toBe(
      "ck_fx__orders_state_enum"
    );
    // An explicit name replaces the column's part, never the table's.
    expect(
      enumCheckName("fx__orders", { name: "state", enumName: "order_state" })
    ).toBe("ck_fx__orders_order_state");
  });

  it("escapes a value containing a quote", () => {
    // The values come from config rather than a request, but a config is
    // still text somebody typed and this string becomes DDL.
    expect(
      enumCheckSql({ name: "s", enumValues: ["it's"] }, "postgresql")
    ).toBe(`"s" IN ('it''s')`);
  });

  it("writes a backslash value as hex on MySQL, and plainly elsewhere", () => {
    // Under MySQL's default sql_mode `'back\slash'` means `backslash`, which
    // would refuse every row holding the declared value. The hex literal says
    // the declared value whatever the mode; the other dialects read a
    // backslash as itself.
    const values = ["a", "back\\slash"];
    expect(enumCheckSql({ name: "s", enumValues: values }, "mysql")).toBe(
      "`s` IN ('a', _utf8mb4 X'6261636b5c736c617368')"
    );
    expect(enumCheckSql({ name: "s", enumValues: values }, "postgresql")).toBe(
      `"s" IN ('a', 'back\\slash')`
    );
    expect(
      enumValuesIn(
        enumCheckSql({ name: "s", enumValues: values }, "mysql") ?? ""
      )
    ).toEqual(values);
  });

  it("keeps DECLARATION order rather than sorting", () => {
    // Sorting would make a reorder invisible, which sounds harmless until an
    // author reorders and the pipeline reports no change while the stored
    // constraint says something else.
    const spec = toTableSpec(table(["b", "a"]), "postgresql");
    expect(spec.checks?.[0]?.sql).toBe(`"state" IN ('b', 'a')`);
  });

  it("produces no check when the column is not an enum", () => {
    expect(enumCheckSql({ name: "s" }, "postgresql")).toBeUndefined();
    expect(
      enumCheckSql({ name: "s", enumValues: [] }, "postgresql")
    ).toBeUndefined();
  });
});

/** The enum constraint this value set compiles to, on PostgreSQL. */
function checkFor(values: readonly string[]): { name: string; sql: string } {
  const check = toTableSpec(table(values), "postgresql").checks?.[0];
  if (check === undefined) throw new Error("expected an enum check");
  return check;
}

describe("changing an enum's values", () => {
  it("ADDING one is an ordinary check change", () => {
    // Which the diff already turns into drop_check + add_check, on every
    // dialect, with no new machinery.
    const before = checkFor(["open"]);
    const after = checkFor(["open", "closed"]);

    expect(before.name).toBe(after.name);
    expect(before.sql).not.toBe(after.sql);
    expect(removedEnumValues(before.sql, after.sql)).toEqual([]);
  });

  it("REMOVING one is named, because the database will refuse it", () => {
    // A CHECK cannot be added while an existing row violates it, so the
    // refusal is already correct — what is missing without this is a usable
    // message. `check constraint "ck_..." is violated by some row` does not
    // say which value stopped being allowed.
    expect(
      removedEnumValues(
        checkFor(["open", "closed"]).sql,
        checkFor(["open"]).sql
      )
    ).toEqual(["closed"]);
  });

  it("reads its own expression back", () => {
    expect(enumValuesIn("state IN ('open', 'closed')")).toEqual([
      "open",
      "closed",
    ]);
    expect(enumValuesIn("state IN ('it''s')")).toEqual(["it's"]);
  });

  it("reads the expression PostgreSQL reports for a live constraint", () => {
    // pg_get_constraintdef's spelling of `state IN ('open', 'closed')` on a
    // varchar column, and of a one-value set, which it stores as an equality.
    const live =
      "((state)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying])::text[]))";
    expect(enumValuesIn(live)).toEqual(["open", "closed"]);
    expect(enumValuesIn("((state)::text = 'open'::text)")).toEqual(["open"]);
    // MySQL's CHECK_CLAUSE for the same two shapes, escaping layer removed.
    expect(
      enumValuesIn("(`state` in (_utf8mb4'open',_utf8mb4'it\\'s'))")
    ).toEqual(["open", "it's"]);
    expect(enumValuesIn("(`state` = _utf8mb4'open')")).toEqual(["open"]);
    expect(removedEnumValues(live, "state IN ('open')")).toEqual(["closed"]);
  });

  it("does not read two value sets as one", () => {
    expect(enumValuesIn("a IN ('x', 'y') AND b IN ('z', 'w')")).toBeNull();
  });

  it("says nothing about an expression it did not write", () => {
    // The control. A hand-written check is not an enum, and guessing at one
    // would report removals from a constraint that never listed values.
    expect(enumValuesIn("price > 0")).toBeNull();
    expect(removedEnumValues("price > 0", "price > 10")).toEqual([]);
  });
});

describe("an enum check on a column named like a keyword", () => {
  // Server output recorded from PostgreSQL 17 (`pg_get_constraintdef`, CHECK
  // wrapper removed) and MySQL 8.0.46 (SHOW CREATE TABLE) for a column
  // declared `user` / `order` with the values 'a' and 'b'.
  const PG_QUOTED_USER = `(("user" = ANY (ARRAY['a'::text, 'b'::text])))`;
  const MYSQL_ORDER = "((`order` in (_utf8mb4'a',_utf8mb4'b')))";

  it("names the column on PostgreSQL, where bare `user` is CURRENT_USER", () => {
    const declared = enumCheckSql(
      { name: "user", enumValues: ["a", "b"] },
      "postgresql"
    );
    expect(normalizeCheckExpression(declared ?? "")).toBe(
      normalizeCheckExpression(PG_QUOTED_USER)
    );
  });

  it("names the column on MySQL, where bare `order` does not parse", () => {
    const declared = enumCheckSql(
      { name: "order", enumValues: ["a", "b"] },
      "mysql"
    );
    expect(declared?.startsWith("`order` IN")).toBe(true);
    expect(normalizeCheckExpression(declared ?? "")).toBe(
      normalizeCheckExpression(MYSQL_ORDER)
    );
  });

  it("still reads the values back from the quoted form", () => {
    expect(enumValuesIn(PG_QUOTED_USER)).toEqual(["a", "b"]);
    expect(
      enumValuesIn(
        enumCheckSql({ name: "order", enumValues: ["a", "b"] }, "mysql") ?? ""
      )
    ).toEqual(["a", "b"]);
  });
});

describe("an enum check's name", () => {
  it("scopes an explicit name by its table, so two tables may share it", () => {
    // MySQL check names are unique across the schema: one verbatim name on
    // two tables fails the second CREATE TABLE.
    const a = enumCheckName("fx__orders", { name: "s", enumName: "status" });
    const b = enumCheckName("fx__invoices", { name: "s", enumName: "status" });
    expect(a).toBe("ck_fx__orders_status");
    expect(b).toBe("ck_fx__invoices_status");
  });

  it("fits every dialect and stays distinct when the table and column are long", () => {
    // A plain truncation also fits 63 characters, and would give these two
    // columns — which share their first 50 characters — the same name.
    const tableName = `fx__${"t".repeat(55)}`;
    const first = enumCheckName(tableName, { name: `${"c".repeat(50)}_one` });
    const second = enumCheckName(tableName, { name: `${"c".repeat(50)}_two` });
    expect(first.length).toBeLessThanOrEqual(63);
    expect(second.length).toBeLessThanOrEqual(63);
    expect(first).not.toBe(second);
    // Deterministic: live introspection must be able to find it again.
    expect(enumCheckName(tableName, { name: `${"c".repeat(50)}_one` })).toBe(
      first
    );
  });
});
