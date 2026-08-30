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
import { isMissingColumnError } from "../../../database/missing-column";
import { NextlyError } from "../../../errors/nextly-error";

import { currentMysqlDatabaseName } from "./database-url";
import {
  drizzleTableNames,
  filterUnsafeStatements,
  findUnexpectedDestructiveStatements,
} from "./filter-unsafe-statements";
import { isIdempotencyError, splitStatements } from "./sql-statement-utils";

// Re-exported so existing importers (v1-golden suite) keep working; the
// implementation lives in sql-statement-utils.ts.
export { splitStatements };

export type FreshPushDialect = "postgresql" | "mysql" | "sqlite";

// Result shape returned to callers. Success is signalled by returning at
// all (errors throw). `hints` carries drizzle-kit's own hints (empty in
// every observed rc.4 scenario) plus one entry per destructive statement
// the boot-safety policy stripped.
export interface FreshPushResult {
  hints: KitHint[];
  statementsExecuted: string[];
}

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
  schema: Record<string, unknown>
): Promise<FreshPushResult> {
  // Entry-point dialect guard. TS already narrows callers to the union,
  // but a runtime check makes the failure mode obvious for callers that
  // bypass the type system (e.g. plugin authors with `as any` somewhere).
  if (dialect !== "postgresql" && dialect !== "mysql" && dialect !== "sqlite") {
    throw NextlyError.internal({
      logContext: { reason: `Unsupported dialect: ${String(dialect)}` },
    });
  }

  // TWO PASSES, when and only when the first one degraded.
  //
  // The rename resolver crashes while pairing a live table outside the desired
  // schema against one being ADDED, and the recovery baseline is diffed from an
  // empty snapshot — so it creates missing tables and silently drops every
  // alteration to a table that already exists. That is why a column added to a
  // core table never reached an installation holding ordinary content.
  //
  // Once the first pass has created what was missing, nothing is added any
  // more. The resolver has no pair to resolve, does not crash, and drizzle-kit
  // emits the alterations itself — including the table rebuilds SQLite needs
  // for a nullability change, which it already knows how to express and this
  // code would otherwise have to reimplement.
  //
  // The second pass runs only after a degraded one. An ordinary push already
  // applied everything, and re-running it would be a wasted introspection on
  // every boot.
  const first = await pushForDialect(dialect, db, schema);
  const firstPass = await applyPushResult(dialect, db, schema, first);
  if (!first.hints.some(h => h.hint.startsWith(DEGRADED_PASS_HINT))) {
    return firstPass;
  }

  const second = await pushForDialect(dialect, db, schema);
  const secondPass = await applyPushResult(dialect, db, schema, second);
  return {
    hints: [...firstPass.hints, ...secondPass.hints],
    statementsExecuted: [
      ...firstPass.statementsExecuted,
      ...secondPass.statementsExecuted,
    ],
  };
}

/**
 * Filter one push result for safety and execute what survives.
 *
 * Extracted so a degraded first pass and the retry after it go through exactly
 * the same guards — a second path here is a second place for a destructive
 * statement to slip past.
 */
async function applyPushResult(
  dialect: FreshPushDialect,
  db: unknown,
  schema: Record<string, unknown>,
  result: { sqlStatements: string[]; hints: KitHint[] }
): Promise<FreshPushResult> {
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
  // v1 hints were EMPTY in every observed rc.4 scenario; if the kit ever
  // starts attaching them (some carry a `statement` its own apply() would
  // run first), that is an uninterpreted signal — surface it loudly so a
  // boot log never silently swallows a data-loss precondition.
  for (const h of result.hints) {
    // Nextly-authored diagnostics (the resolver-crash fallback) are already
    // interpreted — only genuinely-unknown kit hints deserve the warning.
    if (h.hint.startsWith("[nextly]")) continue;
    console.warn(
      `[Nextly schema] fresh-push received a drizzle-kit hint it does not ` +
        `interpret: ${h.hint}${h.statement ? ` [${h.statement}]` : ""}`
    );
  }
  for (const statement of offenders) {
    console.warn(
      `[Nextly schema] fresh-push blocked a destructive statement emitted ` +
        `by drizzle-kit (core reconciles must never destroy data; route ` +
        `intentional drops through migrations): ${statement}`
    );
  }

  // A degraded pass cannot add a column, so an index over one it lacks is a
  // casualty of the baseline rather than a fault; the pass that follows builds
  // both in order.
  const degraded = result.hints.some(h =>
    h.hint.startsWith(DEGRADED_PASS_HINT)
  );
  const executed = await executeStatements(dialect, db, runnable, degraded);

  return { hints, statementsExecuted: executed };
}

/**
 * Marks a pass that degraded to the additive-TABLES-only baseline.
 *
 * That baseline is diffed from an EMPTY snapshot, so it can create a missing
 * table but never alter an existing one. Recognising it is what lets the push
 * run again once the tables exist.
 */
const DEGRADED_PASS_HINT = "[nextly] pushSchema hit v1's rename-resolver crash";

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
      const databaseName = await currentMysqlDatabaseName(db);
      return withResolverCrashFallback(
        () => kit.pushSchema(schema, db, databaseName),
        async () =>
          kit.generateMigration(
            await kit.generateDrizzleJson({}),
            await kit.generateDrizzleJson(schema)
          )
      );
    }
    case "sqlite": {
      const kit = await getSQLiteDrizzleKit();
      return withResolverCrashFallback(
        () => kit.pushSchema(schema, db),
        async () =>
          kit.generateMigration(
            await kit.generateDrizzleJson({}),
            await kit.generateDrizzleJson(schema)
          )
      );
    }
  }
}

