/**
 * What the schema ledger says is wrong now: migrations with an attempt that
 * did not finish, and collections whose last schema change failed or was
 * interrupted.
 *
 * A read accessor over `nextly_schema_events`, the record the schema domain
 * already keeps of every migration and schema change, for System health. It
 * decides nothing of its own:
 *
 * - a migration is a problem when its STANDING has an unresolved attempt
 *   (`standingsByFilename`, the rule `migrate:status`, `migrate`,
 *   `migrate:down` and `migrate:resolve` read the ledger by): an apply or a
 *   rollback (`migrate:down`, a plugin's uninstall) that failed or recorded no
 *   outcome, with no outcome since that resolves it. So an older failure an
 *   apply, a rollback or `migrate:resolve` superseded is history, not a
 *   problem; and a failed rollback of an applied migration is one, although
 *   the migration is still applied, as `migrate:status` warns of it. An
 *   attempt still `in_progress`, with no end, that started less than
 *   {@link SCHEMA_CHANGE_STALE_MS} ago is running, not a problem: another
 *   process (a CLI, a second instance) may be applying it now;
 * - a collection is a problem when its NEWEST schema change (a Schema Builder
 *   save, a dev push or a `db:sync`, the events the admin's schema journal
 *   lists) failed, or was interrupted: it is still `in_progress`, with no
 *   end, {@link SCHEMA_CHANGE_STALE_MS} after it started. One that started
 *   more recently is running, not a problem.
 *
 * ## Each key's current state, in three bounded reads
 *
 * A window over the whole ledger's newest events would let unrelated newer
 * events push an older unresolved failure out of it, and the card would call
 * the install healthy while `migrate:status` did not. So the state is read
 * per key, from the few rows that could be a problem:
 *
 * 1. the candidates: the newest {@link SCHEMA_PROBLEM_CANDIDATES} rows that
 *    failed or are still `in_progress`, newest first on the indexed
 *    `started_at`. Most events succeed, so these are few, and every key with
 *    a problem has one among them however many events came after it;
 * 2. for the migrations among them (at most {@link SCHEMA_PROBLEM_KEYS}), each
 *    one's own records, by filename, which its standing is read from;
 * 3. for the collections among them (as many), which have had a schema change
 *    since their newest candidate, by the indexed scope, one row per
 *    collection at most.
 *
 * `filename` has no index of its own beyond the applied rows' unique one; the
 * second read narrows by it as the repository's own per-file reads do.
 *
 * @module domains/schema/events/schema-problems
 */

import { and, desc, eq, gt, inArray, ne, or } from "drizzle-orm";

import { schemaEventsTables } from "../../../schemas/schema-events";
import type {
  SchemaEventStatus,
  SchemaEventType,
} from "../../../schemas/schema-events/types";

import { standingsByFilename } from "./migration-state";
import type { SchemaEventRow } from "./schema-events-repository";

/** How many of the newest failed or unfinished rows one read looks at. */
const SCHEMA_PROBLEM_CANDIDATES = 200;

/** How many migrations, and how many collections, one read judges. */
const SCHEMA_PROBLEM_KEYS = 25;

/** How many of one migration's newest records its standing is read from. */
const RECORDS_PER_MIGRATION = 100;

/**
 * How long a schema change, or a migration's attempt, may stay `in_progress`
 * before it reads as interrupted. A Schema Builder save, a dev push or a
 * `db:sync` finishes in seconds; one still open ten minutes on lost its
 * process (killed, out of memory, a dropped connection) after `recordStart`
 * and before `recordEnd`, and may have applied part of its change. A
 * migration recorded by another process (a CLI, a second instance in a
 * rolling deployment) is judged by the same clock.
 */
export const SCHEMA_CHANGE_STALE_MS = 10 * 60 * 1000;

/** The events that record a schema change to one collection, as the admin's journal lists them. */
const SCHEMA_CHANGE_EVENTS = ["ui_save", "dev_push", "db_sync"] as const;

/** The records of a migration: its applies and outcomes, and its rollbacks' attempts. */
const MIGRATION_EVENTS = ["file_apply", "file_rollback"] as const;

/** The event types the read looks at: migrations, and schema changes. */
const READ_EVENTS: readonly SchemaEventType[] = [
  ...MIGRATION_EVENTS,
  ...SCHEMA_CHANGE_EVENTS,
];

/** The statuses a candidate can be in: a problem, or one if it never ends. */
const CANDIDATE_STATUSES: readonly SchemaEventStatus[] = [
  "failed",
  "in_progress",
];

