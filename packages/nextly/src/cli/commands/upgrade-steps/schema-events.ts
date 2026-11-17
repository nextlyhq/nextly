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
 * `nextly_migrations` is read in whichever shape an earlier release kept it
 * (`legacyLedgerShape`), and every row is read before anything is written, so
 * a row the step cannot move stops the upgrade with the database unchanged.
 *
 * Resumable rather than one transaction: MySQL commits a `DROP TABLE` on its
 * own, so a transaction around the step would promise on one dialect what it
 * cannot keep. Instead every row is written before the legacy tables are
 * dropped, and a record already in the events table is not written again. A
 * run stopped anywhere keeps the legacy tables, and the next run finishes the
 * move without writing anything twice.
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
  legacyLedgerShape,
  mapJournalRow,
  mapMigrationsRow,
  readLegacyLedgerRow,
  synthesizedCoreApplyEvent,
  type BackfillEvent,
  type LegacyMigrationsRow,
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

/** The column names of `table` in the live database, lowercased. */
async function columnsOf(
  db: unknown,
  dialect: UpgradeDialect,
  table: string
): Promise<string[]> {
  const statement =
    dialect === "sqlite"
      ? `SELECT name AS column_name FROM pragma_table_info('${table}')`
      : dialect === "postgresql"
        ? `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
        : `SELECT COLUMN_NAME AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`;
  const rows = await queryRaw(db, dialect, statement);
  return rows.map(row =>
    String(row.column_name ?? row.COLUMN_NAME).toLowerCase()
  );
}

/** What the step moves out of `nextly_migrations`, read whole before anything is written. */
interface LegacyLedgerPlan {
  moves: LegacyMigrationsRow[];
  skips: { filename: string; status: string }[];
}

/**
 * Every row of `nextly_migrations`, read through the shape the table has.
 * A table of no known shape that holds rows, or a row whose meaning is not
 * known, stops the upgrade here, before anything is written: guessed into
 * the ledger, it would change what `nextly migrate` believes has run. An
 * empty table of any shape has nothing to move and is only dropped.
 */
async function readLegacyLedger(
  db: unknown,
  dialect: UpgradeDialect
): Promise<LegacyLedgerPlan> {
  const columns = await columnsOf(db, dialect, "nextly_migrations");
  const rows = await queryRaw(db, dialect, "SELECT * FROM nextly_migrations");
  if (rows.length === 0) return { moves: [], skips: [] };
  const shape = legacyLedgerShape(columns);
  if (shape === null) {
    throw ledgerUnreadable(
      `it has no column naming the migration file (columns: ${columns.join(", ")})`
    );
  }
  const plan: LegacyLedgerPlan = { moves: [], skips: [] };
  for (const raw of rows) {
    // Keys as the driver gives them, matched by their lowercased names.
    const row = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key.toLowerCase(), value])
    );
    const read = readLegacyLedgerRow(row, shape);
    if (read.kind === "refuse") throw ledgerUnreadable(read.reason);
    if (read.kind === "skip") plan.skips.push(read);
    else plan.moves.push(read.row);
  }
  return plan;
}

/** The refusal of a `nextly_migrations` table the step cannot move. */
function ledgerUnreadable(why: string): NextlyError {
  return new NextlyError({
    code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
    publicMessage:
      `The table "nextly_migrations" holds records \`nextly upgrade\` cannot read: ${why}. ` +
      "Rename the table if Nextly did not create it, then run `nextly upgrade` again.",
    logContext: {
      reason: "legacy-ledger-unreadable",
      table: "nextly_migrations",
    },
  });
}

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

  // Read whole first, so a table the run could not move is refused here, by a
  // dry run as by a real one, before the backup question and before any write.
  if (legacy.tables.includes("nextly_migrations")) {
    await readLegacyLedger(db, dialect);
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

/** Whether `event` is already in the events table: written by a run that stopped before its drop. */
async function alreadyMoved(
  repo: SchemaEventsRepository,
  event: BackfillEvent
): Promise<boolean> {
  if (typeof event.filename !== "string") return false;
  return (await repo.findFileApplies(event.filename)).some(
    found =>
      found.status === event.status &&
      (found.sha256 ?? null) === (event.sha256 ?? null)
  );
}

/**
 * Backfill `nextly_migrations`' rows, read in its own shape; returns how many
 * were written. A record already moved by a run that stopped is not written
 * again, and one of a run that never finished is skipped, and said so.
 */
async function backfillMigrations(
  repo: SchemaEventsRepository,
  context: UpgradeStepContext
): Promise<number> {
  const { moves, skips } = await readLegacyLedger(context.db, context.dialect);
  for (const skip of skips) {
    context.warn(
      `Skipping the record of ${skip.filename}, which never finished (status=${skip.status}).`
    );
  }
  let written = 0;
  for (const row of moves) {
    const event = mapMigrationsRow(row);
    if (await alreadyMoved(repo, event)) continue;
    await repo.insertEvent(toInsertValues(event));
    written++;
  }
  return written;
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
    const migrated = await backfillMigrations(repo, context);
    log(`Backfilled ${migrated} rows from nextly_migrations`);
    written += migrated;
  }
  if (legacy.tables.includes("nextly_migration_journal")) {
    const journaled = await backfillJournal(repo, context);
    log(`Backfilled ${journaled} rows from nextly_migration_journal`);
    written += journaled;
  }

  // Synthesize a core_apply audit row for the pre-existing core schema, once:
  // a run that stopped after writing it, before its drop, wrote it already.
  const [prior] = await queryRaw(
    db,
    dialect,
    `SELECT COUNT(*) AS n FROM ${quoteIdent(EVENTS_TABLE, dialect)} WHERE source = 'legacy-prebackfill'`
  );
  if (Number(prior?.n ?? 0) === 0) {
    await repo.insertEvent(toInsertValues(synthesizedCoreApplyEvent()));
    log("Synthesized 1 audit row for pre-existing core schema");
    written++;
  }

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
  return written;
}

export const schemaEventsStep: UpgradeStep = {
  title: "move the migration records into nextly_schema_events",
  pending,
  run,
};
