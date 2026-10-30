/**
 * What the schema ledger says is wrong now: migrations whose last attempt did
 * not finish, and collections whose last schema change failed.
 *
 * A read accessor over `nextly_schema_events`, the record the schema domain
 * already keeps of every migration and schema change, for System health. It
 * decides nothing of its own:
 *
 * - a migration file is a problem when its NEWEST `file_apply` event is an
 *   attempt that did not finish (`attemptUnfinished`: failed, or still
 *   `in_progress` with no outcome), the rule `migrate:resolve` and the
 *   partial-apply refusal read; an older failure a later apply superseded is
 *   history, not a problem;
 * - a collection is a problem when its NEWEST schema change (a Schema Builder
 *   save, a dev push or a `db:sync`, the events the admin's schema journal
 *   lists) failed.
 *
 * ## Bounded
 *
 * One query over the newest {@link SCHEMA_PROBLEM_EVENTS} events of those
 * types, newest first on the indexed `started_at`, selecting only the columns
 * the rule reads. The first event met for a file or a collection is its newest
 * one. A file or collection whose every event is older than that window has
 * changed nothing since, and `nextly migrate:status` still reports it.
 *
 * @module domains/schema/events/schema-problems
 */

import { desc, inArray } from "drizzle-orm";

import { schemaEventsTables } from "../../../schemas/schema-events";
import type {
  SchemaEventStatus,
  SchemaEventType,
} from "../../../schemas/schema-events/types";

import { attemptUnfinished } from "./migration-state";

/** How many of the newest events one read looks at. */
export const SCHEMA_PROBLEM_EVENTS = 500;

/** The events that record a schema change to one collection, as the admin's journal lists them. */
const SCHEMA_CHANGE_EVENTS = ["ui_save", "dev_push", "db_sync"] as const;

/** The event types the read looks at: migration files, and schema changes. */
const READ_EVENTS: readonly SchemaEventType[] = [
  "file_apply",
  ...SCHEMA_CHANGE_EVENTS,
];

/** What the ledger says is wrong now. */
export interface SchemaProblems {
  /** Migration files whose newest attempt failed or never finished, newest first. */
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

/** One event as the rule reads it. */
interface ProblemEvent {
  eventType: string;
  status: string;
  filename: string | null;
  scopeKind: string | null;
  scopeSlug: string | null;
}

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** A row read back, as the fields the rule reads. */
function asEvent(row: Record<string, unknown>): ProblemEvent {
  return {
    eventType: String(row.eventType),
    status: String(row.status),
    filename: textOrNull(row.filename),
    scopeKind: textOrNull(row.scopeKind),
    scopeSlug: textOrNull(row.scopeSlug),
  };
}

/**
 * Which files and collections are a problem, from events newest first: each
 * judged by the first (newest) event met for it.
 */
export function problemsFromNewestFirst(
  events: readonly ProblemEvent[]
): SchemaProblems {
  const seenFiles = new Set<string>();
  const seenCollections = new Set<string>();
  const problems: SchemaProblems = {
    unfinishedMigrations: [],
    failedCollectionChanges: [],
  };
  for (const event of events) {
    if (event.eventType === "file_apply" && event.filename !== null) {
      if (seenFiles.has(event.filename)) continue;
      seenFiles.add(event.filename);
      if (attemptUnfinished({ status: event.status as SchemaEventStatus })) {
        problems.unfinishedMigrations.push(event.filename);
      }
      continue;
    }
    if (event.scopeKind !== "collection" || event.scopeSlug === null) continue;
    if (seenCollections.has(event.scopeSlug)) continue;
    seenCollections.add(event.scopeSlug);
    if (event.status === "failed") {
      problems.failedCollectionChanges.push(event.scopeSlug);
    }
  }
  return problems;
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
      scopeKind: table.scopeKind,
      scopeSlug: table.scopeSlug,
    })
    .from(table)
    .where(inArray(table.eventType, [...READ_EVENTS]))
    .orderBy(desc(table.startedAt))
    .limit(SCHEMA_PROBLEM_EVENTS);
  return problemsFromNewestFirst(rows.map(asEvent));
}
