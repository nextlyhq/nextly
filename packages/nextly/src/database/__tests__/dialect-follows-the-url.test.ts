/**
 * A dialect nobody stated must be read from the URL by every reader, not just
 * by the factory.
 *
 * `DB_DIALECT` carried a Zod default, so it was never absent, so the factory's
 * URL fallback behind it could not run. The cost was not only the adapter:
 * `getDialectTables` picks the entire schema from that one value, `QUOTE_CHAR`
 * picks identifier quoting from it, and `toDialectBool` decides whether `true`
 * is stored as 1. An operator who set only `DATABASE_URL=mysql://...`, which
 * the adapter READMEs say is enough, got PostgreSQL for all of them.
 *
 * `getDialectTables` stands for the group here. `toDialectBool` reaches env
 * through the `@nextly/lib/env` alias, which this vitest project does not
 * resolve, and that is a pre-existing condition rather than anything this
 * change introduced.
 *
 * Asserted through the readers rather than through the resolver, because the
 * resolver being right is not the property that matters.
 */
import { afterEach, describe, expect, it } from "vitest";

import { _resetEnvCache, env } from "../../shared/lib/env";
import { getDialectTables } from "../index";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  _resetEnvCache();
});

/** Point the process at a URL with no DB_DIALECT, the way the READMEs describe. */
function onlyTheUrl(url: string) {
  process.env = { ...original, NODE_ENV: "development", DATABASE_URL: url };
  delete process.env.DB_DIALECT;
  _resetEnvCache();
}

describe("a URL the operator did not pair with a dialect", () => {
  it("is read as MySQL by every reader", () => {
    onlyTheUrl("mysql://u:p@localhost:3306/app");
    expect(env.DB_DIALECT).toBe("mysql");
    // Identity against the explicit answers, so the assertion does not restate
    // which schema object is which.
    expect(getDialectTables()).toBe(getDialectTables("mysql"));
    expect(getDialectTables()).not.toBe(getDialectTables("postgresql"));
  });

  it("is read as SQLite by every reader", () => {
    onlyTheUrl("file:./data/nextly.db");
    expect(env.DB_DIALECT).toBe("sqlite");
    expect(getDialectTables()).toBe(getDialectTables("sqlite"));
    expect(getDialectTables()).not.toBe(getDialectTables("postgresql"));
  });

  it("is still read as PostgreSQL when the URL says so", () => {
    onlyTheUrl("postgresql://u:p@localhost:5432/app");
    expect(env.DB_DIALECT).toBe("postgresql");
    expect(getDialectTables()).toBe(getDialectTables("postgresql"));
  });
});
