/**
 * The three dialect tables are hand-mirrored from `./postgres.ts`, so a column
 * added to one and forgotten in another is the failure to catch. Comparing
 * NAME SETS rather than counts means a rename plus an addition cannot cancel
 * out and read as agreement.
 *
 * @module schemas/jobs/__tests__/parity.test
 */
import { Column, is, type Table } from "drizzle-orm";
import { describe, it, expect } from "vitest";

import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import { my, pg, sl } from "../index";
import { JOB_STATES } from "../types";

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
 * Both the property name and the database column name are compared, for the
 * reason the releases mirror gives: keeping the property while mistyping the
 * snake_case name passes a property-only comparison and produces a table the
 * others cannot be read alongside.
 */
const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

describe("the job table is identical across dialects", () => {
  it("nextly_jobs has the same columns everywhere", () => {
    const canonical = columnNames(pg.nextlyJobsPg);
    // The control: if this ever reads as empty, the comparisons below are
    // satisfied by absence and prove nothing about either dialect.
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(my.nextlyJobsMysql)).toEqual(canonical);
    expect(columnNames(sl.nextlyJobsSqlite)).toEqual(canonical);
  });

  it("carries the lease pair, without which two runners can run one job", () => {
    // Named rather than left to the set comparison above: that comparison is
    // satisfied by three dialects agreeing, INCLUDING three dialects that all
    // dropped the lease together. The claim in `jobs-repository` is built on
    // exactly these two columns.
    for (const table of [
      pg.nextlyJobsPg,
      my.nextlyJobsMysql,
      sl.nextlyJobsSqlite,
    ]) {
      expect(columnNames(table)).toContain("lockedBy:locked_by");
      expect(columnNames(table)).toContain("lockedUntil:locked_until");
    }
  });

  it("carries run_as_user_id, which the fail-closed identity rule reads", () => {
    // Also named: a job that loses this column does not fail, it runs as
    // NOBODY — which applies no field rules at all. Losing it would keep every
    // dialect in agreement while removing the access boundary.
    for (const table of [
      pg.nextlyJobsPg,
      my.nextlyJobsMysql,
      sl.nextlyJobsSqlite,
    ]) {
      expect(columnNames(table)).toContain("runAsUserId:run_as_user_id");
    }
  });
});

describe("job states", () => {
  it("lists every state exactly once", () => {
    expect([...JOB_STATES]).toEqual(["pending", "running", "done", "failed"]);
  });
});

/**
 * Declaring the Drizzle tables does not create them. A core table reaches a
 * real database only if it is ALSO in the core schema snapshot and in
 * `CORE_TABLE_NAMES`, which is what db:sync and boot-apply read. Missing that
 * step fails in the least visible way available: the SQLite bootstrap DDL
 * still creates the table, so the feature works on one dialect and is absent
 * on the other two.
 */
describe("nextly_jobs is registered as a core table", () => {
  it("is named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain("nextly_jobs");
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "appears in the %s core schema snapshot",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      // The control: an empty snapshot would satisfy the assertion below by
      // absence and prove nothing about registration.
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("nextly_jobs");
    }
  );
});
