/**
 * `nextly migrate` on a database an earlier release kept its migration
 * records in: the records are moved into `nextly_schema_events` before the
 * run reads its history, since every check of that history reads the events
 * table.
 *
 * The run confirms a backup first (`--backup-confirmed`, or a yes at a
 * terminal), then holds the schema lock for the whole move. Without the
 * confirmation it changes nothing and names the flag.
 *
 * The move backfills legacy `nextly_migrations` + `nextly_migration_journal` rows into
 * the `nextly_schema_events` table, creating it when absent, records one
 * audit row for the core schema that already exists, and drops the legacy
 * tables.
 *
 * `nextly_migrations` is read in whichever shape an earlier release kept it
 * (`legacyLedgerShape`), and every row is read before anything is written, so
 * a row the move cannot read stops the run with the database unchanged.
 *
 * Resumable rather than one transaction: MySQL commits a `DROP TABLE` on its
 * own, so a transaction around the move would promise on one dialect what it
 * cannot keep. Instead every row is written before the legacy tables are
 * dropped, and a record already in the events table is not written again. A
 * run stopped anywhere keeps the legacy tables, and the next run finishes the
 * move without writing anything twice.
 *
 * @module cli/commands/legacy-bookkeeping
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import type { BusyTableBounds } from "../../domains/schema/busy-table/bounds";
import { runStatementsInTries } from "../../domains/schema/busy-table/run-on-session";
import {
  legacyLedgerShape,
  mapJournalRow,
  mapMigrationsRow,
  readLegacyLedgerRow,
  synthesizedCoreApplyEvent,
  type BackfillEvent,
  type LegacyMigrationsRow,
} from "../../domains/schema/events/backfill";
import { detectLegacyBookkeeping } from "../../domains/schema/events/legacy-detection";
import { getSchemaEventsDdl } from "../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { quoteIdent } from "../../domains/schema/pipeline/sql-templates/identifier-quoting";
import { NextlyError } from "../../errors";
import type { DryRunPlan } from "../dry-run";

import type { UpgradeAdapter, UpgradeDialect } from "./upgrade-step";

/** What the move is handed: the database, the run's busy-table bounds and its log. */
interface LegacyBookkeepingContext {
  adapter: UpgradeAdapter;
  db: unknown;
  dialect: UpgradeDialect;
  /** The bounds each schema statement waits for a busy table within, read before anything changes. */
  bounds: BusyTableBounds;
  log: (message: string) => void;
  warn: (message: string) => void;
}

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

/** What a busy-table report and the schema lock's claim call the move. */
const MIGRATE_COMMAND = "nextly migrate";

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
 * Runs the move's schema statements in order and returns what a report calls each one that ran.
 * On the command's adapter each statement waits for a busy table in its own tries, bounded by
 * the run's bounds (`--lock-timeout`, `--lock-timeout-total`), each try's notice through its warning
 * (`runStatementsInTries`); one that stays busy stops the run with `NEXTLY_TABLE_BUSY`, naming
 * the statements before it, which stay.
 */
async function runSchemaStatements(
  context: LegacyBookkeepingContext,
  statements: readonly string[],
  name: (index: number) => string,
  appliedBefore: readonly string[]
): Promise<readonly string[]> {
  const adapter = sessionAdapterOf(context.adapter);
  if (adapter === undefined) {
    for (const statement of statements) {
      await execRaw(context.db, context.dialect, statement);
    }
    return statements.map((_, index) => `${MIGRATE_COMMAND}: ${name(index)}`);
  }
  return runStatementsInTries(adapter, statements, {
    change: MIGRATE_COMMAND,
    bounds: context.bounds,
    notify: context.warn,
    appliedBefore,
    name,
  });
}

/**
 * The column names of `table` in the live database, lowercased. On
 * PostgreSQL the table is the one `to_regclass` resolves, as the adapter's
 * `tableExists` and the step's unqualified statements resolve it: through
 * the search path, which need not find it in the path's first schema.
 */
async function columnsOf(
  db: unknown,
  dialect: UpgradeDialect,
  table: string
): Promise<string[]> {
  const statement =
    dialect === "sqlite"
      ? `SELECT name AS column_name FROM pragma_table_info('${table}')`
      : dialect === "postgresql"
        ? `SELECT attname AS column_name FROM pg_attribute WHERE attrelid = to_regclass('${table}') AND attnum > 0 AND NOT attisdropped`
        : `SELECT COLUMN_NAME AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`;
  const rows = await queryRaw(db, dialect, statement);
  return rows.map(row =>
    String(row.column_name ?? row.COLUMN_NAME).toLowerCase()
  );
}

/** What the run moves out of `nextly_migrations`, read whole before anything is written. */
interface LegacyLedgerPlan {
  moves: LegacyMigrationsRow[];
  skips: { filename: string; status: string }[];
}

