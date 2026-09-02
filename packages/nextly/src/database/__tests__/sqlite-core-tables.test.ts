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
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import * as sqliteBundle from "../../schemas/_dialect-bundles/sqlite";
import { generateSqliteCoreTableStatements } from "../sqlite-core-tables";

/** One table as the canonical Drizzle schema declares it. */
interface SchemaTable {
  columns: Set<string>;
  indexes: { name: string; columns: string[]; unique: boolean }[];
}

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

/**
 * Every core SQLite table, read from the dialect bundle rather than parsed.
 *
 * This used to regex the schema SOURCE for `sqliteTable("literal", { ... })`,
 * and that instrument was blind twice over. It could not see a table whose
 * name is COMPUTED — `dynamic_components` is built inside a factory from
 * `STORAGE_FORMAT.registryTable` — and it had already been widened once for a
 * call shape it could not match. Both failures are silent in the same
 * direction: a table the extractor cannot see is absent from every comparison
 * below, so it is not checked against the DDL at all. It passes by absence.
 *
 * The bundle is the right source because it is the same object graph the ORM
 * writes through and `reconcileCore` hands to drizzle-kit, so "what the schema
 * declares" is answered by the schema itself rather than by a pattern that
 * approximates it. It also carries indexes, which source text did not.
 */
function schemaTables(): Map<string, SchemaTable> {
  const tables = new Map<string, SchemaTable>();
  for (const value of Object.values(sqliteBundle)) {
    let config;
    try {
      config = getTableConfig(value as never);
    } catch {
      // Not a table — the bundle also re-exports relations and types.
      continue;
    }
    if (!config?.name) continue;
    tables.set(config.name, {
      columns: new Set(config.columns.map(column => column.name)),
      indexes: config.indexes.map(index => ({
        name: index.config.name,
        // An index may be declared over a SQL EXPRESSION rather than a column,
        // and such an entry carries no name. Dropping it is correct here: the
        // only thing column names are used for below is recognising a
        // single-column UNIQUE that the DDL spells inline, which an expression
        // index can never be.
        columns: index.config.columns
          .map(column => ("name" in column ? column.name : undefined))
          .filter((name): name is string => name !== undefined),
        unique: Boolean(index.config.unique),
      })),
    });
  }
  return tables;
}

describe("the SQLite bootstrap DDL", () => {
  const ddl = ddlColumns();
  const schemas = schemaTables();

  /**
   * Tables whose discovery is asserted BY NAME.
   *
   * A size floor is not enough, and that is not hypothetical: the previous
   * source-text extractor matched 38 tables while missing two completely, and
   * every count-based check stayed green. `dynamic_components` is built by a
   * factory from a COMPUTED name, and `nextly_i18n_archive` was the second.
   * Both were invisible to the pattern, so neither was ever compared against
   * the bootstrap DDL.
   *
   * These two are named because they are the ones that were actually missed.
   * A change that stops the bundle walk seeing either fails here, where the
   * message says which, rather than silently narrowing what the rest of this
   * file compares.
   */
  const TABLES_EXPECTED = ["dynamic_components", "nextly_i18n_archive"];

  it("reads back as tables at all", () => {
    // The DDL half is still parsed out of source text, so a parser that
    // quietly matched nothing would make every comparison below vacuously
    // true. The schema half now comes from the bundle, where the failure mode
    // is an empty export rather than a bad pattern; both are floored.
    expect(ddl.size).toBeGreaterThan(10);
    expect(schemas.size).toBeGreaterThan(10);
  });

  it.each(TABLES_EXPECTED)("discovers %s in the schema bundle", table => {
    expect(
      schemas.has(table),
      `the bundle walk did not find ${table}. Every comparison in this file ` +
        "iterates what it found, so a table it cannot see is not checked " +
        "against the bootstrap DDL at all -- it passes by absence."
    ).toBe(true);
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
    // These two were not a decision either: they were INVISIBLE. The schema
    // extractor above could not see a `sqliteTable("t", { ... })` written as a
    // single argument, so neither table reached `schemas` and neither could
    // ever appear in `missing`. Widening the pattern surfaced them, and they
    // are recorded here rather than given DDL in the same change that found
    // them -- transcribing `site_settings` by hand is how this file drifts, and
    // it is the drift this suite exists to catch. Both are real gaps: a
    // database built from this fallback has no general settings and no
    // migration lock.
    "nextly_field_group_lock",
    "site_settings",
    "api_keys",
    "audit_log",
    "email_providers",
    "email_templates",
    "image_sizes",
    "nextly_events",
    // Newly VISIBLE rather than newly missing: the source-text extractor this
    // suite used could not see it, so it was never compared. It is a real gap.
    "nextly_i18n_archive",
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

  /**
   * Indexes, for every bootstrapped table.
   *
   * The column comparison cannot see an index: a missing one breaks no insert,
   * it makes a query slow. That is why `nextly_jobs_recent_idx` was declared on
   * all three dialects and created on none, and why this check was scoped to
   * that one table when it was written — the same probe reported dozens of
   * pre-existing omissions and deciding what to do about them was left for
   * later. This is later: 35 of them are now written, so the check is
   * generalized and the scoping comment retired.
   *
   * A single-column UNIQUE index is satisfied by an inline `UNIQUE` on that
   * column, which is how this DDL already spells `users_email_unique` — SQLite
   * creates the same implicit index either way. Matching on the index NAME
   * alone would report four such constraints as missing when they are merely
   * spelled differently, so they are classified rather than counted.
   */
  it.each([...schemaTables().keys()].filter(table => ddlColumns().has(table)))(
    "creates every index the %s schema declares",
    table => {
      const statements = generateSqliteCoreTableStatements();
      const joined = statements.join("\n");
      const body =
        statements.find(statement =>
          statement.includes(`CREATE TABLE IF NOT EXISTS "${table}"`)
        ) ?? "";

      const declared = schemas.get(table)?.indexes ?? [];
      const missing = declared
        .filter(index => !joined.includes(`"${index.name}"`))
        .filter(index => {
          // Spelled inline on the column instead, which is the same index.
          const inlineUnique =
            index.unique &&
            index.columns.length === 1 &&
            new RegExp(`"${index.columns[0]}"[^,\n]*UNIQUE`).test(body);
          return !inlineUnique;
        })
        .map(index => index.name);

      expect(
        missing,
        `${table}: the bootstrap DDL never creates ${missing.join(", ")}, so ` +
          "the declaration is decorative on every SQLite database built from it"
      ).toEqual([]);
    }
  );

  it("compares real indexes rather than an empty list", () => {
    // The premise of the check above. If the bundle stopped reporting indexes
    // it would pass for every table while asserting nothing at all.
    const total = [...schemaTables().values()].reduce(
      (sum, table) => sum + table.indexes.length,
      0
    );
    expect(total).toBeGreaterThan(50);
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
      const missing = [...declared.columns].filter(
        column => !present.has(column)
      );
      expect(
        missing,
        `${table}: the bootstrap DDL omits ${missing.join(", ")}, so every ` +
          "insert naming those columns fails on a database created from it"
      ).toEqual([]);
    }
  );
});
