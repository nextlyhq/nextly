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
import { and, eq, sql, type Column, type Table } from "drizzle-orm";

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
   * When the actor's account was deleted and this row's identity erased.
   *
   * NULL for a live actor. Separate from a NULL name because "erased" and
   * "never carried a name" are different facts, and only this one answers when.
   */
  actorDeletedAt: string | null;
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
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
}

/** The two tables an activity write reads and writes. */
interface ActivityWriteTables {
  activityLog: Table & { id: Column };
  users: Table & { id: Column };
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
   * Record an activity log entry.
   *
   * Written first and erased second, rather than checked first and written
   * second. The order is what makes this safe against a deletion running
   * concurrently, on every dialect and with no lock or transaction:
   *
   *   - if the entry commits BEFORE the deletion's own erasure runs, that
   *     erasure covers it;
   *   - if it commits after, this UPDATE erases it — unless the deletion has
   *     not committed yet, in which case the account is still visible here;
   *   - and in exactly that remaining case the entry existed before the
   *     deletion committed, so `deleteUser`'s post-commit sweep reaches it.
   *
   * The three windows cannot all be missed at once: the second requires the
   * entry to predate the commit and the third requires it to postdate the
   * sweep, which runs after the commit. A check-then-insert has no such
   * property — the account can be deleted in the gap between the two
   * statements, which is why the identity is decided by a statement that runs
   * after the row exists rather than before.
   *
   * Errors are caught and logged but never propagated — activity logging must
   * never break a content operation.
   */
  async logActivity(input: LogActivityInput): Promise<void> {
    try {
      const { activityLog, users } = this.tables as ActivityWriteTables;
      const db = this.db as ActivityWriteDb;
      const id = randomUUID();
      const now = new Date();

      await db.insert(activityLog).values({
        id,
        userId: input.userId,
        userName: input.userName,
        userEmail: input.userEmail,
        action: input.action,
        collection: input.collection,
        entryId: input.entryId ?? null,
        entryTitle: input.entryTitle ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: now,
        actorDeletedAt: null,
      });

      // Matches nothing in the ordinary case — the author exists, so the
      // subquery is satisfied and the row is left alone. It costs one primary
      // key lookup and one index probe, on a write that is already off the
      // request path.
      await db
        .update(activityLog)
        .set({ userName: null, userEmail: null, actorDeletedAt: now })
        .where(
          and(
            eq(activityLog.id, id),
            sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${input.userId})`
          )
        );
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
      const conditions: Array<{
        column: string;
        op: "=";
        value: SqlParam;
      }> = [];

      if (options?.collection) {
        conditions.push({
          column: "collection",
          op: "=",
          value: options.collection,
        });
      }
      if (options?.userId) {
        conditions.push({
          column: "user_id",
          op: "=",
          value: options.userId,
        });
      }

      const where = conditions.length > 0 ? { and: conditions } : undefined;

      const rows = await this.adapter.select<Record<string, unknown>>(TABLE, {
        where,
        orderBy: [{ column: "created_at", direction: "desc" }],
        limit: limit + 1,
        offset,
      });

      const hasMore = rows.length > limit;
      const entries = (hasMore ? rows.slice(0, limit) : rows).map(this.mapRow);

      const total = await this.countActivities(where);

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

  /**
   * Delete activity log records older than the specified number of days.
   *
   * @param olderThanDays - Delete records older than this many days (default: 90)
   * @returns Number of deleted records
   */
  async cleanupOldActivities(olderThanDays: number = 90): Promise<number> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      const cutoffStr = this.formatDateForDb(cutoff);

      const deleted = await this.adapter.delete(TABLE, {
        and: [{ column: "created_at", op: "<", value: cutoffStr }],
      });

      if (deleted > 0) {
        this.logger.info(
          `Cleaned up ${deleted} activity log entries older than ${olderThanDays} days`
        );
      }

      return deleted;
    } catch (error) {
      this.logger.error("Failed to cleanup old activities", {
        error: error instanceof Error ? error.message : String(error),
        olderThanDays,
      });
      return 0;
    }
  }

  private async countActivities(where?: {
    and: Array<{ column: string; op: "="; value: SqlParam }>;
  }): Promise<number> {
    try {
      let sql = `SELECT COUNT(*) as count FROM ${TABLE}`;
      const params: SqlParam[] = [];

      if (where && where.and.length > 0) {
        const clauses = where.and.map((c, i) => {
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

    return {
      id: String(row.id),
      userId: String(row.user_id),
      // Through the same narrowing as the other nullable columns: an erased
      // row holds SQL NULL here, and `String(null)` would surface the literal
      // text "null" as the actor's name.
      userName: toNullableString(row.user_name),
      userEmail: toNullableString(row.user_email),
      action: String(row.action) as ActivityLogAction,
      collection: String(row.collection),
      // Type-narrow before stringification so we don't fall through to
      // Object#toString for non-primitive driver values.
      entryId: toNullableString(row.entry_id),
      entryTitle: toNullableString(row.entry_title),
      metadata,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
      actorDeletedAt:
        row.actor_deleted_at instanceof Date
          ? row.actor_deleted_at.toISOString()
          : toNullableString(row.actor_deleted_at),
    };
  };
}