/**
 * Every row of `nextly_migrations`, read through the shape the table has.
 * A table of no known shape that holds rows, or a row whose meaning is not
 * known, stops the run here, before anything is written: guessed into
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

/** The refusal of a `nextly_migrations` table whose records cannot be read. */
function ledgerUnreadable(why: string): NextlyError {
  return new NextlyError({
    code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
    publicMessage:
      `The table "nextly_migrations" holds records \`nextly migrate\` cannot read: ${why}. ` +
      "Rename the table if Nextly did not create it, then run `nextly migrate` again.",
    logContext: {
      reason: "migrate-ledger-unreadable",
      table: "nextly_migrations",
    },
  });
}

/** One legacy table the run would move and drop, with the records it holds now. */
interface LegacyTablePlan {
  table: string;
  rows: number;
}

/**
 * What the move would do, read without writing: each legacy table with the
 * number of records it holds. A table of another shape under the events
 * table's name, or a `nextly_migrations` record that cannot be read, stops
 * the run here, a dry run's too, before the backup question and before
 * anything is written.
 */
async function planMove(
  context: Pick<LegacyBookkeepingContext, "adapter" | "db" | "dialect">
): Promise<LegacyTablePlan[]> {
  const { adapter, db, dialect } = context;
  const legacy = await detectLegacyBookkeeping(adapter);

  if (
    (await adapter.tableExists(EVENTS_TABLE)) &&
    !(await hasExpectedShape(db, dialect, EVENTS_TABLE))
  ) {
    throw new NextlyError({
      code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
      publicMessage:
        `A table named "${EVENTS_TABLE}" already exists with an unexpected ` +
        "shape. Rename it, then run `nextly migrate` again.",
      logContext: { reason: "migrate-events-table-taken", table: EVENTS_TABLE },
    });
  }

  // Read whole first, so a table the run could not move is refused here.
  if (legacy.tables.includes("nextly_migrations")) {
    await readLegacyLedger(db, dialect);
  }

  const plan: LegacyTablePlan[] = [];
  for (const table of legacy.tables) {
    const [count] = await queryRaw(
      db,
      dialect,
      `SELECT COUNT(*) AS n FROM ${quoteIdent(table, dialect)}`
    );
    plan.push({ table, rows: Number(count?.n ?? 0) });
  }
  return plan;
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
  context: LegacyBookkeepingContext
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
  context: LegacyBookkeepingContext
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
async function run(context: LegacyBookkeepingContext): Promise<number> {
  const { adapter, db, dialect, log } = context;
  const eventsTable = EVENTS_TABLE;
  const legacy = await detectLegacyBookkeeping(adapter);

  // What the move applied, as a busy-table report names it.
  const applied: string[] = [];
  if (!(await adapter.tableExists(eventsTable))) {
    const ddl = getSchemaEventsDdl(dialect);
    applied.push(
      ...(await runSchemaStatements(
        context,
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
        [`DROP TABLE IF EXISTS ${quoteIdent(table, dialect)}`],
        () => `the drop of table ${JSON.stringify(table)}`,
        applied
      ))
    );
    log(`Dropped ${table}`);
  }
  return written;
}

/**
 * The move's plan, or undefined once no legacy table is left.
 *
 * The plan is read before the lock, so another run holding it may drop a
 * table between this run finding it and reading it: the read then fails on a
 * table that is gone, or finds none. Either way the records are moved, by
 * that run, and there is nothing here to refuse. A read that fails while a
 * legacy table still stands is the refusal it is.
 */
async function planWhileLegacyStands(
  context: Pick<LegacyBookkeepingContext, "adapter" | "db" | "dialect">
): Promise<LegacyTablePlan[] | undefined> {
  const stands = async () =>
    (await detectLegacyBookkeeping(context.adapter)).hasLegacy;
  let plan: LegacyTablePlan[];
  try {
    plan = await planMove(context);
  } catch (error) {
    if (await stands()) throw error;
    return undefined;
  }
  // Read again after the plan: a table planned and since dropped is moved.
  return plan.length > 0 && (await stands()) ? plan : undefined;
}

/** What `consolidateLegacyBookkeeping` is handed by `nextly migrate`. */
export interface ConsolidateLegacyArgs {
  /** The run's adapter, whose sessions the schema statements and the lock use. */
  adapter: DrizzleAdapter;
  dialect: UpgradeDialect;
  /** The run's busy-table bounds, checked before anything was read. */
  bounds: BusyTableBounds;
  /** Whether the operator stated a backup exists (`--backup-confirmed`). */
  backupConfirmed: boolean;
  /** Whether a person is at a terminal to be asked. */
  interactive: boolean;
  /** Asks that person whether the database is backed up; only called when `interactive`. */
  askBackedUp: () => Promise<boolean>;
  /** Runs before the lock is taken, once the backup is confirmed: `--force-unlock`. */
  beforeLock?: () => Promise<void>;
  /** The schema lock's lease, in seconds, as the configuration sets it. */
  lockTtlSeconds?: number;
  log: (message: string) => void;
  warn: (message: string) => void;
}

/** The move's context over the run's adapter. */
function contextOf(
  args: Pick<
    ConsolidateLegacyArgs,
    "adapter" | "dialect" | "bounds" | "log" | "warn"
  >
): LegacyBookkeepingContext {
  return {
    adapter: args.adapter,
    db: args.adapter.getDrizzle(),
    dialect: args.dialect,
    bounds: args.bounds,
    log: args.log,
    warn: args.warn,
  };
}

/** The refusal of a move whose backup nobody confirmed, and nobody can be asked about. */
function backupNotConfirmed(): NextlyError {
  return new NextlyError({
    code: "NEXTLY_UPGRADE_IN_PROGRESS",
    publicMessage:
      "This database keeps its migration records the way an earlier Nextly release did, and `nextly migrate` moves them only once a backup is confirmed. " +
      "Back up the database, then run `nextly migrate --backup-confirmed`.",
    logContext: { reason: "migrate-backup-not-confirmed" },
  });
}

/** The refusal of a move whose backup question was answered no. */
function backupDeclined(): NextlyError {
  return new NextlyError({
    code: "NEXTLY_UPGRADE_IN_PROGRESS",
    publicMessage:
      "The migration records of an earlier Nextly release were not moved: the backup question was answered no. " +
      "Back up the database, then run `nextly migrate` again and answer yes, or pass `--backup-confirmed`.",
    logContext: { reason: "migrate-backup-declined" },
  });
}

/**
 * Moves the migration records an earlier release kept into
 * `nextly_schema_events`, for a `nextly migrate` run that found a legacy
 * table. Returns once the legacy tables are gone, so the run reads its
 * history where every check expects it.
 *
 * In order: the tables are read whole, so one the run cannot move is refused
 * with nothing asked; the backup is confirmed, by the flag or by a yes at a
 * terminal, before the lock, so no other run waits on a person; then the
 * schema lock is held from the first statement to the last drop. Without the
 * confirmation nothing is written, the lock's own table included.
 */
export async function consolidateLegacyBookkeeping(
  args: ConsolidateLegacyArgs
): Promise<void> {
  const context = contextOf(args);
  // Nothing left to move: another run moved the records while this one was
  // starting. Nobody is asked and nothing is refused; the run carries on.
  if ((await planWhileLegacyStands(context)) === undefined) return;

  if (!args.backupConfirmed) {
    if (!args.interactive) throw backupNotConfirmed();
    if (!(await args.askBackedUp())) throw backupDeclined();
  }

  await args.beforeLock?.();
  await withMigrateLock(
    args.adapter,
    args.dialect,
    async () => {
      // Read again under the lock: a run this one waited behind may have
      // moved the records already, and then there is nothing left to do.
      if (!(await detectLegacyBookkeeping(context.adapter)).hasLegacy) return;
      const written = await run(context);
      args.log(
        `Moved the migration records of an earlier release into ${EVENTS_TABLE}: ${String(written)} written.`
      );
    },
    {
      command: MIGRATE_COMMAND,
      mode: "wait",
      ttlSeconds: args.lockTtlSeconds,
      releaseOnInterrupt: true,
      logger: { warn: args.warn, info: args.log },
    }
  );
}

/**
 * `nextly migrate --dry-run` on a database with a legacy table: the move as
 * the real run would make it, read-only, with no backup question and no lock.
 * The run's pending migrations are not listed: which files have applied is
 * recorded in the legacy tables until the move, and every check of that
 * history reads the events table. Undefined once no legacy table is left:
 * another run moved the records, and the dry run lists the rest as usual.
 */
export async function previewLegacyConsolidation(args: {
  adapter: DrizzleAdapter;
  dialect: UpgradeDialect;
  backupConfirmed: boolean;
  /** Whether a real run could ask at a terminal. */
  interactive: boolean;
}): Promise<DryRunPlan | undefined> {
  let tables: LegacyTablePlan[] | undefined;
  try {
    tables = await planWhileLegacyStands({
      adapter: args.adapter,
      db: args.adapter.getDrizzle(),
      dialect: args.dialect,
    });
  } catch (error) {
    // The real run stops here, so the dry run reports it as that run's refusal.
    if (!NextlyError.isCode(error, "NEXTLY_UPGRADE_TABLE_NAME_COLLISION")) {
      throw error;
    }
    return { changes: [], refusals: [error.publicMessage] };
  }
  if (tables === undefined) return undefined;
  const notes: string[] = [];
  let refusal: string | undefined;
  if (!args.backupConfirmed) {
    if (args.interactive) {
      notes.push(
        "A real run first asks whether the database is backed up; pass --backup-confirmed to confirm it without being asked."
      );
    } else {
      refusal = backupNotConfirmed().publicMessage;
    }
  }
  notes.push(
    "The pending migrations are listed once the records are moved: run `nextly migrate --dry-run` again after a real run."
  );
  return {
    changes: tables.flatMap(({ table, rows }) => [
      {
        action: "move",
        target: `${String(rows)} ${rows === 1 ? "record" : "records"} from ${table} into ${EVENTS_TABLE}`,
      },
      { action: "remove", target: `table ${table}` },
    ]),
    ...(refusal !== undefined ? { refusals: [refusal] } : {}),
    notes,
  };
}
