/**
 * Upgrade step: move the migration records into `nextly_schema_events`
 * (spec §4.10).
 *
 * Backfills legacy `nextly_migrations` + `nextly_migration_journal` rows into
 * the `nextly_schema_events` table, creating it when absent, records one
 * audit row for the core schema that already exists, and drops the legacy
 * tables. A database with no legacy table and an events table of the
 * expected shape has nothing to move.
 *
 * @module cli/commands/upgrade-steps/schema-events
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import {
  busyTableBounds,
  type BusyTableBounds,
} from "../../../domains/schema/busy-table/bounds";
import { runStatementsInTries } from "../../../domains/schema/busy-table/run-on-session";
import {
  mapJournalRow,
  mapMigrationsRow,
  synthesizedCoreApplyEvent,
  type BackfillEvent,
} from "../../../domains/schema/events/backfill";
import { detectLegacyBookkeeping } from "../../../domains/schema/events/legacy-detection";
import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { quoteIdent } from "../../../domains/schema/pipeline/sql-templates/identifier-quoting";
import { NextlyError } from "../../../errors";
import type {
  UpgradeAdapter,
  UpgradeDialect,
  UpgradeStep,
  UpgradeStepContext,
} from "../upgrade-step";

const EVENTS_TABLE = "nextly_schema_events";

// --- raw exec/query helpers (dialect-branched; only the methods used) -------

function execRaw(
  db: unknown,
  dialect: UpgradeDialect,
  statement: string
): Promise<void> {
  if (dialect === "sqlite") {
    (db as { run: (q: unknown) => unknown }).run(sql.raw(statement));
    return Promise.resolve();
  }
  return (db as { execute: (q: unknown) => Promise<unknown> })
    .execute(sql.raw(statement))
    .then(() => undefined);
}

async function queryRaw(
  db: unknown,
  dialect: UpgradeDialect,
  statement: string
): Promise<Array<Record<string, unknown>>> {
  if (dialect === "sqlite") {
    return (db as { all: (q: unknown) => Array<Record<string, unknown>> }).all(
      sql.raw(statement)
    );
  }
  const res = await (
    db as { execute: (q: unknown) => Promise<unknown> }
  ).execute(sql.raw(statement));
  // pg returns { rows }, mysql2 returns [rows, fields].
  if (Array.isArray(res)) {
    return (Array.isArray(res[0]) ? res[0] : res) as Array<
      Record<string, unknown>
    >;
  }
  return (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

/** True iff the existing events table has the expected key columns. */
async function hasExpectedShape(
  db: unknown,
  dialect: UpgradeDialect,
  table: string
): Promise<boolean> {
  try {
    await queryRaw(
      db,
      dialect,
      `SELECT event_type, status, source FROM ${table} LIMIT 0`
    );
    return true;
  } catch {
    return false;
  }
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") {
    return new Date(value);
  }
  return null;
}

