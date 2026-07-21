/**
 * Repository for `nextly_schema_events` — the consolidated bookkeeping table
 * (spec §4.3). Provides record/transition/supersede/prune/query operations.
 *
 * This is the API that Plan C's pipeline rewire consumes. Plan B uses it for
 * the `nextly upgrade` backfill. Dialect-agnostic: `db` is typed `unknown`
 * (the schema-domain layer does not leak dialect-specific Drizzle types) and
 * the correct per-dialect table is selected from `schemaEventsTables(dialect)`.
 *
 * @module domains/schema/events/schema-events-repository
 * @since v0.0.3-alpha (Plan B)
 */

import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors";
import { schemaEventsTables } from "../../../schemas/schema-events";
import { selectPrunableEventIds } from "../../../schemas/schema-events/pruning";
import type {
  SchemaEventScopeKind,
  SchemaEventSource,
  SchemaEventStatus,
  SchemaEventType,
} from "../../../schemas/schema-events/types";

import { newestEvent } from "./newest-event";

type Dialect = "postgresql" | "mysql" | "sqlite";

/** Structural shape of the Drizzle DB methods this repository uses. */
type SelectChain = Promise<Array<Record<string, unknown>>> & {
  where: (c: unknown) => Promise<Array<Record<string, unknown>>>;
};
interface AnyDb {
  insert: (t: unknown) => {
    values: (v: Record<string, unknown>) => Promise<unknown>;
  };
  select: () => { from: (t: unknown) => SelectChain };
  update: (t: unknown) => {
    set: (v: Record<string, unknown>) => {
      where: (c: unknown) => Promise<unknown>;
    };
  };
  delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> };
}

/** A read-back schema-events row (camelCase, as Drizzle maps it). */
export interface SchemaEventRow {
  id: string;
  eventType: SchemaEventType;
  status: SchemaEventStatus;
  source: SchemaEventSource;
  filename: string | null;
  sha256: string | null;
  scopeKind: SchemaEventScopeKind | null;
  scopeSlug: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  note: string | null;
  statementsExecuted: number | null;
  supersededEventIds: string[] | null;
  supersededBy: string | null;
}

export interface RecordStartInput {
  eventType: SchemaEventType;
  source: SchemaEventSource;
  filename?: string | null;
  sha256?: string | null;
  scopeKind?: SchemaEventScopeKind | null;
  scopeSlug?: string | null;
}

export interface MarkAppliedInput {
  statementsExecuted?: number | null;
  renamesApplied?: number | null;
  durationMs?: number | null;
  /**
   * When set, the row is marked `applied` ONLY if no OTHER applied `file_apply`
   * row already exists for this filename — the atomic "one applied row per
   * file" guard. This replaces the SQLite partial unique index, which
   * drizzle-kit 0.31.10 can't round-trip (drizzle-team/drizzle-orm#4688). On
   * PG/MySQL the migrate lock already serializes runs; SQLite (single-writer,
   * no explicit lock) relies on this check. If the guard blocks the update,
   * `markApplied` resolves the row to `superseded` and returns `false` (another
   * run already applied the file).
   */
  uniqueFilename?: string | null;
}

export interface MarkFailedInput {
  errorCode?: string | null;
  errorMessage?: string | null;
  errorJson?: unknown;
}

/**
 * Storage bound for the `error_message` column.
 *
 * Recorded descriptions can be long — a generated migration statement plus its
 * cause chain and context runs to thousands of characters. Writing that
 * unbounded risks the failure record itself failing, which would leave the
 * migration with no failed status at all: the worst outcome, since the
 * operator then sees neither the error nor the fact that one occurred.
 */
export const ERROR_MESSAGE_MAX_LEN = 1000;

/** Clamp a message to the `error_message` column bound, marking any cut. */
export function truncateErrorMessage(message: string): string {
  return message.length > ERROR_MESSAGE_MAX_LEN
    ? `${message.slice(0, ERROR_MESSAGE_MAX_LEN)}...`
    : message;
}

export class SchemaEventsRepository {
  private readonly db: AnyDb;
  private readonly table: ReturnType<
    typeof schemaEventsTables
  >["nextlySchemaEvents"];