/** What the ledger says is wrong now. */
export interface SchemaProblems {
  /**
   * Migrations whose standing has an unresolved attempt, an apply's or a
   * rollback's, that failed or was interrupted, by ledger key, the most
   * recently recorded first.
   */
  unfinishedMigrations: string[];
  /**
   * Migrations whose unresolved attempt is still running: `in_progress`,
   * with no end, started within {@link SCHEMA_CHANGE_STALE_MS}. By ledger
   * key, the most recently recorded first.
   */
  runningMigrations: string[];
  /**
   * Collections whose newest schema change failed or was interrupted, by
   * slug, newest first.
   */
  failedCollectionChanges: string[];
}

/** A read's rows, as each chain this read makes ends. */
type Rows = Promise<Record<string, unknown>[]>;

/** The select chains this read makes, in the form all three dialects share. */
interface ProblemsDb {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (clause: unknown) => {
        orderBy: (order: unknown) => { limit: (n: number) => Rows };
        groupBy: (column: unknown) => Rows;
      };
    };
  };
}

/** One event as the rules read it: what a standing reads, and a change's scope. */
type ProblemEvent = Pick<
  SchemaEventRow,
  "eventType" | "status" | "filename" | "startedAt" | "supersededEventIds"
> & {
  endedAt: Date | null;
  scopeKind: string | null;
  scopeSlug: string | null;
};

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const dateOf = (value: unknown): Date =>
  value instanceof Date ? value : new Date(String(value));

/**
 * A row read back, as the fields the rules read. The query names the event
 * types and the columns, so each is the column's own type as the dialect's
 * table maps it; the values are carried as they came.
 */
function asEvent(row: Record<string, unknown>): ProblemEvent {
  return {
    eventType: row.eventType as SchemaEventType,
    status: row.status as SchemaEventStatus,
    filename: textOrNull(row.filename),
    startedAt: dateOf(row.startedAt),
    endedAt:
      row.endedAt === null || row.endedAt === undefined
        ? null
        : dateOf(row.endedAt),
    supersededEventIds: Array.isArray(row.supersededEventIds)
      ? row.supersededEventIds.filter(
          (id): id is string => typeof id === "string"
        )
      : null,
    scopeKind: textOrNull(row.scopeKind),
    scopeSlug: textOrNull(row.scopeSlug),
  };
}

const isMigrationEvent = (event: ProblemEvent): boolean =>
  (MIGRATION_EVENTS as readonly string[]).includes(event.eventType);

/** A collection's slug, when the event is a schema change to one. */
const collectionOf = (event: ProblemEvent): string | null =>
  !isMigrationEvent(event) && event.scopeKind === "collection"
    ? event.scopeSlug
    : null;

/** Whether an event is still open, with no end, at `now`. */
const isOpen = (event: ProblemEvent): boolean =>
  event.status === "in_progress" && event.endedAt === null;

/**
 * Whether an open event is still running at `now`: it started no more than
 * {@link SCHEMA_CHANGE_STALE_MS} ago. Past that, it was interrupted.
 */
const isRunning = (event: ProblemEvent, now: Date): boolean =>
  isOpen(event) &&
  now.getTime() - event.startedAt.getTime() <= SCHEMA_CHANGE_STALE_MS;

/**
 * Whether a collection's newest schema change is a problem: it failed, or it
 * is still open with no end {@link SCHEMA_CHANGE_STALE_MS} after it started.
 */
function changeIsProblem(event: ProblemEvent, now: Date): boolean {
  if (event.status === "failed") return true;
  return isOpen(event) && !isRunning(event, now);
}

/**
 * Which migrations and collections are a problem, from events newest first:
 * each migration by its standing (`standingsByFilename`), its unresolved
 * attempt running or not at `now`, and each collection by the first (newest)
 * schema change met for it, judged at `now`.
 */
export function problemsFromNewestFirst(
  events: readonly ProblemEvent[],
  now: Date = new Date()
): SchemaProblems {
  const unfinishedMigrations: string[] = [];
  const runningMigrations: string[] = [];
  // In the order each file is first met, which newest first is the order of
  // its most recent record.
  for (const [filename, standing] of standingsByFilename(
    events.filter(isMigrationEvent)
  )) {
    const attempt = standing.unresolvedAttempt;
    if (attempt === undefined) continue;
    if (isRunning(attempt, now)) runningMigrations.push(filename);
    else unfinishedMigrations.push(filename);
  }
  const seenCollections = new Set<string>();
  const failedCollectionChanges: string[] = [];
  for (const event of events) {
    const slug = collectionOf(event);
    if (slug === null || seenCollections.has(slug)) continue;
    seenCollections.add(slug);
    if (changeIsProblem(event, now)) failedCollectionChanges.push(slug);
  }
  return { unfinishedMigrations, runningMigrations, failedCollectionChanges };
}

