/**
 * Activity Log Service
 *
 * Records and queries user activity (create/update/delete) across all
 * collections. Designed for the dashboard activity feed — not a full
 * audit log. Writes are fire-and-forget; failures never propagate to
 * the caller.
 *
 * @module services/dashboard/activity-log-service
 * @since 1.0.0
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SqlParam } from "@nextlyhq/adapter-drizzle/types";
import { eq, sql, type Column, type Table } from "drizzle-orm";

import { toDbError } from "../../database/errors";
// PR 4 migration: switched from ServiceError.fromDatabaseError to
// NextlyError.fromDatabaseError. Public message stays generic per §13.8;
// the underlying DbError is preserved as `cause` and rich DB context
// (kind, dialect, code) flows into logContext automatically.
import { NextlyError } from "../../errors";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

/** The three mutation actions tracked in the activity log. */
export type ActivityLogAction = "create" | "update" | "delete";

/** A single activity log record as returned by queries. */
export interface ActivityLogEntry {
  id: string;
  /**
   * The actor, as an opaque reference that outlives their account.
   *
   * Still set after the account is deleted — that is what keeps one deleted
   * actor's entries distinguishable from another's.
   */
  userId: string;
  /** NULL once the actor's account was deleted and their identity erased. */
  userName: string | null;
  /** NULL once the actor's account was deleted and their identity erased. */
  userEmail: string | null;
  action: ActivityLogAction;
  collection: string;
  entryId: string | null;
  entryTitle: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  /**
   * When THIS ROW's identity was erased. NULL while the actor still exists.
   *
   * The row's own erasure, deliberately, not the account's deletion. For an
   * entry erased by a deletion the two coincide, because the erasure runs
   * inside that transaction. For one written after the account was already
   * gone they do not: nothing retains when that deletion happened, and
   * claiming otherwise would put a number in an audit field that no record
   * supports. Separate from a NULL name because "erased" and "never carried a
   * name" are different facts, and only this one answers when.
   */
  identityErasedAt: string | null;
}

/** Input for recording a new activity. */
export interface LogActivityInput {
  userId: string;
  userName: string;
  userEmail: string;
  action: ActivityLogAction;
  collection: string;
  entryId?: string;
  entryTitle?: string;
  metadata?: Record<string, unknown>;
}

/** Paginated activity log response. */
export interface ActivityLogResult {
  activities: ActivityLogEntry[];
  total: number;
  hasMore: boolean;
}

/** Options for querying the activity log. */
export interface ActivityLogQueryOptions {
  limit?: number;
  offset?: number;
  collection?: string;
  userId?: string;
}

const TABLE = "activity_log";

/**
 * The Drizzle surface an activity write needs.
 *
 * Structural rather than the concrete types because the real ones are
 * dialect-specific (NodePgDatabase / MySql2Database / BetterSQLite3Database),
 * while the fluent API is identical.
 */
interface ActivityWriteDb {
  insert(table: unknown): { values(data: unknown): Promise<unknown> };
  select(fields: unknown): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): Promise<Record<string, unknown>[]> & {
          // `.for("share")` exists on the Postgres and MySQL builders. SQLite
          // has no row lock and never reaches the call.
          for(strength: "share"): Promise<Record<string, unknown>[]>;
        };
      };
    };
  };
}

/** The same surface plus the transaction a lock has to be held inside. */
interface TransactionalActivityDb extends ActivityWriteDb {
  transaction<T>(work: (tx: ActivityWriteDb) => Promise<T>): Promise<T>;
}

/** The two tables an activity write reads and writes. */
interface ActivityWriteTables {
  activityLog: Table & { identityErasedAt: Column };
  users: Table & { id: Column };
}

/**
 * One query filter, in both the spellings its two consumers need.
 *
 * `adapter.select` resolves a name against the Drizzle table and therefore
 * wants the schema property; the count query writes SQL and wants the physical
 * column. They are carried together so a filter cannot be added in one
 * spelling and used in the other.
 */
interface ActivityFilter {
  /** The Drizzle schema property, for `adapter.select`. */
  property: string;
  /** The physical column, for the count query's SQL. */
  column: string;
  value: SqlParam;
}

/**
 * Safely convert an unknown driver-returned value to a nullable string.
 * Avoids `Object.toString()` fallthrough that triggers no-base-to-string.
 */
function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

