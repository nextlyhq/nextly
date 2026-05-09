// Direct pushSchema helper for fresh / static-tables-only flows.
//
// What this is: a thin wrapper around drizzle-kit's pushSchema (PG +
// SQLite paths) and generateMigration (MySQL path) with no diff engine,
// no Classifier, no PromptDispatcher, no MigrationJournal. Used by:
//
//   - `cli/commands/dev-server.ts:ensureCoreTables` — pushes the static
//     core tables (users, permissions, dynamic_collections, etc.) on a
//     fresh DB. The pipeline's apply() iterates only `desired.collections`,
//     so it can't materialise the static internal tables.
//   - `cli/commands/migrate-fresh.ts:reconcileMysqlSchema` — safety net
//     for historical MySQL drift after `migrate:fresh --seed` runs the
//     bundled migrations. Pushes static schemas to fill any gaps.
//
// Why this exists separately from `applyDesiredSchema`: per the user
// decision Q3=A (2026-04-28), `nextly migrate:fresh` and the boot
// static-tables push stay on a simple direct-pushSchema path. They
// never need prompts (prompts on a fresh DB would be silly), they never
// need classifier events (no existing data to classify against), they
// never need a journal entry (these are setup operations, not user
// schema changes). Consolidating them into the pipeline would require
// adding a "no-prompt at init" policy with its own user-visible
// behavior tradeoffs — out of F8 scope per the brainstorm.
//
// This module REPLACES the dialect dispatch logic from the legacy
// `DrizzlePushService.apply` (extracted verbatim in F8 PR 2; legacy
// class deleted in F8 PR 4 once all callers had migrated).

import {
  getMySQLDrizzleKit,
  getPgDrizzleKit,
  getSQLiteDrizzleKit,
} from "../../../database/drizzle-kit-lazy";

export type FreshPushDialect = "postgresql" | "mysql" | "sqlite";

// Result shape returned to callers. `applied` is always true when no
// error is thrown — the helper is "fire and forget" by design.
export interface FreshPushResult {
  hasDataLoss: boolean;
  warnings: string[];
  statementsExecuted: string[];
  applied: true;
}

// Options reserved for future per-call tweaks. Currently empty (the
// MySQL `databaseName` extraction is dead in this helper because MySQL
// flows through applyViaGenerate, which doesn't introspect the live DB
// — it generates from an empty snapshot, so the DB name is irrelevant).
export type FreshPushOptions = Record<string, never>;

/**
 * Push a static / fresh schema directly via drizzle-kit, bypassing the
 * pipeline's diff + classifier + prompt machinery. PG uses pushSchema
 * directly; SQLite uses pushSchema with manual statement execution
 * (drizzle-kit 0.31.10's apply() uses .all() which fails on DDL); MySQL
 * uses generateDrizzleJson + generateMigration (drizzle-kit 0.31.10's
 * MySQL apply() silently drops non-destructive DDL).
 *
 * Throws on:
 *   - Unknown dialect (front-of-function guard, defends against callers
 *     that bypass TS).
 *   - Dialect-execution errors that aren't `already exists` /
 *     `Duplicate column` (caller handles them — `migrate:fresh`
 *     swallows known drift errors, `ensureCoreTables` has its own
 *     SQLite raw-SQL fallback).
 */
export async function freshPushSchema(
  dialect: FreshPushDialect,
  db: unknown,
  schema: Record<string, unknown>,
  _options: FreshPushOptions = {}
): Promise<FreshPushResult> {
  // Entry-point dialect guard. TS already narrows callers to the union,
  // but a runtime check makes the failure mode obvious for callers that
  // bypass the type system (e.g. plugin authors with `as any` somewhere).
  if (dialect !== "postgresql" && dialect !== "mysql" && dialect !== "sqlite") {
    throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }

  if (dialect === "mysql") {
    return applyViaGenerate("mysql", db, schema);
  }
  if (dialect === "sqlite") {
    return applyViaPushSchemaSQLite(db, schema);
  }

  // PostgreSQL: pushSchema works correctly — use it directly.
  const kit = await getPgDrizzleKit();
  const result = await kit.pushSchema(schema, db, ["public"]);
  await result.apply();
  return {
    hasDataLoss: result.hasDataLoss,
    warnings: result.warnings,
    statementsExecuted: result.statementsToExecute,
    applied: true,
  };
}

