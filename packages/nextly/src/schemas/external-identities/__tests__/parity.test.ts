/**
 * The external identities' table is hand-mirrored across three dialects, so
 * a column added to one and forgotten in another is the failure to catch.
 * And declaring a table does not create it: it reaches a database only
 * through the core schema snapshot, `CORE_TABLE_NAMES` and the dialect
 * bundle that the push creates. A table in some of those and not others
 * works on one dialect and is absent on the rest.
 *
 * Uniqueness rests on the digest, so the properties it rests on are checked
 * here as well: the key's three columns are unbounded text on every dialect
 * (no width can refuse a valid issuer or subject on one alone), the unique
 * index covers the digest column alone, and the digest helper itself is
 * deterministic — the same identity key always digests to the same value,
 * and anything else digests elsewhere.
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
import { externalIdentityKeyDigest } from "../index";
import * as idsMy from "../mysql";
import * as idsPg from "../postgres";
import * as idsSl from "../sqlite";
import { EXTERNAL_IDENTITIES_TABLE } from "../table-name";

// Every dialect's tables this file reads, loaded explicitly rather than by
// the unit setup's default-config accident: the run's own dialect is loaded
// by the setup, the other two here, so no dialect's declaration is read
// half-initialized.
beforeAll(async () => {
  await Promise.all(
    ["postgresql", "mysql", "sqlite"].map(d => loadDialectTables(d))
  );
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

/** A column part that names no column: an index declared over an expression. */
const EXPRESSION = "(expression)";

/** The indexes a table declares, by physical column name, in order. */
function declaredIndexes(
  indexes: ReadonlyArray<{
    config: { name: string; columns: ReadonlyArray<unknown>; unique?: boolean };
  }>
): DeclaredIndex[] {
  return indexes.map(({ config }) => ({
    name: config.name,
    unique: Boolean(config.unique),
    // An index may be declared over a SQL EXPRESSION rather than a column,
    // and such an entry carries no name. Kept as a marker rather than
    // dropped, so an index's position and count stay visible: a dropped
    // part and an absent one are indistinguishable in the lists below.
    columns: config.columns.map(column =>
      column && typeof column === "object" && "name" in column
        ? String((column as { name: unknown }).name)
        : EXPRESSION
    ),
  }));
}

/**
 * A column's declared kind and bound, read structurally because the shared
 * column types declare neither `columnType` nor `length` on their common
 * base: only each dialect's concrete subclasses carry them. A structural
 * read of the properties this file pins, not an escape from typing.
 */
function columnShape(column: unknown): {
  columnType: string | undefined;
  length: number | undefined;
} {
  const shape = column as { columnType?: unknown; length?: unknown };
  return {
    columnType:
      typeof shape.columnType === "string" ? shape.columnType : undefined,
    length: typeof shape.length === "number" ? shape.length : undefined,
  };
}

