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
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { nextlyJobsSqlite } from "../../schemas/jobs/sqlite";
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

  /**
   * Core tables this bootstrap does not create, as measured.
   *
   * Every entry is a GAP, not a decision. A fresh SQLite database built from
   * this fallback has none of them, so anything touching them fails against
   * it — and the fallback exists precisely for the non-TTY case where
   * `pushSchema` could not run, which is where nobody is watching.
   *
   * Listed rather than left implicit for two reasons: the list can only
   * shrink, and a core table with no DDL and no entry here fails this guard
   * rather than someone's first insert. The comparison further down iterates
   * the DDL's own tables, so on its own it catches a column that drifted and
   * never a table that was never written; that is the gap this list closes.
   */
  const NOT_BOOTSTRAPPED = new Set([
    "activity_log",
    "api_keys",
    "audit_log",
    "dynamic_collections",
    "dynamic_singles",
    "email_providers",
    "email_templates",
    "image_sizes",
    "nextly_events",
    "nextly_meta",
    "nextly_schema_events",
    "nextly_webhook_deliveries",
    "nextly_webhooks",
    "user_field_definitions",
    "user_invite_tokens",
  ]);

  it("creates every core table, or names the ones it does not", () => {
    // Asked in the direction the per-table comparison cannot: that one
    // iterates the DDL's own tables, so a core table absent from the DDL is
    // invisible to it however far its columns drift.
    const missing = [...schemas.keys()].filter(
      table => !ddl.has(table) && !NOT_BOOTSTRAPPED.has(table)
    );

    expect(
      missing,
      `these core tables have no bootstrap DDL: ${missing.join(", ")}. A ` +
        "database created from this fallback will not have them, and every " +
        "query against them fails. Add the DDL, or add the table to " +
        "NOT_BOOTSTRAPPED with the reason."
    ).toEqual([]);
  });

  /*
   * Indexes, for `nextly_jobs` only.
   *
   * The column comparison above cannot see an index: a missing one breaks no
   * insert, it makes a query slow, which is why `nextly_jobs_recent_idx` was
   * declared on all three dialects and created on none. Scoped to this table
   * rather than generalized because the same probe reports ten pre-existing
   * omissions on `dynamic_collections` and `dynamic_components`, and deciding
   * what those should be is a separate change from asserting this one.
   */
  it("creates every index the jobs schema declares", () => {
    const statements = generateSqliteCoreTableStatements().join("\n");
    const declared = getTableConfig(nextlyJobsSqlite).indexes.map(
      index => index.config.name
    );
    const missing = declared.filter(name => !statements.includes(`"${name}"`));
    expect(
      missing,
      `nextly_jobs: the bootstrap DDL never creates ${missing.join(", ")}, so ` +
        "the declaration is decorative on every SQLite database built from it"
    ).toEqual([]);
    // The premise: this compared real index names rather than an empty list.
    expect(declared.length).toBeGreaterThan(1);
  });

  it("does not carry exclusions for tables that no longer exist", () => {
    // An exclusion outliving its table turns the list above into folklore.
    const stale = [...NOT_BOOTSTRAPPED].filter(table => !schemas.has(table));
    expect(stale).toEqual([]);
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
