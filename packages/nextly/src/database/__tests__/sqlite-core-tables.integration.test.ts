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
 * The columns covered by every UNIQUE index in the built database.
 *
 * Read back rather than inferred. A UNIQUE constraint spelled inline — on the
 * column, or as `UNIQUE(a, b)` at the end of the table — produces an implicit
 * `sqlite_autoindex_*` whose name this DDL never chose. Comparing NAMES alone
 * calls those absent; comparing the columns they cover asks the question that
 * matters, which is whether the uniqueness exists at all.
 */
function uniqueIndexColumns(db: Database.Database, table: string): Set<string> {
  const covered = new Set<string>();
  const list = db.prepare(`PRAGMA index_list("${table}")`).all() as {
    name: string;
    unique: number;
  }[];
  for (const entry of list) {
    if (entry.unique !== 1) continue;
    const cols = db.prepare(`PRAGMA index_info("${entry.name}")`).all() as {
      name: string | null;
    }[];
    covered.add(cols.map(column => column.name ?? "?").join(","));
  }
  return covered;
}

/**
 * Declared indexes that the built database does not have.
 *
 * Scoped to tables this fallback creates: the ones it does not are the sibling
 * suite's NOT_BOOTSTRAPPED list, and they have no indexes here because they
 * have no table here.
 */
function indexesDeclaredButAbsent(
  db: Database.Database,
  tables: Set<string>,
  indexes: Set<string>
): string[] {
  return bootstrappedConfigs(tables).flatMap(config => {
    const uniques = uniqueIndexColumns(db, config.name);
    return config.indexes
      .filter(index => {
        if (indexes.has(index.config.name)) return false;
        // Absent under its own name. It still exists if a UNIQUE constraint
        // covers exactly these columns.
        if (!index.config.unique) return true;
        const columns = index.config.columns
          .map(column => ("name" in column ? column.name : "?"))
          .join(",");
        return !uniques.has(columns);
      })
      .map(index => `${config.name}.${index.config.name}`);
  });
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
      db,
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

  /**
   * The upgrade case, which is the one that reaches existing installations.
   *
   * Modelled as what the previous bootstrap actually produced: its CREATE
   * TABLE statements, minus the registry tables this change adds, and none of
   * the index statements. Re-running the full set against that must supply the
   * difference — which is the whole reason the caller reconciles an existing
   * SQLite database rather than returning as soon as it sees `users`.
   */
  it("supplies what a database created by an earlier bootstrap lacks", () => {
    const REGISTRY = [
      "dynamic_collections",
      "dynamic_singles",
      "dynamic_components",
    ];
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    for (const statement of generateSqliteCoreTableStatements()) {
      if (!statement.includes("CREATE TABLE")) continue;
      if (REGISTRY.some(table => statement.includes(`"${table}"`))) continue;
      db.exec(statement);
    }

    // The premise: this really is a database missing what the change adds.
    expect(namesOfType(db, "table").size).toBeGreaterThan(15);
    expect(namesOfType(db, "table").has("dynamic_singles")).toBe(false);
    expect(namesOfType(db, "index").has("media_folder_id_idx")).toBe(false);

    for (const statement of generateSqliteCoreTableStatements()) {
      db.exec(statement);
    }

    const tables = namesOfType(db, "table");
    const indexes = namesOfType(db, "index");
    expect(tables.has("dynamic_singles")).toBe(true);
    expect(indexes.has("media_folder_id_idx")).toBe(true);
    expect(indexesDeclaredButAbsent(db, tables, indexes)).toEqual([]);
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