// SQLite apply path that uses pushSchema() to get statements diffed
// against the LIVE database, then executes them with .run() ourselves.
// Why: drizzle-kit 0.31.10's returned apply() uses .all() for DDL which
// fails on statements that do not return rows. The statementsToExecute
// array, however, is correct and reflects the real ALTER TABLE / ADD
// COLUMN needed for existing tables. The earlier approach of diffing
// against an empty {} snapshot produced CREATE TABLE statements only,
// so column additions against existing tables became no-ops under
// `CREATE TABLE IF NOT EXISTS` rewriting.
async function applyViaPushSchemaSQLite(
  db: unknown,
  schema: Record<string, unknown>
): Promise<FreshPushResult> {
  const kit = await getSQLiteDrizzleKit();
  const result = await kit.pushSchema(schema, db);

  if (!result.statementsToExecute || result.statementsToExecute.length === 0) {
    return {
      hasDataLoss: result.hasDataLoss ?? false,
      warnings: result.warnings ?? [],
      statementsExecuted: [],
      applied: true,
    };
  }

  const { sql: sqlTag } = await import("drizzle-orm");
  const executed: string[] = [];
  for (const rawStmt of result.statementsToExecute) {
    const pieces = rawStmt
      .split("\n")
      .map((line: string) => line.replace(/--> statement-breakpoint/g, ""))
      .join("\n")
      .split(";")
      .map((s: string) => s.trim())
      .filter(
        (s: string) =>
          s.length > 0 &&
          !s.startsWith("--") &&
          /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(s)
      );
    for (const raw of pieces) {
      // Drizzle-kit 0.31.10's SQLite recreate-table strategy emits
      //   INSERT INTO `__new_<t>`(cols) SELECT cols FROM `<t>`
      // where `cols` includes columns that do not yet exist in `<t>`.
      // That fails with "no such column". Rewrite the SELECT list so
      // columns missing from the live source are substituted with NULL.
      const stmt = await rewriteRecreateInsertForMissingCols(db, raw);
      try {
        type SqliteRunDb = { run: (sql: unknown) => unknown };
        (db as SqliteRunDb).run(sqlTag.raw(stmt));
        executed.push(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("already exists") ||
          msg.includes("duplicate column name")
        ) {
          continue;
        }
        throw err;
      }
    }
  }

  return {
    hasDataLoss: result.hasDataLoss ?? false,
    warnings: result.warnings ?? [],
    statementsExecuted: executed,
    applied: true,
  };
}

