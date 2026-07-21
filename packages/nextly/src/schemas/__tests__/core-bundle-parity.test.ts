/**
 * Every managed core table must be reachable from BOTH maps.
 *
 * Two independent structures describe the core schema and they are used for
 * different halves of the same run: `getCoreSchema` is the desired side of
 * the diff, and the flat `_dialect-bundles` map is what the apply hands to
 * drizzle-kit. Declaring a table in the first alone makes it *diffable* but
 * not *creatable* — the reconcile proposes `add_table` for it on every run,
 * the push never emits DDL for it, and the table never appears. It converges
 * on nothing, forever, while reporting success.
 *
 * `nextly_i18n_archive` shipped in exactly that state. The per-table
 * registration tests did not catch it because they assert membership of
 * `CORE_TABLE_NAMES` and `getCoreSchema` only — which it had — so this
 * asserts the relationship between the two maps instead of either alone.
 */
import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDialectTables } from "../../database";
import { CORE_TABLE_NAMES } from "../index";

const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

/** Table names reachable from a dialect bundle, as the push would see them. */
function bundleTableNames(dialect: string): Set<string> {
  const tables = getDialectTables(dialect) as Record<string, unknown>;
  const names = new Set<string>();
  for (const value of Object.values(tables)) {
    if (isTable(value)) names.add(getTableName(value));
  }
  return names;
}

describe.each(DIALECTS)("core table bundle parity (%s)", dialect => {
  it("exposes every CORE_TABLE_NAMES entry to the apply path", () => {
    const bundled = bundleTableNames(dialect);
    const missing = CORE_TABLE_NAMES.filter(name => !bundled.has(name));

    // Named rather than counted: the failure message has to say which table
    // will silently never be created, because that is the whole symptom.
    expect(missing).toEqual([]);
  });
});
