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
}

export interface MarkFailedInput {
  errorCode?: string | null;
  errorMessage?: string | null;
  errorJson?: unknown;
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

  /** Transition a row to applied. */
  async markApplied(id: string, input: MarkAppliedInput): Promise<void> {
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
    await this.db
      .update(this.table)
      .set(set)
      .where(sql`id = ${id}`);
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
   * MySQL has no partial unique index, so callers that mark a `file_apply`
   * row applied must first check no other applied row exists for the same
   * filename. Throws DUPLICATE on conflict. (PG/SQLite rely on the index.)
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
