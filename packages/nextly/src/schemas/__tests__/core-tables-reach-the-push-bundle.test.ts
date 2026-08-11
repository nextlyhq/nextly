/**
 * Every core table has to reach the two registries that are not the one it was
 * declared in.
 *
 * There are THREE, and they answer different questions.
 * `getCoreSchema()` describes tables. `getDialectTables()` is what
 * `ensureFirstRunSetup` and `reconcileCore` hand to drizzle-kit, and therefore
 * what decides whether a table exists at all. `getCoreTableNames()` is what
 * those same callers introspect the live database with, and therefore what
 * decides whether an existing table is SEEN.
 *
 * Missing from the second, a table looks completely wired: its DDL renders, a
 * fixture built from `getCoreSchema` creates it, and every unit test passes —
 * against a table no real installation has. Missing from the third, the table
 * is created and then absent from every live snapshot, so the drift check
 * proposes adding it again on every run.
 */

import { describe, expect, it } from "vitest";

import { getDialectTables } from "../../database/index";
import { getCoreSchema, getCoreTableNames } from "../index";

/**
 * Both registries take the same dialect names.
 *
 * Worth stating, because assuming they differed is how an earlier version of
 * this file threw on PostgreSQL and reported only the other two.
 */
const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

/** Table names present in the bundle handed to drizzle-kit. */
function pushedTableNames(dialect: string): Set<string> {
  const bundle = getDialectTables(dialect) as Record<string, unknown>;
  const names = new Set<string>();
  for (const value of Object.values(bundle)) {
    // A Drizzle table carries its SQL name on a well-known symbol. Reading it
    // rather than the export's key, because the two differ by design — the
    // bundle re-exports `emailProvidersPg` as `emailProviders`.
    const symbols = Object.getOwnPropertySymbols(value as object);
    for (const symbol of symbols) {
      if (!symbol.description?.includes("Name")) continue;
      const name = (value as Record<symbol, unknown>)[symbol];
      if (typeof name === "string") names.add(name);
    }
  }
  return names;
}

describe("core tables reach the bundle that creates them", () => {
  it.each(DIALECTS)("%s", dialect => {
    const pushed = pushedTableNames(dialect);
    const missing = getCoreSchema(dialect)
      .tables.map(table => table.name)
      .filter(name => !pushed.has(name));

    // Named rather than counted: a diff that says "3 missing" sends the reader
    // to the wrong file, while one that names `email_deliveries` does not.
    expect(missing).toEqual([]);
  });

  it.each(DIALECTS)(
    "%s reaches the names the live snapshot is read with",
    dialect => {
      const managed = new Set(getCoreTableNames());
      const missing = getCoreSchema(dialect)
        .tables.map(table => table.name)
        .filter(name => !managed.has(name));

      expect(missing).toEqual([]);
    }
  );

  it("reads real table names, not an empty set", () => {
    // The control. If the symbol lookup above stopped finding names, every
    // assertion would compare an empty list against an empty list and pass
    // while checking nothing.
    const pushed = pushedTableNames("sqlite");
    expect(pushed.size).toBeGreaterThan(5);
    expect(pushed).toContain("email_providers");

    // The same control for the third registry, for the same reason.
    expect(getCoreTableNames().length).toBeGreaterThan(5);
    expect(getCoreTableNames()).toContain("email_providers");
  });
});
