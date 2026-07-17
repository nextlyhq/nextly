// Direct pushSchema helper for fresh / static-tables-only flows.
//
// What this is: a thin wrapper around drizzle-kit v1's per-dialect
// pushSchema with no diff engine, no Classifier, no PromptDispatcher,
// no MigrationJournal. Used by:
//
//   - `cli/commands/dev-server.ts:ensureCoreTables` — pushes the static
//     core tables (users, permissions, dynamic_collections, etc.) on a
//     fresh DB. The pipeline's apply() iterates only `desired.collections`,
//     so it can't materialise the static internal tables.
//   - `cli/commands/migrate-fresh.ts:reconcileMysqlSchema` — safety net
//     for historical MySQL drift after `migrate:fresh --seed` runs the
//     bundled migrations. Pushes static schemas to fill any gaps.
//   - `domains/schema/migrate/core-reconcile.ts` — `nextly migrate`
//     Phase 1 core-table reconciliation.
//   - `init/first-run.ts` — first-boot setup.
//
// Why this exists separately from `applyDesiredSchema`: per the user
// decision Q3=A (2026-04-28), `nextly migrate:fresh` and the boot
// static-tables push stay on a simple direct-pushSchema path. They
// never need prompts (prompts on a fresh DB would be silly), they never
// need classifier events (no existing data to classify against), they
// never need a journal entry (these are setup operations, not user
// schema changes).
//
// All three dialects share one flow on v1: pushSchema generates the
// statements diffed against the LIVE database, and we execute them
// ourselves so the drop-guard + destructive-statement scan can inspect
// the SQL first (drizzle-kit's own result.apply() would run everything
// opaquely — including DROPs for user tables absent from a core-only
// push, the historical data-loss bug the guard exists for).
//
// Boot-safety policy: unexpected destructive statements are STRIPPED
// and reported (result.hints + console.warn), not thrown — a server
// boot must not brick over a statement we were never going to run.
// The interactive pipeline (pushschema-pipeline.ts) takes the opposite
// stance and throws, because a user is present to act on the failure.

import type { KitHint } from "../../../database/drizzle-kit-lazy";
import {
  getMySQLDrizzleKit,
  getPgDrizzleKit,
  getSQLiteDrizzleKit,
} from "../../../database/drizzle-kit-lazy";

import {
  drizzleTableNames,
  filterUnsafeStatements,
  findUnexpectedDestructiveStatements,
} from "./filter-unsafe-statements";

export type FreshPushDialect = "postgresql" | "mysql" | "sqlite";

// Result shape returned to callers. `applied` is always true when no
// error is thrown — the helper is "fire and forget" by design. `hints`
// carries drizzle-kit's own hints (empty in every observed rc.4
// scenario) plus one entry per destructive statement the boot-safety
// policy stripped.
export interface FreshPushResult {
  hints: KitHint[];
  statementsExecuted: string[];
  applied: true;
}

// Options reserved for future per-call tweaks.
export type FreshPushOptions = Record<string, never>;