// The SQLite/MySQL payload entrypoints accept no tables filter, so their
// introspection sees the WHOLE live database. When an upgrade adds a new
// core table while any non-core table exists (user dc_* content, the
// migrate lock), v1's differ pairs the "dropped" orphan against the added
// table and its rename resolver throws `Internal error: resolver(table) was
// called without a HintsHandler` BEFORE emitting anything (probe-verified).
// PG avoids this via the entities filter above; here the recovery is the
// pre-v1 applyViaGenerate shape: generate the pure-CREATE baseline from an
// empty snapshot. That set contains no drops by construction, and the
// downstream idempotency-tolerant executor skips tables that already exist,
// so the reconcile degrades to additive-TABLES-only instead of crashing the
// boot.
//
// Deliberate scope: because the baseline is diffed from an EMPTY
// snapshot it emits only CREATE TABLE — never ALTER TABLE ADD COLUMN. A core
// table that already exists but is missing a newly-added COLUMN is therefore
// NOT reconciled in this degraded pass (its CREATE is skipped as
// already-existing). That is acceptable here: Nextly's own core-schema
// evolution ships through the migration journal, not through this boot-time
// ensure, and the crash that triggered this fallback is transient — it
// clears once the orphan tables are gone, so the next clean reconcile diffs
// live→desired normally and adds any missing column. Recovering columns here
// would require a scoped live diff, which is exactly the operation that
// crashed; parsing DDL by hand in a recovery path is not worth the fragility.
async function withResolverCrashFallback(
  push: () => Promise<{ sqlStatements: string[]; hints: KitHint[] }>,
  generateBaseline: () => Promise<string[]>
): Promise<{ sqlStatements: string[]; hints: KitHint[] }> {
  try {
    return await push();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/HintsHandler/.test(message)) throw err;
    const sqlStatements = await generateBaseline();
    return {
      sqlStatements,
      hints: [
        {
          // The `[nextly]` prefix marks this as a Nextly-authored
          // diagnostic — freshPushSchema's warn loop skips it so operators
          // are not told a fully-handled fallback is an "uninterpreted
          // drizzle-kit hint".
          hint:
            DEGRADED_PASS_HINT +
            " (live tables outside the desired schema); applied the " +
            "additive-TABLES-only baseline, then re-pushed so the " +
            "alterations it cannot express are not lost",
        },
      ],
    };
  }
}

/**
 * Whether a failed statement is an index the additive baseline could not build
 * yet.
 *
 * The baseline is diffed from an EMPTY snapshot, so it carries every index in
 * the desired schema while emitting no `ALTER TABLE ADD COLUMN` at all. An
 * index naming a column the live table has not gained yet therefore fails on a
 * precondition the same pass is incapable of satisfying. Skipping it is safe
 * only because a degraded pass is always followed by another, and that one adds
 * the column and then indexes it.
 *
 * Narrow on purpose: only CREATE INDEX, only a missing-column error, and only
 * when the caller says the pass degraded. A failure to create an index for any
 * other reason still stops the reconcile.
 */
function isIndexAwaitingItsColumn(statement: string, err: unknown): boolean {
  return (
    /^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(statement) &&
    isMissingColumnError(err)
  );
}

// Executes statements per dialect, swallowing idempotency errors
// ("already exists" / duplicate column) so re-runs over an existing
// schema reconcile instead of failing. v1 wraps driver errors in
// DrizzleQueryError with the original error on `.cause`, so both the
// wrapper message and the cause message are checked.
async function executeStatements(
  dialect: FreshPushDialect,
  db: unknown,
  statements: string[],
  degraded: boolean
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

  if (dialect === "sqlite") {
    // #5782 defense, independent of drizzle-kit's emitted choreography: the
    // interactive pipeline toggles PRAGMA foreign_keys OFF/ON outside any
    // transaction and runs foreign_key_check after apply — this boot path
    // must not rely on the kit's INLINE pragma statements staying present
    // and correctly ordered across RC bumps. The toggle is done here (no
    // transaction is open on this path), and the integrity check fails the
    // reconcile if a rebuild left orphaned child rows.
    const run = (q: string) => (db as SqliteRunDb).run(sqlTag.raw(q));
    run("PRAGMA foreign_keys = OFF");
    try {
      for (const stmt of statements) {
        try {
          run(stmt);
          executed.push(stmt);
        } catch (err) {
          if (isIdempotencyError(err)) continue;
          if (degraded && isIndexAwaitingItsColumn(stmt, err)) continue;
          throw err;
        }
      }
      const violations = (db as { all?: (q: unknown) => unknown[] }).all?.(
        sqlTag.raw("PRAGMA foreign_key_check")
      );
      if (violations && violations.length > 0) {
        throw NextlyError.internal({
          logContext: {
            reason:
              `fresh-push: PRAGMA foreign_key_check reported ` +
              `${violations.length} violation(s) after the reconcile — a ` +
              `table rebuild left orphaned child rows (#5782 class)`,
          },
        });
      }
    } finally {
      run("PRAGMA foreign_keys = ON");
    }
    return executed;
  }

  for (const stmt of statements) {
    try {
      await (db as AsyncExecuteDb).execute(sqlTag.raw(stmt));
      executed.push(stmt);
    } catch (err) {
      if (isIdempotencyError(err)) continue;
      if (degraded && isIndexAwaitingItsColumn(stmt, err)) continue;
      throw err;
    }
  }
  return executed;
}