/** A candidate collection: its newest failed or unfinished change, and that row's id. */
interface CandidateChange {
  id: string;
  event: ProblemEvent;
}

/**
 * The keys the candidates name, each in the order of its newest candidate
 * (newest first), at most {@link SCHEMA_PROBLEM_KEYS} of each kind; for a
 * collection, its newest candidate row.
 */
function candidateKeys(rows: readonly Record<string, unknown>[]): {
  migrations: string[];
  collections: Map<string, CandidateChange>;
} {
  const migrations = new Set<string>();
  const collections = new Map<string, CandidateChange>();
  for (const row of rows) {
    const event = asEvent(row);
    const migration = isMigrationEvent(event) ? event.filename : null;
    if (migration !== null && migrations.size < SCHEMA_PROBLEM_KEYS) {
      migrations.add(migration);
    }
    const slug = collectionOf(event);
    if (
      slug !== null &&
      !collections.has(slug) &&
      collections.size < SCHEMA_PROBLEM_KEYS
    ) {
      collections.set(slug, { id: String(row.id), event });
    }
  }
  return { migrations: [...migrations], collections };
}

/** What the schema ledger says is wrong now, each key by its current state, in bounded reads. */
export async function readSchemaProblems(args: {
  db: unknown;
  dialect: "postgresql" | "mysql" | "sqlite";
  /** When an open schema change is judged from; now, unless a test says. */
  now?: Date;
}): Promise<SchemaProblems> {
  const table = schemaEventsTables(args.dialect).nextlySchemaEvents;
  // The handle arrives untyped so this layer leaks no dialect's Drizzle type;
  // read through the chains it makes, as the ledger's repository does.
  const db = args.db as ProblemsDb;
  const columns = {
    eventType: table.eventType,
    status: table.status,
    filename: table.filename,
    startedAt: table.startedAt,
    endedAt: table.endedAt,
    supersededEventIds: table.supersededEventIds,
    scopeKind: table.scopeKind,
    scopeSlug: table.scopeSlug,
  };

  const candidates = await db
    .select({ id: table.id, ...columns })
    .from(table)
    .where(
      and(
        inArray(table.eventType, [...READ_EVENTS]),
        inArray(table.status, [...CANDIDATE_STATUSES])
      )
    )
    .orderBy(desc(table.startedAt))
    .limit(SCHEMA_PROBLEM_CANDIDATES);
  const keys = candidateKeys(candidates);

  // Every record of each candidate migration, newest first: its standing
  // reads them back to the first that resolves an attempt.
  const migrationRows =
    keys.migrations.length === 0
      ? []
      : await db
          .select(columns)
          .from(table)
          .where(
            and(
              inArray(table.filename, keys.migrations),
              inArray(table.eventType, [...MIGRATION_EVENTS])
            )
          )
          .orderBy(desc(table.startedAt))
          .limit(keys.migrations.length * RECORDS_PER_MIGRATION);

  // The candidate collections with a schema change after their newest
  // candidate, which is then not their newest change. The candidate's own
  // row is excluded by id, so a column that keeps finer time than the value
  // read back cannot count it as newer than itself. "After" is a strict
  // comparison of start times: the ledger stamps each scope's changes in
  // strictly increasing milliseconds where they are written
  // (`SchemaEventsRepository.recordStart`), so a retry recorded in the same
  // millisecond as the failure it fixed still reads as newer on every dialect.
  const changedSince =
    keys.collections.size === 0
      ? []
      : await db
          .select({ scopeSlug: table.scopeSlug })
          .from(table)
          .where(
            and(
              inArray(table.eventType, [...SCHEMA_CHANGE_EVENTS]),
              eq(table.scopeKind, "collection"),
              or(
                ...[...keys.collections].map(([slug, { id, event }]) =>
                  and(
                    eq(table.scopeSlug, slug),
                    gt(table.startedAt, event.startedAt),
                    ne(table.id, id)
                  )
                )
              )
            )
          )
          .groupBy(table.scopeSlug);
  const superseded = new Set(
    changedSince.map(row => textOrNull(row.scopeSlug))
  );

  return problemsFromNewestFirst(
    [
      ...migrationRows.map(asEvent),
      ...[...keys.collections]
        .filter(([slug]) => !superseded.has(slug))
        .map(([, candidate]) => candidate.event),
    ],
    args.now
  );
}
