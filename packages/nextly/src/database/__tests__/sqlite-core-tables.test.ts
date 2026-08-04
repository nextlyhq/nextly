/**
 * The bootstrap DDL must describe the same tables the ORM writes to.
 *
 * `generateSqliteCoreTableStatements` is a hand-maintained transcription of the
 * canonical Drizzle schemas, and nothing derives one from the other: the
 * generated path needs drizzle-kit's push, which needs a TTY, and this DDL
 * exists precisely for the environments where that is unavailable. So the two
 * drift silently, and the failure is not subtle when it lands — Drizzle names
 * every column of a table in an INSERT, so one column missing here is not a
 * column the database does without, it is every write to that table failing
 * with `no column named …`.
 *
 * It had drifted twice: `users` was missing `must_change_password` and `media`
 * was missing `focal_x`, `focal_y` and `sizes`.
 *
 * Columns only. Types, defaults and constraints are deliberately out of scope:
 * SQLite's affinity rules make a type comparison mostly noise, and the failure
 * this guards is a column that is not there at all.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../sqlite-core-tables";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(here, "..", "..", "schemas");

/** Column names per table, as the bootstrap DDL declares them. */
function ddlColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const statement of generateSqliteCoreTableStatements()) {
    const table = /CREATE TABLE IF NOT EXISTS "([a-z_]+)"/.exec(statement)?.[1];
    if (table === undefined) continue;
    tables.set(
      table,
      new Set(
        [
          ...statement.matchAll(/"([a-z_]+)"\s+(?:TEXT|INTEGER|REAL|BLOB)/g),
        ].map(m => m[1])
      )
    );
  }
  return tables;
}

/** Column names per table, as the canonical `sqliteTable` definitions declare. */
function schemaColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const entry of readdirSync(SCHEMAS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let source: string;
    try {
      source = readFileSync(join(SCHEMAS_DIR, entry.name, "sqlite.ts"), "utf8");
    } catch {
      continue;
    }
    for (const m of source.matchAll(
      /sqliteTable\(\s*"([a-z_]+)"\s*,\s*\{([\s\S]*?)\n {2}\}/g
    )) {
      tables.set(
        m[1],
        new Set(
          [...m[2].matchAll(/\b(?:text|integer|real|blob)\("([a-z_]+)"/g)].map(
            c => c[1]
          )
        )
      );
    }
  }
  return tables;
}

describe("the SQLite bootstrap DDL", () => {
  const ddl = ddlColumns();
  const schemas = schemaColumns();

  it("reads back as tables at all", () => {
    // Both halves are parsed out of source text, so a parser that quietly
    // matched nothing would make every comparison below vacuously true.
    expect(ddl.size).toBeGreaterThan(10);
    expect(schemas.size).toBeGreaterThan(10);
  });

  it.each([...ddlColumns().keys()])(
    "declares every column the schema defines for %s",
    table => {
      const declared = schemas.get(table);
      // A table with no canonical `sqliteTable` is one this DDL owns outright;
      // there is nothing to compare it against.
      if (declared === undefined) return;

      const present = ddl.get(table) ?? new Set<string>();
      const missing = [...declared].filter(column => !present.has(column));
      expect(
        missing,
        `${table}: the bootstrap DDL omits ${missing.join(", ")}, so every ` +
          "insert naming those columns fails on a database created from it"
      ).toEqual([]);
    }
  );
});