/** One dialect's column by physical name, from its `getTableConfig`. */
function columnOf(
  dialect: "postgresql" | "mysql" | "sqlite",
  name: string
): unknown {
  const configs = {
    postgresql: getPgTableConfig(idsPg.nextlyExternalIdentitiesPg),
    mysql: getMyTableConfig(idsMy.nextlyExternalIdentitiesMysql),
    sqlite: getSlTableConfig(idsSl.nextlyExternalIdentitiesSqlite),
  } as const;
  const column = configs[dialect].columns.find(column => column.name === name);
  expect(column, `${name} is declared on ${dialect}`).toBeDefined();
  return column;
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
      "keyDigest:key_digest",
      "providerKey:provider_key",
      "subject:subject",
      "userId:user_id",
    ]);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "declares the issuer as NOT NULL on %s",
    dialect => {
      // The property the digest rests on: "no issuer" has one spelling, so
      // every writer frames the same string and derives the same digest.
      const issuer = columnOf(dialect, "issuer") as { notNull?: unknown };
      expect(issuer.notNull).toBe(true);
    }
  );

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "holds the key's three columns as unbounded text on %s",
    dialect => {
      // No width this table picked can refuse a valid issuer or subject on
      // one dialect alone: an issuer is a URL of the provider's choosing
      // and OIDC permits a subject of up to 255 ASCII characters. The
      // column's KIND is the assertion — MySQL's `text` still reports a
      // 65535-byte capacity as its `length`, which is the type's own
      // ceiling, not a bound this table chose.
      const expected = {
        postgresql: "PgText",
        mysql: "MySqlText",
        sqlite: "SQLiteText",
      }[dialect];
      for (const name of ["provider_key", "issuer", "subject"]) {
        expect(columnShape(columnOf(dialect, name)).columnType).toBe(expected);
      }
    }
  );

  it("bounds the digest to the codebase's 64 hex characters where a bound is needed", () => {
    // The one indexed column is the digest, held as the codebase spells a
    // hex digest: 64 characters, the width of a SHA-256. MySQL cannot index
    // `text`; PostgreSQL and SQLite can, and SQLite's declaration is text —
    // the bound matters where the index needs it, not as a limit on what a
    // digest may be, which the algorithm fixes.
    expect(columnShape(columnOf("mysql", "key_digest")).length).toBe(64);
    expect(columnShape(columnOf("postgresql", "key_digest")).length).toBe(64);
    expect(columnShape(columnOf("sqlite", "key_digest")).columnType).toBe(
      "SQLiteText"
    );
  });

  it.each([
    ["postgresql", getPgTableConfig(idsPg.nextlyExternalIdentitiesPg)],
    ["mysql", getMyTableConfig(idsMy.nextlyExternalIdentitiesMysql)],
    ["sqlite", getSlTableConfig(idsSl.nextlyExternalIdentitiesSqlite)],
  ] as const)("keys an identity by its digest alone on %s", (_, config) => {
    const unique = declaredIndexes(config.indexes).filter(
      index => index.unique
    );
    // The control: no unique index at all would fail the lookup below with a
    // confusing undefined rather than the missing column set.
    expect(unique.length).toBeGreaterThan(0);
    expect(unique).toContainEqual({
      name: "nextly_external_identities_key_uidx",
      columns: ["key_digest"],
      unique: true,
    });
  });
});

describe("the identity key digest", () => {
  it("digests the same identity to the same value, every time", () => {
    // Determinism is the whole contract: uniqueness across installs and
    // writers survives only if the digest never depends on when or where
    // it is computed. Plain SHA-256, no key, no salt, no clock.
    const first = externalIdentityKeyDigest(
      "sso/oidc",
      "https://issuer.example",
      "1082719283756102937102"
    );
    expect(first).toBe(
      externalIdentityKeyDigest(
        "sso/oidc",
        "https://issuer.example",
        "1082719283756102937102"
      )
    );
    // And its shape is the digest column's bound: 64 lowercase hex.
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("digests anything else elsewhere, including one byte away", () => {
    const base = externalIdentityKeyDigest(
      "sso/oidc",
      "https://i.example",
      "Alice"
    );
    // One flipped byte in each part, in turn.
    expect(
      externalIdentityKeyDigest("sso/OIDC", "https://i.example", "Alice")
    ).not.toBe(base);
    expect(
      externalIdentityKeyDigest("sso/oidc", "https://j.example", "Alice")
    ).not.toBe(base);
    expect(
      externalIdentityKeyDigest("sso/oidc", "https://i.example", "alice")
    ).not.toBe(base);
    // A trailing space is a different byte, not padding to be folded: the
    // PAD SPACE collations cannot reach into the digest.
    expect(
      externalIdentityKeyDigest("sso/oidc", "https://i.example", "Alice ")
    ).not.toBe(base);
  });

  it("frames the three parts, so no tuple boundary can blur", () => {
    // Length-framed, not delimiter-joined: ("ab", "c") and ("a", "bc") hold
    // the same characters, and a digest over a plain concatenation would
    // collapse two identities into one row. The frame keeps the boundary.
    expect(externalIdentityKeyDigest("ab", "c", "subject")).not.toBe(
      externalIdentityKeyDigest("a", "bc", "subject")
    );
    expect(externalIdentityKeyDigest("sso", "ab", "c")).not.toBe(
      externalIdentityKeyDigest("sso", "a", "bc")
    );
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
