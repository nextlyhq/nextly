/**
 * What the schema ledger says is wrong now: migrations with an attempt that
 * did not finish, and collections whose last schema change failed.
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
 *   the migration is still applied, as `migrate:status` warns of it;
 * - a collection is a problem when its NEWEST schema change (a Schema Builder
 *   save, a dev push or a `db:sync`, the events the admin's schema journal
 *   lists) failed.
 *
 * ## Bounded
 *
 * One query over the newest {@link SCHEMA_PROBLEM_EVENTS} events of those
 * types, newest first on the indexed `started_at`, selecting only the columns
 * the rules read. A standing reads a file's records newest first and stops at
 * the first that resolves an attempt, so the window answers it as the whole
 * ledger would, for every file with an attempt inside it. A file or
 * collection whose every event is older than that window has changed nothing
 * since, and `nextly migrate:status` still reports it.
 *
 * @module domains/schema/events/schema-problems
 */

import { desc, inArray } from "drizzle-orm";

import { schemaEventsTables } from "../../../schemas/schema-events";
import type {
  SchemaEventStatus,
  SchemaEventType,
} from "../../../schemas/schema-events/types";

import { standingsByFilename } from "./migration-state";
import type { SchemaEventRow } from "./schema-events-repository";

/** How many of the newest events one read looks at. */
export const SCHEMA_PROBLEM_EVENTS = 500;

/** The events that record a schema change to one collection, as the admin's journal lists them. */
const SCHEMA_CHANGE_EVENTS = ["ui_save", "dev_push", "db_sync"] as const;

/** The records of a migration: its applies and outcomes, and its rollbacks' attempts. */
const MIGRATION_EVENTS = ["file_apply", "file_rollback"] as const;

/** The event types the read looks at: migrations, and schema changes. */
const READ_EVENTS: readonly SchemaEventType[] = [
  ...MIGRATION_EVENTS,
  ...SCHEMA_CHANGE_EVENTS,
];

/** What the ledger says is wrong now. */
export interface SchemaProblems {
  /**
   * Migrations whose standing has an unresolved attempt, an apply's or a
   * rollback's, by ledger key, the most recently recorded first.
   */
  unfinishedMigrations: string[];
  /** Collections whose newest schema change failed, by slug, newest first. */
  failedCollectionChanges: string[];
}

/** The one select chain this read makes, in the form all three dialects share. */
interface ProblemsDb {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (clause: unknown) => {
        orderBy: (order: unknown) => {
          limit: (n: number) => Promise<Record<string, unknown>[]>;
        };
      };
    };
  };
}

/** One event as the rules read it: what a standing reads, and a change's scope. */
type ProblemEvent = Pick<
  SchemaEventRow,
  "eventType" | "status" | "filename" | "startedAt" | "supersededEventIds"
> & {
  scopeKind: string | null;
  scopeSlug: string | null;
};

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/**
 * A row read back, as the fields the rules read. The query names the event
 * types and the columns, so each is the column's own type as the dialect's
 * table maps it; the values are carried as they came.
 */
function asEvent(row: Record<string, unknown>): ProblemEvent {
  const startedAt = row.startedAt;
  return {
    eventType: row.eventType as SchemaEventType,
    status: row.status as SchemaEventStatus,
    filename: textOrNull(row.filename),
    startedAt:
      startedAt instanceof Date ? startedAt : new Date(String(startedAt)),
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

/**
 * Which migrations and collections are a problem, from events newest first:
 * each migration by its standing (`standingsByFilename`), each collection by
 * the first (newest) schema change met for it.
 */
export function problemsFromNewestFirst(
  events: readonly ProblemEvent[]
): SchemaProblems {
  const unfinishedMigrations: string[] = [];
  // In the order each file is first met, which newest first is the order of
  // its most recent record.
  for (const [filename, standing] of standingsByFilename(
    events.filter(isMigrationEvent)
  )) {
    if (standing.unresolvedAttempt !== undefined) {
      unfinishedMigrations.push(filename);
    }
  }
  const seenCollections = new Set<string>();
  const failedCollectionChanges: string[] = [];
  for (const event of events) {
    if (isMigrationEvent(event)) continue;
    if (event.scopeKind !== "collection" || event.scopeSlug === null) continue;
    if (seenCollections.has(event.scopeSlug)) continue;
    seenCollections.add(event.scopeSlug);
    if (event.status === "failed") {
      failedCollectionChanges.push(event.scopeSlug);
    }
  }
  return { unfinishedMigrations, failedCollectionChanges };
}

/** What the schema ledger says is wrong now, in one bounded read. */
export async function readSchemaProblems(args: {
  db: unknown;
  dialect: "postgresql" | "mysql" | "sqlite";
}): Promise<SchemaProblems> {
  const table = schemaEventsTables(args.dialect).nextlySchemaEvents;
  // The handle arrives untyped so this layer leaks no dialect's Drizzle type;
  // read through the one chain it makes, as the ledger's repository does.
  const db = args.db as ProblemsDb;
  const rows = await db
    .select({
      eventType: table.eventType,
      status: table.status,
      filename: table.filename,
      startedAt: table.startedAt,
      supersededEventIds: table.supersededEventIds,
      scopeKind: table.scopeKind,
      scopeSlug: table.scopeSlug,
    })
    .from(table)
    .where(inArray(table.eventType, [...READ_EVENTS]))
    .orderBy(desc(table.startedAt))
    .limit(SCHEMA_PROBLEM_EVENTS);
  return problemsFromNewestFirst(rows.map(asEvent));
}
