/**
 * The test fixture schema must not drift from the tables it claims to mirror.
 *
 * `_fixture-schema/unified.ts` is a hand-written description of core tables
 * that `setup.ts`'s CREATE TABLE shortcut emits directly. Hand-written copies
 * of a schema drift, and this one drifts silently: a database built from it
 * simply lacks the column, and code that decides what a database supports by
 * looking for one reads the fixture as an older schema and takes a different
 * path than production would.
 *
 * The fixture is deliberately a SUBSET — it declares the tables that shortcut
 * needs, not every core table — so completeness is not asserted here. What is
 * asserted is that a table it does declare matches the real one, which is the
 * condition under which a test built on it observes production behaviour.
 */
import { describe, expect, it } from "vitest";

import { generateCreateTableSql } from "./_fixture-schema/generator";
import { getCoreSchema } from "../../schemas/index";
import { nextlyTables } from "./_fixture-schema/unified";

/**
 * There is no exemption list any more, and that is the point.
 *
 * This file used to carry `PREDATES_THIS_CHECK`, naming four tables whose
 * fixture definitions had drifted from production. The premise was that no
 * consumer read those columns — which stopped being true for `users` when a
 * helper test began inserting real rows through the adapter, and stopped being
 * true for the rest once the fixture gained a table resolver and a caller could
 * reach them via `adapter.select`. `dynamic_collections` then failed with
 * `no such column: "slug"`: the resolver named the production table while the
 * DDL created the legacy one.
 *
 * All four are now corrected — 26 columns added and 4 stale ones removed — so
 * the set is empty. An empty exemption kept "in case" is the shape this
 * repository has been bitten by before (two dead LAYOUT_FIELD_TYPES sets, each
 * under a comment promising behaviour the code could not deliver), so it is
 * deleted rather than emptied. Every fixture table is checked, and a new
 * divergence has nowhere to hide.
 */

/** Column names per core table, as the pipeline actually compiles them. */
function productionColumns(): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  // PostgreSQL is the reference dialect: column NAMES are dialect-independent,
  // and the fixture describes types abstractly and translates them at emit.
  for (const table of getCoreSchema("postgresql").tables) {
    byTable.set(table.name, new Set(table.columns.map(column => column.name)));
  }
  return byTable;
}

describe("fixture schema parity", () => {
  it("declares every column the real table has", () => {
    const production = productionColumns();
    const drift: string[] = [];

    for (const fixture of nextlyTables) {
      const real = production.get(fixture.name);
      // A fixture-only table is not drift: the fixture carries a couple of
      // scratch tables that exist for its own tests and no production table.
      if (!real) continue;

      const declared = new Set(fixture.columns.map(column => column.name));
      const missing = [...real].filter(name => !declared.has(name));
      if (missing.length > 0) {
        drift.push(`${fixture.name} is missing ${missing.join(", ")}`);
      }
    }

    expect(drift).toEqual([]);
  });

  it("declares no column the real table dropped", () => {
    const production = productionColumns();
    const stale: string[] = [];

    for (const fixture of nextlyTables) {
      const real = production.get(fixture.name);
      if (!real) continue;

      const extra = fixture.columns
        .map(column => column.name)
        .filter(name => !real.has(name));
      if (extra.length > 0) {
        stale.push(`${fixture.name} still declares ${extra.join(", ")}`);
      }
    }

    expect(stale).toEqual([]);
  });
});

/**
 * Column NAMES are dialect-independent, so the check above compares them. Types
 * are not: the fixture describes them abstractly and the generator translates
 * at emit time, so the only thing worth asserting is what it actually emits.
 *
 * The erasure stamp is the case that matters. MySQL can rewrite a nullable
 * TIMESTAMP into NOT NULL DEFAULT CURRENT_TIMESTAMP, so a row whose identity
 * was never erased would read as erased — on the dialect this fixture exists to
 * exercise, and in the direction that quietly claims data was removed when it
 * was not.
 */
describe("emitted erasure stamp", () => {
  const auditLog = nextlyTables.find(table => table.name === "audit_log");

  it("is a MySQL DATETIME, which cannot be rewritten", () => {
    const sql = generateCreateTableSql(auditLog!, "mysql");
    expect(sql).toMatch(/`identity_erased_at`\s+DATETIME/i);
    expect(sql).not.toMatch(/`identity_erased_at`\s+TIMESTAMP/i);
  });

  it("is a SQLite INTEGER, as the production column is", () => {
    // The production definition is `integer(..., { mode: "timestamp" })`, so a
    // TEXT column here would read and write differently from the table this
    // fixture stands in for.
    const sql = generateCreateTableSql(auditLog!, "sqlite");
    expect(sql).toMatch(/"identity_erased_at"\s+INTEGER/i);
    expect(sql).not.toMatch(/"identity_erased_at"\s+TEXT/i);
  });
});