// Rewrites a SQLite recreate-table INSERT to substitute NULL for any
// column that does not exist in the source table. Returns the input
// unchanged if it is not an INSERT of the recreate form.
// Shape recognised:
//   INSERT INTO `__new_<t>`("a","b",...) SELECT "a","b",... FROM `<t>`
async function rewriteRecreateInsertForMissingCols(
  db: unknown,
  stmt: string
): Promise<string> {
  const m = stmt.match(
    /^INSERT\s+INTO\s+`(__new_[^`]+)`\s*\(([^)]+)\)\s+SELECT\s+([^]+?)\s+FROM\s+`([^`]+)`\s*$/i
  );
  if (!m) return stmt;
  const [, , insertColsRaw, , sourceTable] = m;
  // Defence-in-depth: the capture matched `[^`]+` so it cannot contain a
  // backtick, but `"` and NUL would still break the PRAGMA quoting below.
  // drizzle-kit only emits `dc_<slug>` style names in practice — bail out
  // if the identifier violates our assumptions rather than risk injection.
  if (/["\0]/.test(sourceTable)) return stmt;
  const insertCols = insertColsRaw
    .split(",")
    .map(c => c.trim().replace(/^`|`$/g, "").replace(/^"|"$/g, ""));
  let sourceColNames: string[];
  try {
    const { sql: sqlTag } = await import("drizzle-orm");
    type SqliteAllDb = { all: (sql: unknown) => Array<{ name: string }> };
    const rows = (db as SqliteAllDb).all(
      sqlTag.raw(`PRAGMA table_info("${sourceTable}")`)
    );
    sourceColNames = rows.map(r => r.name);
  } catch {
    // If the live pragma fails, leave the statement unchanged so the
    // original error surfaces rather than a misleading rewrite.
    return stmt;
  }
  const selectList = insertCols
    .map(col => (sourceColNames.includes(col) ? `"${col}"` : "NULL"))
    .join(", ");
  const colList = insertCols.map(col => `"${col}"`).join(", ");
  return `INSERT INTO \`__new_${sourceTable}\`(${colList}) SELECT ${selectList} FROM \`${sourceTable}\``;
}

// Dialect-agnostic apply path that bypasses the broken pushSchema().
// Generates a Drizzle JSON snapshot of the desired schema, diffs it
// against an empty snapshot, and executes the resulting DDL SQL.
//
// Used for MySQL because drizzle-kit 0.31.10's MySQL pushSchema()
// silently drops non-destructive DDL. The generate path produces correct
// CREATE/ALTER statements; we execute them ourselves.
async function applyViaGenerate(
  dialect: "mysql" | "sqlite",
  db: unknown,
  schema: Record<string, unknown>
): Promise<FreshPushResult> {
  const kit =
    dialect === "mysql"
      ? await getMySQLDrizzleKit()
      : await getSQLiteDrizzleKit();

  const curJson = await kit.generateDrizzleJson(schema);
  const prevJson = await kit.generateDrizzleJson({});

  const sqlStatements = await kit.generateMigration(prevJson, curJson);

  if (!sqlStatements || sqlStatements.length === 0) {
    return {
      hasDataLoss: false,
      warnings: [],
      statementsExecuted: [],
      applied: true,
    };
  }

  // Drizzle's better-sqlite3 driver exposes synchronous .run() while the
  // MySQL/Postgres drivers expose async .execute(). db is typed as
  // unknown so we narrow with small structural interfaces at the call
  // site instead of using `as any`.
  type SqliteRunDb = { run: (sql: unknown) => unknown };
  type AsyncExecuteDb = { execute: (sql: unknown) => Promise<unknown> };

  const executedStatements: string[] = [];

  for (const migrationSql of sqlStatements) {
    const individualStatements = migrationSql
      .split("\n")
      .map((line: string) => line.replace(/--> statement-breakpoint/g, ""))
      .join("\n")
      .split(";")
      .map((s: string) => s.trim())
      .filter(
        (s: string) =>
          s.length > 0 &&
          !s.startsWith("--") &&
          /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(s)
      );

    for (let stmt of individualStatements) {
      try {
        stmt = stmt.replace(
          /\bCREATE TABLE\b(?!\s+IF\s+NOT\s+EXISTS)/gi,
          "CREATE TABLE IF NOT EXISTS"
        );

        const { sql: sqlTag } = await import("drizzle-orm");
        if (dialect === "sqlite") {
          (db as SqliteRunDb).run(sqlTag.raw(stmt));
        } else {
          await (db as AsyncExecuteDb).execute(sqlTag.raw(stmt));
        }
        executedStatements.push(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already exists") || msg.includes("Duplicate")) {
          continue;
        }
        throw err;
      }
    }
  }

  return {
    hasDataLoss: false,
    warnings: [],
    statementsExecuted: executedStatements,
    applied: true,
  };
}
