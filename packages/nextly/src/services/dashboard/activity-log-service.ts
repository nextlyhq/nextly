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
import { sql, type Column, type Table } from "drizzle-orm";

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
}

/** The two tables an activity write reads and writes. */
interface ActivityWriteTables {
  activityLog: Table & { actorDeletedAt: Column };
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
   * Record an activity log entry.
   *
   * ONE statement, which is what makes the identity it stores correct even
   * when the author is being deleted at the same moment. The row and the
   * decision about whose name it may carry are written together, so there is
   * no interval in which a durable row holds an identity that a second
   * statement was still going to remove — a failure or a crash cannot leave
   * that state behind, because the alternative to the whole statement is no
   * row at all.
   *
   * Against a deletion that has not committed yet, the subquery still sees the
   * account and the identity is stored. That entry necessarily predates the
   * commit, which is exactly the case `deleteUser`'s post-commit sweep exists
   * to cover; an entry written after the commit is erased here instead. The
   * two windows are complementary, so neither ordering leaves an identity
   * behind.
   *
   * Errors are caught and logged but never propagated — activity logging must
   * never break a content operation.
   */
  async logActivity(input: LogActivityInput): Promise<void> {
    try {
      const { activityLog, users } = this.tables as ActivityWriteTables;
      const db = this.db as ActivityWriteDb;
      const now = new Date();

      const actorIsGone = sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${input.userId})`;
      // Encoded through the column itself rather than by hand: the stamp is an
      // epoch integer on SQLite and a datetime elsewhere, and an SQL fragment
      // bypasses the mapping Drizzle would otherwise apply to a plain value.
      const erasedAt = activityLog.actorDeletedAt.mapToDriverValue(now);

      await db.insert(activityLog).values({
        id: randomUUID(),
        userId: input.userId,
        userName: sql`CASE WHEN ${actorIsGone} THEN NULL ELSE ${input.userName} END`,
        userEmail: sql`CASE WHEN ${actorIsGone} THEN NULL ELSE ${input.userEmail} END`,
        actorDeletedAt: sql`CASE WHEN ${actorIsGone} THEN ${erasedAt} ELSE NULL END`,
        action: input.action,
        collection: input.collection,
        entryId: input.entryId ?? null,
        entryTitle: input.entryTitle ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: now,
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
    const actorDeletedAt = row.actorDeletedAt;

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
      actorDeletedAt:
        actorDeletedAt instanceof Date
          ? actorDeletedAt.toISOString()
          : toNullableString(actorDeletedAt),
    };
  };
}