  constructor(db: unknown, dialect: Dialect) {
    this.db = db as AnyDb;
    this.table = schemaEventsTables(dialect).nextlySchemaEvents;
  }

  /** Insert an in_progress event and return its generated id. */
  async recordStart(input: RecordStartInput): Promise<string> {
    const id = crypto.randomUUID();
    const values: Record<string, unknown> = {
      id,
      eventType: input.eventType,
      status: "in_progress",
      source: input.source,
      startedAt: new Date(),
    };
    if (input.filename !== undefined) values.filename = input.filename;
    if (input.sha256 !== undefined) values.sha256 = input.sha256;
    if (input.scopeKind !== undefined) values.scopeKind = input.scopeKind;
    if (input.scopeSlug !== undefined) values.scopeSlug = input.scopeSlug;

    await this.db.insert(this.table).values(values);
    return id;
  }

  /** Insert an already-terminal event in one shot (used by the upgrade backfill). */
  async insertEvent(values: Record<string, unknown>): Promise<string> {
    const id = (values.id as string | undefined) ?? crypto.randomUUID();
    await this.db.insert(this.table).values({ id, ...values });
    return id;
  }

  /**
   * Transition a row to applied. Returns whether this call actually applied it.
   *
   * With `uniqueFilename`, the update is guarded so only one applied `file_apply`
   * row can exist per file (replaces the SQLite partial unique index, which
   * drizzle-kit can't round-trip — drizzle-team/drizzle-orm#4688). If another
   * run already applied the file (a concurrent-apply race), the guard matches
   * zero rows and this returns `false`; the row is then resolved to `superseded`
   * so it doesn't dangle at `in_progress` (which would read as a stuck migration
   * in `migrate:status`). Without `uniqueFilename` it always applies.
   */
  async markApplied(id: string, input: MarkAppliedInput): Promise<boolean> {
    const set: Record<string, unknown> = {
      status: "applied",
      endedAt: new Date(),
    };
    if (input.statementsExecuted !== undefined) {
      set.statementsExecuted = input.statementsExecuted;
    }
    if (input.renamesApplied !== undefined) {
      set.renamesApplied = input.renamesApplied;
    }
    if (input.durationMs !== undefined) set.durationMs = input.durationMs;

    if (!input.uniqueFilename) {
      await this.db
        .update(this.table)
        .set(set)
        .where(sql`id = ${id}`);
      return true;
    }

    // The NOT EXISTS subquery is wrapped in a derived table so MySQL accepts
    // referencing the target table in an UPDATE (avoids error 1093); SQLite and
    // Postgres accept it too.
    await this.db.update(this.table).set(set)
      .where(sql`id = ${id} AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT 1 FROM nextly_schema_events
           WHERE event_type = 'file_apply'
             AND status = 'applied'
             AND filename = ${input.uniqueFilename}
             AND id <> ${id}
        ) AS _dup
      )`);

    // A zero-row update (guard blocked) leaves the row at in_progress. Drivers
    // don't expose affected-row counts uniformly across the three dialects, so
    // read the resulting status: if it didn't reach applied, another run won the
    // race — resolve this row to superseded so it doesn't dangle, and report it.
    const row = await this.findById(id);
    if (row?.status === "applied") return true;
    await this.db
      .update(this.table)
      .set({
        status: "superseded",
        supersededAt: new Date(),
        endedAt: new Date(),
      })
      .where(sql`id = ${id}`);
    return false;
  }

  /** Transition a row to failed. */
  async markFailed(id: string, input: MarkFailedInput): Promise<void> {
    await this.db
      .update(this.table)
      .set({
        status: "failed",
        endedAt: new Date(),
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        errorJson: input.errorJson ?? null,
      })
      .where(sql`id = ${id}`);
  }

  /**
   * True iff the file's MOST RECENT `file_apply` event is `applied`. Latest
   * wins: a later `rolled_back` (or `failed`) event un-applies the file so the
   * next `migrate` re-runs it. Mirrors the event-sourced model the resolve
   * command uses (see newest-event.ts).
   */
  async isFileApplied(filename: string): Promise<boolean> {
    const rows = await this.findFileApplies(filename);
    return newestEvent(rows)?.status === "applied";
  }