/** Drop undefined keys so the repository inserts NULL/defaults cleanly. */
function toInsertValues(event: BackfillEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** What a busy-table report and the schema lock's mark call this step. */
const UPGRADE_CHANGE = "nextly upgrade";

/**
 * The adapter as the command hands it over, a whole `DrizzleAdapter` whose sessions the step's
 * schema statements run on; undefined for a narrower one offering no session, through whose
 * Drizzle handle they run once each.
 */
function sessionAdapterOf(adapter: UpgradeAdapter): DrizzleAdapter | undefined {
  const methods = ["withSession", "executeQuery", "queryStatement"];
  return methods.every(name => typeof Reflect.get(adapter, name) === "function")
    ? (adapter as unknown as DrizzleAdapter)
    : undefined;
}

/**
 * Runs the step's schema statements in order and returns what a report calls each one that ran.
 * On the command's adapter each statement waits for a busy table in its own tries, bounded by
 * `NEXTLY_LOCK_TIMEOUT` / `NEXTLY_LOCK_TIMEOUT_TOTAL`, each try's notice through the step's warning
 * (`runStatementsInTries`); one that stays busy stops the upgrade with `NEXTLY_TABLE_BUSY`, naming
 * the statements before it, which stay.
 */
async function runSchemaStatements(
  context: UpgradeStepContext,
  bounds: BusyTableBounds,
  statements: readonly string[],
  name: (index: number) => string,
  appliedBefore: readonly string[]
): Promise<readonly string[]> {
  const adapter = sessionAdapterOf(context.adapter);
  if (adapter === undefined) {
    for (const statement of statements) {
      await execRaw(context.db, context.dialect, statement);
    }
    return statements.map((_, index) => `${UPGRADE_CHANGE}: ${name(index)}`);
  }
  return runStatementsInTries(adapter, statements, {
    change: UPGRADE_CHANGE,
    bounds,
    notify: context.warn,
    appliedBefore,
    name,
  });
}

const eventsTableOf = (context: UpgradeStepContext) =>
  context.options.targetTableName ?? EVENTS_TABLE;

/**
 * How many rows the step would write: one per legacy record, plus the core
 * schema's audit row. 0 once moved. A table squatting the events table's
 * name stops the upgrade here, before anything is written.
 */
async function pending(context: UpgradeStepContext): Promise<number> {
  const { adapter, db, dialect } = context;
  const eventsTable = eventsTableOf(context);
  const legacy = await detectLegacyBookkeeping(adapter);
  const eventsExists = await adapter.tableExists(eventsTable);
  const eventsShapeOk = eventsExists
    ? await hasExpectedShape(db, dialect, eventsTable)
    : false;

  // Checked before the collision: a clean database with an events table has
  // nothing to move.
  if (!legacy.hasLegacy && eventsExists && eventsShapeOk) return 0;

  if (eventsExists && !eventsShapeOk) {
    throw new NextlyError({
      code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
      publicMessage:
        `A table named "${eventsTable}" already exists with an unexpected ` +
        "shape. Rename it, or re-run with `--target-table-name <name>`.",
      logContext: { table: eventsTable },
    });
  }

  let rows = 1;
  for (const table of legacy.tables) {
    const [count] = await queryRaw(
      db,
      dialect,
      `SELECT COUNT(*) AS n FROM ${table}`
    );
    rows += Number(count?.n ?? 0);
  }
  return rows;
}

/** Backfill `nextly_migrations`' rows; returns how many were written. */
async function backfillMigrations(
  repo: SchemaEventsRepository,
  db: unknown,
  dialect: UpgradeDialect
): Promise<number> {
  const rows = await queryRaw(
    db,
    dialect,
    "SELECT filename, sha256, status, applied_at, applied_by, duration_ms, error_json FROM nextly_migrations"
  );
  for (const r of rows) {
    const event = mapMigrationsRow({
      filename: String(r.filename),
      sha256: String(r.sha256),
      status: String(r.status),
      appliedAt: toDate(r.applied_at),
      appliedBy: (r.applied_by as string | null) ?? null,
      durationMs: (r.duration_ms as number | null) ?? null,
      errorJson: r.error_json ?? null,
    });
    await repo.insertEvent(toInsertValues(event));
  }
  return rows.length;
}

/**
 * Backfill `nextly_migration_journal`'s finalized rows; returns how many were
 * written. A row that never finished is skipped, and said so.
 */
async function backfillJournal(
  repo: SchemaEventsRepository,
  context: UpgradeStepContext
): Promise<number> {
  const rows = await queryRaw(
    context.db,
    context.dialect,
    "SELECT source, status, started_at, ended_at, duration_ms, scope_kind, scope_slug FROM nextly_migration_journal"
  );
  let written = 0;
  for (const r of rows) {
    const event = mapJournalRow({
      source: String(r.source),
      status: String(r.status),
      startedAt: toDate(r.started_at),
      endedAt: toDate(r.ended_at),
      durationMs: (r.duration_ms as number | null) ?? null,
      scopeKind: (r.scope_kind as string | null) ?? null,
      scopeSlug: (r.scope_slug as string | null) ?? null,
    });
    if (!event) {
      context.warn(
        `Skipping non-finalized journal row (status=${String(r.status)}).`
      );
      continue;
    }
    await repo.insertEvent(toInsertValues(event));
    written++;
  }
  return written;
}

/** Create the events table, backfill it and drop the legacy tables. */
async function run(context: UpgradeStepContext): Promise<number> {
  // Read before anything else, so a bound outside its range is refused with the database as it
  // was: the backfill below writes rows that a run stopped after it would write again.
  const bounds = busyTableBounds({ env: process.env });
  const { adapter, db, dialect, log } = context;
  const eventsTable = eventsTableOf(context);
  const legacy = await detectLegacyBookkeeping(adapter);

  // What this step applied, as a busy-table report names it.
  const applied: string[] = [];
  if (!(await adapter.tableExists(eventsTable))) {
    const ddl = getSchemaEventsDdl(dialect);
    applied.push(
      ...(await runSchemaStatements(
        context,
        bounds,
        ddl,
        index =>
          `the creation of ${eventsTable}, statement ${String(index + 1)} of ${String(ddl.length)}`,
        applied
      ))
    );
    log(`Created ${eventsTable}`);
  }

  const repo = new SchemaEventsRepository(db, dialect);
  let written = 0;
  if (legacy.tables.includes("nextly_migrations")) {
    const migrated = await backfillMigrations(repo, db, dialect);
    log(`Backfilled ${migrated} rows from nextly_migrations`);
    written += migrated;
  }
  if (legacy.tables.includes("nextly_migration_journal")) {
    const journaled = await backfillJournal(repo, context);
    log(`Backfilled ${journaled} rows from nextly_migration_journal`);
    written += journaled;
  }

  // Synthesize a core_apply audit row for the pre-existing core schema.
  await repo.insertEvent(toInsertValues(synthesizedCoreApplyEvent()));
  log("Synthesized 1 audit row for pre-existing core schema");

  for (const table of legacy.tables) {
    applied.push(
      ...(await runSchemaStatements(
        context,
        bounds,
        [`DROP TABLE IF EXISTS ${quoteIdent(table, dialect)}`],
        () => `the drop of table ${JSON.stringify(table)}`,
        applied
      ))
    );
    log(`Dropped ${table}`);
  }
  return written + 1;
}

export const schemaEventsStep: UpgradeStep = {
  title: "move the migration records into nextly_schema_events",
  pending,
  run,
};
