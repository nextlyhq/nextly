/**
 * The bootstrap DDL, executed.
 *
 * Its sibling unit suite compares the DDL's TEXT against the canonical Drizzle
 * schemas. That catches a column or an index the transcription forgot, and it
 * cannot catch a statement that is simply not valid SQL — both sides are read
 * from the same repository, and a string that mentions the right index name is
 * not the same claim as a database that has one.
 *
 * So this runs the statements against a real SQLite database and reads back
 * what exists. It is the oracle the string comparison stands in for, which
 * matters most for the parts nobody exercises by hand: this fallback runs only
 * where `pushSchema` could not, which is precisely where nobody is watching.
 *
 * @module database/__tests__/sqlite-core-tables.integration.test
 */
import Database from "better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import * as sqliteBundle from "../../schemas/_dialect-bundles/sqlite";
import { generateSqliteCoreTableStatements } from "../sqlite-core-tables";

/** A database built the way the non-TTY bootstrap builds one. */
function bootstrapped(): Database.Database {
  const db = new Database(":memory:");
  // On, because the DDL declares foreign keys and a statement naming a table
  // that does not exist yet must fail here rather than on someone's first boot.
  db.pragma("foreign_keys = ON");
  for (const statement of generateSqliteCoreTableStatements()) {
    db.exec(statement);
  }
  return db;
}

function namesOfType(
  db: Database.Database,
  type: "table" | "index"
): Set<string> {
  return new Set(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'`
        )
        .all(type) as { name: string }[]
    ).map(row => row.name)
  );
}

/** Every bundle table this fallback actually created. */
function bootstrappedConfigs(tables: Set<string>) {
  return Object.values(sqliteBundle).flatMap(value => {
    let config;
    try {
      config = getTableConfig(value as never);
    } catch {
      // Not a table — the bundle also re-exports relations and types.
      return [];
    }
    return config?.name && tables.has(config.name) ? [config] : [];
  });
}

/**
 * Whether SQLite carries this index under a name of its own choosing.
 *
 * A single-column UNIQUE spelled inline on the column produces an implicit
 * `sqlite_autoindex_*`, which the reads below exclude. Those are checked by
 * the sibling suite's inline-UNIQUE classification rather than reported absent
 * here.
 */
function isImplicitUnique(index: {
  config: { unique?: boolean; columns: unknown[] };
}) {
  return Boolean(index.config.unique) && index.config.columns.length === 1;
}

/**
 * Declared indexes that the built database does not have.
 *
 * Scoped to tables this fallback creates: the ones it does not are the sibling
 * suite's NOT_BOOTSTRAPPED list, and they have no indexes here because they
 * have no table here.
 */
function indexesDeclaredButAbsent(
  tables: Set<string>,
  indexes: Set<string>
): string[] {
  return bootstrappedConfigs(tables).flatMap(config =>
    config.indexes
      .filter(index => !isImplicitUnique(index))
      .filter(index => !indexes.has(index.config.name))
      .map(index => `${config.name}.${index.config.name}`)
  );
}

describe("the SQLite bootstrap DDL, executed", () => {
  it("runs every statement against a real database", () => {
    // The premise: a bootstrap that created almost nothing would satisfy every
    // "is it there" check below by having nothing to check.
    const db = bootstrapped();
    expect(namesOfType(db, "table").size).toBeGreaterThan(20);
    db.close();
  });

  it("creates every index it declares, as a real index", () => {
    const db = bootstrapped();
    const missing = indexesDeclaredButAbsent(
      namesOfType(db, "table"),
      namesOfType(db, "index")
    );

    expect(
      missing,
      `these indexes are declared by the schema and do not exist in a database ` +
        `built from the bootstrap DDL: ${missing.join(", ")}`
    ).toEqual([]);
    db.close();
  });

  it("is re-runnable, as the bootstrap re-runs it", () => {
    // Every statement is IF NOT EXISTS precisely so a later boot can restore a
    // missing index. If that were ever untrue the second run would throw.
    const db = bootstrapped();
    const before = namesOfType(db, "index").size;
    for (const statement of generateSqliteCoreTableStatements()) {
      db.exec(statement);
    }
    expect(namesOfType(db, "index").size).toBe(before);
    expect(before).toBeGreaterThan(50);
    db.close();
  });
});
