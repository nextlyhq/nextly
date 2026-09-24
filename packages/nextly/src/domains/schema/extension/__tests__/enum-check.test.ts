/**
 * An enum column's values have to be enforced by something.
 *
 * `col.enum()` renders as text on every dialect, which is honest about the
 * storage and said nothing about the values: the column accepted any string.
 * The values were carried as far as the DSL's resolved column and read by
 * nothing.
 */
import { describe, expect, it } from "vitest";

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
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const spec = toTableSpec(table(["open", "closed"]), dialect);
      expect(spec.checks).toContainEqual({
        name: "ck_fx__orders_state_enum",
        sql: "state IN ('open', 'closed')",
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
    expect(
      enumCheckName("fx__orders", { name: "state", enumName: "order_state" })
    ).toBe("order_state");
  });

  it("escapes a value containing a quote", () => {
    // The values come from config rather than a request, but a config is
    // still text somebody typed and this string becomes DDL.
    expect(
      enumCheckSql({ name: "s", enumValues: ["it's"] }, "postgresql")
    ).toBe("s IN ('it''s')");
  });

  it("keeps DECLARATION order rather than sorting", () => {
    // Sorting would make a reorder invisible, which sounds harmless until an
    // author reorders and the pipeline reports no change while the stored
    // constraint says something else.
    const spec = toTableSpec(table(["b", "a"]), "postgresql");
    expect(spec.checks?.[0]?.sql).toBe("state IN ('b', 'a')");
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

  it("says nothing about an expression it did not write", () => {
    // The control. A hand-written check is not an enum, and guessing at one
    // would report removals from a constraint that never listed values.
    expect(enumValuesIn("price > 0")).toBeNull();
    expect(removedEnumValues("price > 0", "price > 10")).toEqual([]);
  });
});