export class ActivityLogService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * The column values for one entry, given whatever decides its identity.
   *
   * One source for the column list, so the two write paths below cannot come
   * to disagree about the shape of a row.
   */
  private entryValues(
    input: LogActivityInput,
    createdAt: Date,
    identity: {
      userName: unknown;
      userEmail: unknown;
      identityErasedAt: unknown;
    }
  ): Record<string, unknown> {
    return {
      id: randomUUID(),
      userId: input.userId,
      ...identity,
      action: input.action,
      collection: input.collection,
      entryId: input.entryId ?? null,
      entryTitle: input.entryTitle ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt,
    };
  }

  /**
   * Record an activity log entry.
   *
   * The identity a row may carry has to be decided against an account that may
   * be deleted at this very moment, and the two dialect families need
   * different mechanisms for it.
   *
   * **Postgres and MySQL** run the write inside a transaction that first takes
   * a SHARED lock on the account row. `deleteUser` takes an EXCLUSIVE lock on
   * that row before it erases anything, so the two cannot be in flight at
   * once: either this lock is taken first and the deletion waits, so its
   * erasure covers a row that already exists, or the deletion holds the row and
   * this waits for its commit and then correctly finds the account gone. The
   * lock is what closes the gap a single statement cannot — its subquery is
   * answered when it STARTS while its row becomes visible when it COMMITS, and
   * an insert spanning the deletion's commit satisfies neither the deletion's
   * own erasure nor its post-commit sweep. Shared rather than exclusive so
   * concurrent writes by the same author do not serialise against each other;
   * only the deletion has to exclude them, for the length of one insert.
   *
   * **SQLite** has one writer, so its insert cannot interleave with the
   * deletion's transaction at all and needs no lock. It decides the identity
   * inside the statement instead, because a check followed by a separate
   * insert would leave a durable row that a second statement was still going
   * to correct — and `BaseService`'s SQLite transaction cannot be used to hold
   * the two together: it issues `BEGIN IMMEDIATE` on the shared synchronous
   * connection, which throws whenever another transaction is open and would
   * become a silently missing audit entry here.
   *
   * Errors are caught and logged but never propagated — activity logging must
   * never break a content operation.
   */
  async logActivity(input: LogActivityInput): Promise<void> {
    try {
      const tables = this.tables as ActivityWriteTables;
      const { activityLog, users } = tables;

      if (this.dialect === "sqlite") {
        // Nothing to wait for here: SQLite takes no lock, so the statement
        // runs at the moment this is read.
        const now = new Date();
        const actorIsGone = sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${input.userId})`;
        // Encoded through the column itself: the stamp is an epoch integer
        // here, and an SQL fragment bypasses the mapping Drizzle would
        // otherwise apply to a plain value.
        const erasedAt = activityLog.identityErasedAt.mapToDriverValue(now);
        await (this.db as ActivityWriteDb).insert(activityLog).values(
          this.entryValues(input, now, {
            userName: sql`CASE WHEN ${actorIsGone} THEN NULL ELSE ${input.userName} END`,
            userEmail: sql`CASE WHEN ${actorIsGone} THEN NULL ELSE ${input.userEmail} END`,
            identityErasedAt: sql`CASE WHEN ${actorIsGone} THEN ${erasedAt} ELSE NULL END`,
          })
        );
        return;
      }

      await (this.db as TransactionalActivityDb).transaction(async tx => {
        const actor = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1)
          .for("share");
        // Read AFTER the lock is granted. Acquiring it can wait out a whole
        // deletion, and a stamp taken before the wait would claim the identity
        // was erased at a moment that precedes the deletion it records.
        const settled = new Date();
        // Plain values, decided in JS: the lock makes the answer stable for the
        // rest of this transaction, and the transaction makes the read and the
        // write land together. Deciding it in SQL instead would need the same
        // CASE the SQLite path uses, whose untyped branches Postgres cannot
        // infer a parameter type for.
        const actorStillExists = actor.length > 0;
        await tx.insert(activityLog).values(
          this.entryValues(input, settled, {
            userName: actorStillExists ? input.userName : null,
            userEmail: actorStillExists ? input.userEmail : null,
            identityErasedAt: actorStillExists ? null : settled,
          })
        );
      });
    } catch (error) {
      this.logger.error("Failed to log activity", {
        error: error instanceof Error ? error.message : String(error),
        input: {
          action: input.action,
          collection: input.collection,
          entryId: input.entryId,
        },
      });
    }
  }

  /**
   * Query recent activity log entries with optional filters.
   *
   * Uses the `limit + 1` pattern to determine `hasMore` without a
   * separate COUNT query. The `total` field uses a separate count query
   * only when needed.
   */
  async getRecentActivity(
    options?: ActivityLogQueryOptions
  ): Promise<ActivityLogResult> {
    const limit = Math.min(options?.limit ?? 10, 50);
    const offset = options?.offset ?? 0;

    try {
      // Each filter carries BOTH spellings because its two consumers disagree
      // by nature: `adapter.select` resolves names against the Drizzle table,
      // so it needs the schema property, while the count below writes SQL and
      // needs the physical column. Deriving both from one entry is what stops
      // them drifting apart — naming the column for the select silently
      // dropped the ordering and made a filtered query fail outright.
      const filters: ActivityFilter[] = [];

      if (options?.collection) {
        filters.push({
          property: "collection",
          column: "collection",
          value: options.collection,
        });
      }
      if (options?.userId) {
        filters.push({
          property: "userId",
          column: "user_id",
          value: options.userId,
        });
      }

      const where =
        filters.length > 0
          ? {
              and: filters.map(f => ({
                column: f.property,
                op: "=" as const,
                value: f.value,
              })),
            }
          : undefined;

      const rows = await this.adapter.select<Record<string, unknown>>(TABLE, {
        where,
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: limit + 1,
        offset,
      });

      const hasMore = rows.length > limit;
      const entries = (hasMore ? rows.slice(0, limit) : rows).map(this.mapRow);

      const total = await this.countActivities(filters);

      return { activities: entries, total, hasMore };
    } catch (error) {
      this.logger.error("Failed to query activity log", {
        error: error instanceof Error ? error.message : String(error),
      });
      // PR 4 migration: NextlyError.fromDatabaseError yields a generic
      // public message ("An unexpected error occurred." for non-DbError,
      // or the §13.8 mapping for DbError) and preserves the original
      // error as `cause` for operator logs. Normalise raw driver errors
      // via toDbError(dialect) so the right kind is mapped instead of
      // collapsing to INTERNAL_ERROR / 500.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  private async countActivities(filters: ActivityFilter[]): Promise<number> {
    try {
      let sql = `SELECT COUNT(*) as count FROM ${TABLE}`;
      const params: SqlParam[] = [];

      if (filters.length > 0) {
        const clauses = filters.map((c, i) => {
          params.push(c.value);
          // Use positional placeholders for PG ($1, $2) and ? for MySQL/SQLite
          return this.dialect === "postgresql"
            ? `"${c.column}" = $${i + 1}`
            : `\`${c.column}\` = ?`;
        });
        sql += ` WHERE ${clauses.join(" AND ")}`;
      }

      const result = await this.adapter.executeQuery<{
        count: number | string;
      }>(sql, params);

      return Number(result[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  private mapRow = (row: Record<string, unknown>): ActivityLogEntry => {
    let metadata: Record<string, unknown> | null = null;
    if (row.metadata) {
      try {
        metadata =
          typeof row.metadata === "string"
            ? JSON.parse(row.metadata)
            : (row.metadata as Record<string, unknown>);
      } catch {
        metadata = null;
      }
    }

    // Keyed by the Drizzle SCHEMA PROPERTY, not the column: `adapter.select`
    // runs `db.select().from(table)` and throws outright when the table is not
    // in the registry, so there is no raw-SQL path that would return
    // `user_name`. Reading the column spelling yielded undefined for every
    // field and surfaced as the string "undefined" in the feed.
    const createdAt = row.createdAt;
    const identityErasedAt = row.identityErasedAt;

    return {
      id: String(row.id),
      userId: String(row.userId),
      // Through the same narrowing as the other nullable columns: an erased
      // row holds SQL NULL here, and `String(null)` would surface the literal
      // text "null" as the actor's name.
      userName: toNullableString(row.userName),
      userEmail: toNullableString(row.userEmail),
      action: String(row.action) as ActivityLogAction,
      collection: String(row.collection),
      // Type-narrow before stringification so we don't fall through to
      // Object#toString for non-primitive driver values.
      entryId: toNullableString(row.entryId),
      entryTitle: toNullableString(row.entryTitle),
      metadata,
      createdAt:
        createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
      identityErasedAt:
        identityErasedAt instanceof Date
          ? identityErasedAt.toISOString()
          : toNullableString(identityErasedAt),
    };
  };
}
