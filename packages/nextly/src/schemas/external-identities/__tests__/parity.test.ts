/**
 * The external identities' table is hand-mirrored across three dialects, so
 * a column added to one and forgotten in another is the failure to catch.
 * And declaring a table does not create it: it reaches a database only
 * through the core schema snapshot, `CORE_TABLE_NAMES` and the dialect
 * bundle that the push creates. A table in some of those and not others
 * works on one dialect and is absent on the rest.
 *
 * The uniqueness this table exists to enforce rests on two declared
 * properties, checked here as well: `issuer` is NOT NULL — an issuerless
 * provider writes "" so the index holds on every dialect, where a NULL the
 * database treated as distinct would let the same issuerless subject in
 * twice — and the unique index covers the provider key, the issuer and the
 * subject in that order.
 *
 * @module schemas/external-identities/__tests__/parity.test
 */
import { Column, getTableName, is, isTable, type Table } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database";
import { loadDialectTables } from "../../../database/dialect-tables";
import { getTableConfig as getMyTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as getSlTableConfig } from "drizzle-orm/sqlite-core";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import * as idsMy from "../mysql";
import * as idsPg from "../postgres";
import * as idsSl from "../sqlite";
import { EXTERNAL_IDENTITIES_TABLE } from "../table-name";

// The postgresql and mysql tables this file reads; the unit setup loads only
// the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await Promise.all(["postgresql", "mysql"].map(d => loadDialectTables(d)));
});

/** Property and column name of every column, as `notices`' parity test reads them. */
const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

/** One index as the three dialects' `getTableConfig` report it. */
interface DeclaredIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

/** The unique indexes a table declares, by physical column name, in order. */
function declaredIndexes(
  indexes: ReadonlyArray<{
    config: { name: string; columns: ReadonlyArray<unknown>; unique?: boolean };
  }>
): DeclaredIndex[] {
  return indexes.map(({ config }) => ({
    name: config.name,
    unique: Boolean(config.unique),
    // An index may be declared over a SQL EXPRESSION rather than a column,
    // and such an entry carries no name; dropping it is correct here, as the
    // same guard in the SQLite bootstrap parity test is.
    columns: config.columns
      .map(column =>
        column && typeof column === "object" && "name" in column
          ? String((column as { name: unknown }).name)
          : ""
      )
      .filter(name => name !== ""),
  }));
}