  /** Find a row by id. */
  async findById(id: string): Promise<SchemaEventRow | undefined> {
    const rows = (await this.db
      .select()
      .from(this.table)
      .where(sql`id = ${id}`)) as unknown as SchemaEventRow[];
    return rows[0];
  }

  /**
   * Link consumed rows to the consuming event (spec §4.3.2). Sets the
   * consumer's `superseded_event_ids` and flips each consumed row to
   * `superseded` with back-references.
   */
  async supersede(args: {
    supersededEventIds: string[];
    byEventId: string;
  }): Promise<void> {
    await this.db
      .update(this.table)
      .set({ supersededEventIds: args.supersededEventIds })
      .where(sql`id = ${args.byEventId}`);

    const now = new Date();
    for (const consumedId of args.supersededEventIds) {
      await this.db
        .update(this.table)
        .set({
          status: "superseded",
          supersededAt: now,
          supersededBy: args.byEventId,
        })
        .where(sql`id = ${consumedId}`);
    }
  }

  /**
   * Prune eligible rows (spec §4.3.3) honoring the superseded-row guard
   * (§4.3.2). Returns the ids actually deleted.
   */
  async prune(options: {
    retentionDays: number;
    now: Date;
  }): Promise<string[]> {
    const rows = (await this.db
      .select()
      .from(this.table)) as unknown as SchemaEventRow[];

    const prunable = selectPrunableEventIds(
      rows.map(r => ({
        id: r.id,
        eventType: r.eventType,
        startedAt: r.startedAt,
        supersededEventIds: r.supersededEventIds,
        supersededBy: r.supersededBy,
      })),
      options
    );

    for (const id of prunable) {
      await this.db.delete(this.table).where(sql`id = ${id}`);
    }
    return prunable;
  }

  /** All `file_apply` rows, for `nextly migrate:status` (spec §4.3.1). */
  async listFileApplies(): Promise<SchemaEventRow[]> {
    return (await this.db
      .select()
      .from(this.table)
      .where(sql`event_type = 'file_apply'`)) as unknown as SchemaEventRow[];
  }

  /** All `file_apply` rows for a single filename (applied + failed + rolled_back). */
  async findFileApplies(filename: string): Promise<SchemaEventRow[]> {
    return (await this.db
      .select()
      .from(this.table)
      .where(
        sql`filename = ${filename} AND event_type = 'file_apply'`
      )) as unknown as SchemaEventRow[];
  }

  /** Transition a row to rolled_back (used by migrate:resolve --failed-cleanup). */
  async markRolledBack(
    id: string,
    input: { note?: string | null } = {}
  ): Promise<void> {
    const set: Record<string, unknown> = {
      status: "rolled_back",
      endedAt: new Date(),
    };
    if (input.note !== undefined) set.note = input.note;
    await this.db
      .update(this.table)
      .set(set)
      .where(sql`id = ${id}`);
  }

  /** Every event for a given scope, oldest-first (spec §4.3.1). */
  async listByScope(
    scopeKind: SchemaEventScopeKind,
    scopeSlug: string
  ): Promise<SchemaEventRow[]> {
    return (await this.db
      .select()
      .from(this.table)
      .where(
        sql`scope_kind = ${scopeKind} AND scope_slug = ${scopeSlug}`
      )) as unknown as SchemaEventRow[];
  }

  /**
   * Optional pre-flight check that throws DUPLICATE if a file is already
   * applied. The authoritative "one applied row per file" guard is the
   * conditional `markApplied({ uniqueFilename })` (atomic) plus the migrate
   * lock that serializes runs on PG/MySQL; this is a softer, earlier signal.
   * Only PG keeps a DB-level partial unique index; SQLite/MySQL enforce in code.
   */
  async assertFileNotAlreadyApplied(filename: string): Promise<void> {
    if (await this.isFileApplied(filename)) {
      throw new NextlyError({
        code: "DUPLICATE",
        publicMessage: `Migration file already applied: ${filename}`,
      });
    }
  }
}
