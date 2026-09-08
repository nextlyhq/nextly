/**
 * The three dialect tables are hand-mirrored from `./postgres.ts`, so a column
 * added to one and forgotten in another is the failure to catch. Comparing
 * NAME SETS rather than counts means a rename plus an addition cannot cancel
 * out and read as agreement.
 *
 * @module schemas/releases/__tests__/parity.test
 */
import { Column, is, type Table } from "drizzle-orm";
import { describe, it, expect } from "vitest";

import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import { my, pg, sl } from "../index";
import { RELEASE_MEMBER_ACTIONS, RELEASE_STATES } from "../types";

/**
 * Read the columns by asking Drizzle what each property IS, rather than by
 * enumerating the object.
 *
 * A table object also carries dialect-specific METHODS as own enumerable
 * properties — `enableRLS` exists on the pg builder and on neither of the
 * others — so a bare `Object.keys` reports a difference that is not a column
 * and never could be. `is(value, Column)` keeps exactly the columns, and it is
 * not the deprecated whole-table column helper the drizzle-legacy gate
 * rejects: that helper still compiles on v1, so the compiler cannot catch its
 * use and the gate is what does. Naming it here is not possible either — the
 * gate greps source text, so a comment mentioning it fails the same check.
 *
 * Both the property name and the database column name are compared: a mirror
 * that keeps the property and mistypes the snake_case name would otherwise
 * pass while producing a table the others cannot be read alongside — and a
 * mirror that keeps the column name while renaming the property would pass a
 * comparison of database names alone, while breaking every caller that reads
 * the column through the table object.
 */
const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

describe("release tables are identical across dialects", () => {
  it("nextly_releases has the same columns everywhere", () => {
    const canonical = columnNames(pg.nextlyReleasesPg);
    // The control: if this ever reads as empty, the comparisons below are
    // satisfied by absence and prove nothing about either dialect.
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(my.nextlyReleasesMysql)).toEqual(canonical);
    expect(columnNames(sl.nextlyReleasesSqlite)).toEqual(canonical);
  });

  it("nextly_release_members has the same columns everywhere", () => {
    const canonical = columnNames(pg.nextlyReleaseMembersPg);
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(my.nextlyReleaseMembersMysql)).toEqual(canonical);
    expect(columnNames(sl.nextlyReleaseMembersSqlite)).toEqual(canonical);
  });

  it("carries the member_key digest column, which the uniqueness rule needs", () => {
    // Named rather than left to the set comparison: `locale` is nullable and
    // SQL treats NULL as distinct from NULL, so without this column a unique
    // index cannot stop two unlocalized members for one document in one
    // release. Losing it would keep every dialect in agreement and silently
    // remove the constraint.
    for (const table of [
      pg.nextlyReleaseMembersPg,
      my.nextlyReleaseMembersMysql,
      sl.nextlyReleaseMembersSqlite,
    ]) {
      expect(columnNames(table)).toContain("memberKey:member_key");
    }
  });
});

describe("release enums", () => {
  it("lists every state and action exactly once", () => {
    expect([...RELEASE_STATES]).toEqual([
      "draft",
      "scheduled",
      "published",
      "cancelled",
      // A release the drain will never be able to apply. Listed last because
      // the order is the lifecycle's, and this is the only state reached by
      // failing rather than by anyone deciding anything.
      "blocked",
    ]);
    expect([...RELEASE_MEMBER_ACTIONS]).toEqual(["publish", "unpublish"]);
  });
});

/**
 * Declaring the Drizzle tables does not create them. A core table reaches a
 * real database only if it is ALSO in the core schema snapshot and in
 * `CORE_TABLE_NAMES`, which is what db:sync and boot-apply read. Missing that
 * step fails in the least visible way available: the SQLite bootstrap DDL
 * still creates the tables, so the feature works on one dialect and is absent
 * on the other two.
 */
describe("the release tables are registered as core tables", () => {
  it("is named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain("nextly_releases");
    expect(CORE_TABLE_NAMES).toContain("nextly_release_members");
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "appears in the %s core schema snapshot",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      // The control: an empty snapshot would satisfy neither assertion below
      // for the right reason, so assert it read something first.
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("nextly_releases");
      expect(names).toContain("nextly_release_members");
    }
  );
});