describe("the external identities' table is identical across dialects", () => {
  it("has the same columns everywhere", () => {
    const canonical = columnNames(idsPg.nextlyExternalIdentitiesPg);
    // The control: an empty list would satisfy both comparisons by absence.
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(idsMy.nextlyExternalIdentitiesMysql)).toEqual(canonical);
    expect(columnNames(idsSl.nextlyExternalIdentitiesSqlite)).toEqual(
      canonical
    );
  });

  it("holds an identity's own facts, and nothing else", () => {
    // The whole surface, spelled out: a column that is not one of these is
    // not an identity's own fact — most importantly a provider token, which
    // this table must never hold, would have to arrive as a new column and
    // so cannot slip past an exact list.
    expect(columnNames(idsPg.nextlyExternalIdentitiesPg)).toEqual([
      "address:address",
      "createdAt:created_at",
      "id:id",
      "issuer:issuer",
      "providerKey:provider_key",
      "subject:subject",
      "userId:user_id",
    ]);
  });

  it.each([
    ["postgresql", getPgTableConfig(idsPg.nextlyExternalIdentitiesPg)],
    ["mysql", getMyTableConfig(idsMy.nextlyExternalIdentitiesMysql)],
    ["sqlite", getSlTableConfig(idsSl.nextlyExternalIdentitiesSqlite)],
  ] as const)("declares the issuer as NOT NULL on %s", (_, config) => {
    // The property the issuerless scheme rests on: a nullable issuer would
    // make the same issuerless key and subject two rows on two dialects.
    const issuer = config.columns.find(column => column.name === "issuer");
    expect(issuer, "the issuer column is declared").toBeDefined();
    expect(issuer?.notNull).toBe(true);
  });

  it.each([
    ["postgresql", getPgTableConfig(idsPg.nextlyExternalIdentitiesPg)],
    ["mysql", getMyTableConfig(idsMy.nextlyExternalIdentitiesMysql)],
    ["sqlite", getSlTableConfig(idsSl.nextlyExternalIdentitiesSqlite)],
  ] as const)(
    "keys an identity by provider key, issuer and subject on %s",
    (_, config) => {
      const unique = declaredIndexes(config.indexes).filter(
        index => index.unique
      );
      // The control: no unique index at all would fail the lookup below with a
      // confusing undefined rather than the missing column set.
      expect(unique.length).toBeGreaterThan(0);
      expect(unique).toContainEqual({
        name: "nextly_external_identities_key_uidx",
        columns: ["provider_key", "issuer", "subject"],
        unique: true,
      });
    }
  );

  /**
   * The MySQL bounds, read structurally because the shared `MySqlColumn`
   * type declares neither a length nor a collation: only the varchar
   * subclass carries them. A structural read of the two properties this
   * test pins, not an escape from typing.
   */
  function mysqlVarcharShape(name: string): {
    length: number | undefined;
    collation: string | undefined;
  } {
    const column = getMyTableConfig(
      idsMy.nextlyExternalIdentitiesMysql
    ).columns.find(column => column.name === name);
    expect(column, `${name} is declared`).toBeDefined();
    const shape = column as unknown as {
      length?: unknown;
      collation?: unknown;
    };
    return {
      length: typeof shape.length === "number" ? shape.length : undefined,
      collation:
        typeof shape.collation === "string" ? shape.collation : undefined,
    };
  }

  it("widens the issuer and subject on MySQL to what OIDC permits", () => {
    // OIDC permits a `sub` of up to 255 ASCII characters and an issuer is a
    // URL of the provider's choosing; PostgreSQL and SQLite hold both as
    // unbounded text, so a narrower MySQL bound would refuse valid
    // identities on one dialect alone.
    expect(mysqlVarcharShape("issuer").length).toBe(255);
    expect(mysqlVarcharShape("subject").length).toBe(255);
    // The provider key keeps the 191 the codebase gives a provider, and the
    // unique index stays inside MySQL's 3072-byte key limit:
    // 191*4 + 255*4 + 255*4 = 2804.
    expect(mysqlVarcharShape("provider_key").length).toBe(191);
  });

  it("compares the key columns exactly on MySQL, byte for byte", () => {
    // Each of the three columns the unique index reads carries a binary
    // collation, overriding the case-insensitive one an install's MySQL
    // otherwise defaults to: without it, `Alice` and `alice` collide and a
    // distinct, valid subject is refused on MySQL alone, where the other
    // dialects compare text exactly.
    for (const name of ["provider_key", "issuer", "subject"]) {
      expect(mysqlVarcharShape(name).collation).toBe("utf8mb4_bin");
    }
    // The control: the address names no key, and keeps the table's default
    // collation like every other non-indexed text column in the codebase.
    expect(mysqlVarcharShape("address").collation).toBeUndefined();
  });
});

describe("the external identities' table is registered as a core table", () => {
  it("is named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain(EXTERNAL_IDENTITIES_TABLE);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "is in the %s core schema snapshot and in the bundle the push creates",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      expect(names.length).toBeGreaterThan(0);
      // The bundle is what actually creates tables; a table only in the
      // snapshot is proposed on every reconcile and created by none.
      const bundled = Object.values(getDialectTables(dialect))
        .filter(isTable)
        .map(table => getTableName(table));
      expect(names).toContain(EXTERNAL_IDENTITIES_TABLE);
      expect(bundled).toContain(EXTERNAL_IDENTITIES_TABLE);
    }
  );
});