/**
 * Push a static / fresh schema directly via drizzle-kit v1, bypassing the
 * pipeline's diff + classifier + prompt machinery. All dialects route
 * through pushSchema; statements are executed by Nextly (never by kit's
 * apply()) so the drop-guard and destructive-statement scan run first.
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

  const result = await pushForDialect(dialect, db, schema);

  const desiredTableNames = drizzleTableNames(schema);
  const pieces = splitStatements(result.sqlStatements);
  const safe = filterUnsafeStatements(pieces, desiredTableNames);

  // Boot-safety: strip (never execute) destructive statements the kit
  // emitted unexpectedly, and surface them via hints + warn. See the
  // header comment for why this path strips where the pipeline throws.
  const offenders = new Set(findUnexpectedDestructiveStatements(safe));
  const runnable = safe.filter(s => !offenders.has(s));
  const hints: KitHint[] = [
    ...result.hints,
    ...[...offenders].map(statement => ({
      hint: "blocked destructive statement on fresh-push",
      statement,
    })),
  ];
  for (const statement of offenders) {
    console.warn(
      `[Nextly schema] fresh-push blocked a destructive statement emitted ` +
        `by drizzle-kit (core reconciles must never destroy data; route ` +
        `intentional drops through migrations): ${statement}`
    );
  }

  const executed = await executeStatements(dialect, db, runnable);

  return { hints, statementsExecuted: executed, applied: true };
}

// Per-dialect pushSchema invocation. MySQL's v1 entrypoint requires the
// database name positionally; resolve it from the live connection so
// callers don't have to thread it through.
async function pushForDialect(
  dialect: FreshPushDialect,
  db: unknown,
  schema: Record<string, unknown>
): Promise<{ sqlStatements: string[]; hints: KitHint[] }> {
  switch (dialect) {
    case "postgresql": {
      const kit = await getPgDrizzleKit();
      // Scope introspection to the DESIRED tables (same W6 fix as the
      // pipeline's Phase D). Without the tables filter, any live table
      // outside the desired set — e.g. the migrate lock table, which exists
      // BEFORE the core reconcile runs inside the lock — pairs against an
      // added table in v1's differ and crashes its rename resolver
      // (`resolver(table) was called without a HintsHandler`). 0.31 emitted
      // a DROP instead, which filterUnsafeStatements blocked; v1 crashes
      // before emission, so the scoping must happen at introspection time.
      // fresh-push is create-only reconcile — orphans are none of its
      // business.
      return kit.pushSchema(schema, db, {
        schemas: ["public"],
        tables: drizzleTableNames(schema),
      });
    }
    case "mysql": {
      const kit = await getMySQLDrizzleKit();
      const databaseName = await currentMysqlDatabase(db);
      return kit.pushSchema(schema, db, databaseName);
    }
    case "sqlite": {
      const kit = await getSQLiteDrizzleKit();
      return kit.pushSchema(schema, db);
    }
  }
}

async function currentMysqlDatabase(db: unknown): Promise<string> {
  const { sql: sqlTag } = await import("drizzle-orm");
  type AsyncExecuteDb = { execute: (q: unknown) => Promise<unknown> };
  const raw = await (db as AsyncExecuteDb).execute(
    sqlTag.raw("SELECT DATABASE() AS db")
  );
  // drizzle-orm/mysql2 execute() resolves to [rows, fields].
  const rows = Array.isArray(raw) ? raw[0] : raw;
  const name = Array.isArray(rows)
    ? (rows[0] as { db?: string } | undefined)?.db
    : undefined;
  if (!name) {
    throw new Error(
      "freshPushSchema: could not determine the current MySQL database " +
        "(SELECT DATABASE() returned no name). Connect with a database " +
        "selected in the connection URL."
    );
  }
  return name;
}

// v1 emits one statement per array entry in every observed case, but a
// defensive split keeps multi-statement strings executable. PRAGMA is in
// the allow-list because v1's SQLite recreate flow emits its
// `PRAGMA foreign_keys=OFF/ON` choreography inside the statement stream —
// dropping those would run rebuilds with FK enforcement in an unknown
// state (#5782 territory).
// Exported for the v1-golden fixture suite (Phase 7), which asserts every
// captured kit statement survives the split executable.
export function splitStatements(sqlStatements: string[]): string[] {
  const out: string[] = [];
  for (const raw of sqlStatements) {
    for (const piece of raw
      .split(";")
      .map(s => s.trim())
      .filter(
        s =>
          s.length > 0 &&
          !s.startsWith("--") &&
          /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|PRAGMA)\b/i.test(s)
      )) {
      out.push(piece);
    }
  }
  return out;
}

// Executes statements per dialect, swallowing idempotency errors
// ("already exists" / duplicate column) so re-runs over an existing
// schema reconcile instead of failing. v1 wraps driver errors in
// DrizzleQueryError with the original error on `.cause`, so both the
// wrapper message and the cause message are checked.
async function executeStatements(
  dialect: FreshPushDialect,
  db: unknown,
  statements: string[]
): Promise<string[]> {
  if (statements.length === 0) return [];
  const { sql: sqlTag } = await import("drizzle-orm");
  const executed: string[] = [];

  type SqliteRunDb = { run: (q: unknown) => unknown };
  type AsyncExecuteDb = { execute: (q: unknown) => Promise<unknown> };
  type PgTxDb = {
    transaction: (
      fn: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>
    ) => Promise<void>;
  };

  const isIdempotencyError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg =
      err instanceof Error && err.cause instanceof Error
        ? err.cause.message
        : "";
    return [msg, causeMsg].some(
      m =>
        m.includes("already exists") ||
        m.includes("duplicate column name") ||
        m.includes("Duplicate")
    );
  };

  if (dialect === "postgresql") {
    // One transaction for an atomic reconcile (PG supports transactional
    // DDL). Idempotency errors abort a PG transaction, so re-runs over an
    // existing schema are expected to emit zero statements instead.
    await (db as PgTxDb).transaction(async tx => {
      for (const stmt of statements) {
        await tx.execute(sqlTag.raw(stmt));
        executed.push(stmt);
      }
    });
    return executed;
  }

  for (const stmt of statements) {
    try {
      if (dialect === "sqlite") {
        (db as SqliteRunDb).run(sqlTag.raw(stmt));
      } else {
        await (db as AsyncExecuteDb).execute(sqlTag.raw(stmt));
      }
      executed.push(stmt);
    } catch (err) {
      if (isIdempotencyError(err)) continue;
      throw err;
    }
  }
  return executed;
}
