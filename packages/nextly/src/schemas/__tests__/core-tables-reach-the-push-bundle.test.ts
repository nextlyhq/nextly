/**
 * Every core table has to be in the bundle that CREATES tables.
 *
 * There are two registries and they answer different questions.
 * `getCoreSchema()` describes tables; `getDialectTables()` is what
 * `ensureFirstRunSetup` and `reconcileCore` hand to drizzle-kit, and therefore
 * what decides whether a table exists at all.
 *
 * A table registered in the first and missed in the second looks completely
 * wired: its DDL renders, a fixture built from `getCoreSchema` creates it, and
 * every unit test passes — against a table no real installation has.
 */

import { describe, expect, it } from "vitest";

import { getDialectTables } from "../../database/index";
import { getCoreSchema } from "../index";

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

  it("reads real table names, not an empty set", () => {
    // The control. If the symbol lookup above stopped finding names, every
    // assertion would compare an empty list against an empty list and pass
    // while checking nothing.
    const pushed = pushedTableNames("sqlite");
    expect(pushed.size).toBeGreaterThan(5);
    expect(pushed).toContain("email_providers");
  });
});
