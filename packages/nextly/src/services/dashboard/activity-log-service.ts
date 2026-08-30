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
import { type Column, type Table } from "drizzle-orm";

import { toDbError } from "../../database/errors";
// PR 4 migration: switched from ServiceError.fromDatabaseError to
// NextlyError.fromDatabaseError. Public message stays generic per §13.8;
// the underlying DbError is preserved as `cause` and rich DB context
// (kind, dialect, code) flows into logContext automatically.
import { insertErasureAware } from "../../domains/audit/erasure-aware-insert";
import { NextlyError } from "../../errors";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

import { someResources, type ReadableResources } from "./readable-resources";

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
  /**
   * Display name to denormalize onto the row. Omit to take it from the account
   * itself, which is what a caller that holds only an actor id does — the write
   * already reads that row to decide whether the account still exists, so the
   * name comes from the same look, under the same lock, as that decision.
   */
  userName?: string;
  /** Email to denormalize onto the row; omit to take it from the account. */
  userEmail?: string;
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
  /**
   * Which resources the caller may read. An omitted scope denies: this feed
   * exposes entry titles across every collection, so a caller that forgets to
   * scope it must get nothing rather than everything.
   */
  scope?: ReadableResources;
}

const TABLE = "activity_log";

/**
 * The Drizzle surface an activity write needs.
 *
 * Structural rather than the concrete types because the real ones are
 * dialect-specific (NodePgDatabase / MySql2Database / BetterSQLite3Database),
 * while the fluent API is identical.
 */
export interface ActivityWriteDb {
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
  users: Table & { id: Column; name: Column; email: Column };
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
  /** `=` for a single value, `IN` for a set. */
  op: "=" | "IN";
  value: SqlParam | SqlParam[];
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
   * The columns of one entry that erasure never touches.
   *
   * The identity columns are decided by the write itself, against an account
   * that may be being deleted at that moment, so they are supplied separately.
   */
  private entryValues(
    input: LogActivityInput,
    createdAt: Date
  ): Record<string, unknown> {
    return {
      id: randomUUID(),
      userId: input.userId,
      action: input.action,
      collection: input.collection,
      entryId: input.entryId ?? null,
      entryTitle: input.entryTitle ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt,
    };
  }

  /**
   * Record an activity log entry as a self-contained write.
   *
   * For callers that own no transaction of their own — the auth and account
   * seams. Supplies the transaction the identity decision needs (see
   * {@link logActivityInTx}) and swallows failures: these callers have already
   * committed by the time they log, so a throw here could only turn a recorded
   * action into a failed one. A mutation recording inside its own write
   * transaction wants the opposite and calls {@link logActivityInTx} directly.
   */
  async logActivity(input: LogActivityInput): Promise<void> {
    try {
      if (this.dialect === "sqlite") {
        await this.logActivityInTx(this.db as ActivityWriteDb, input);
        return;
      }

      await (this.db as TransactionalActivityDb).transaction(tx =>
        this.logActivityInTx(tx, input)
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
   * Write one activity entry through an executor the CALLER owns.
   *
   * Holds the whole erasure-aware identity decision, so the two writers — the
   * standalone {@link logActivity} above and the mutation seam that records
   * inside a content transaction — cannot come to disagree about what a row may
   * carry. Both dialect mechanisms live here; only the transaction the
   * statements run in differs between callers.
   *
   * Failures PROPAGATE, deliberately. A caller recording inside a content
   * transaction needs the write to fail with it — an entry that cannot be
   * written must take the change it describes down with it, rather than leaving
   * a committed mutation nothing recorded. Swallowing is the standalone
   * caller's decision to make, and it makes it above.
   *
   * The identity a row may carry has to be decided against an account that may
   * be deleted at this very moment, and the two dialect families need
   * different mechanisms for it.
   *
   * **Postgres and MySQL** first take a SHARED lock on the account row.
   * `deleteUser` takes an EXCLUSIVE lock on that row before it erases anything,
   * so the two cannot be in flight at once: either this lock is taken first and
   * the deletion waits, so its erasure covers a row that already exists, or the
   * deletion holds the row and this waits for its commit and then correctly
   * finds the account gone. The lock is what closes the gap a single statement
   * cannot — its subquery is answered when it STARTS while its row becomes
   * visible when it COMMITS, and an insert spanning the deletion's commit
   * satisfies neither the deletion's own erasure nor its post-commit sweep.
   * Shared rather than exclusive so concurrent writes by the same author do not
   * serialise against each other; only the deletion has to exclude them, for
   * the length of one insert.
   *
   * **SQLite** has one writer, so its insert cannot interleave with the
   * deletion's transaction at all and needs no lock. It decides the identity
   * inside the statement instead, because a check followed by a separate
   * insert would leave a durable row that a second statement was still going
   * to correct.
   */
  async logActivityInTx(
    db: ActivityWriteDb,
    input: LogActivityInput
  ): Promise<void> {
    const { activityLog, users } = this.tables as ActivityWriteTables;
    // The caller's identity when it supplied one, otherwise the account's own.
    // Taking it from the account is what a caller holding only an actor id
    // does: the write already looks at that row to decide whether the account
    // exists, so the name comes from the same look as that decision.
    const supplied: Record<string, unknown> = {};
    const fromAccount: Record<string, Column> = {};
    if (input.userName !== undefined) supplied.userName = input.userName;
    else fromAccount.userName = users.name;
    if (input.userEmail !== undefined) supplied.userEmail = input.userEmail;
    else fromAccount.userEmail = users.email;

    await insertErasureAware(db, this.dialect, {
      table: activityLog,
      users,
      row: this.entryValues(input, new Date()),
      identity: supplied,
      identityFromAccount: fromAccount,
      actorUserId: input.userId,
    });
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

    // Fail-closed default: an omitted scope must deny, not grant. This feed
    // exposes entry titles across every collection, so a caller that forgets
    // to pass one gets nothing rather than everything.
    const scope = options?.scope ?? someResources([]);

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
          op: "=",
          value: options.collection,
        });
      }
      if (options?.userId) {
        filters.push({
          property: "userId",
          column: "user_id",
          op: "=",
          value: options.userId,
        });
      }
      if (scope.kind === "some") {
        // An empty scope yields an `IN ()`, which matches nothing -- the
        // intended answer for a caller who may read nothing. Short-circuit
        // instead, because an empty IN list is a syntax error on some
        // dialects, and the short-circuit must happen BEFORE the query is
        // built rather than let the driver reject it.
        if (scope.resources.size === 0) {
          return { activities: [], total: 0, hasMore: false };
        }
        filters.push({
          property: "collection",
          column: "collection",
          op: "IN",
          value: [...scope.resources],
        });
      }

      const where =
        filters.length > 0
          ? {
              and: filters.map(f => ({
                column: f.property,
                op: f.op,
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
        // Placeholder numbering derives from `params.length` as each value is
        // pushed, not from the filter's own index: an `IN` filter contributes
        // several parameters, so `$${i + 1}` -- correct only while every
        // filter carried exactly one value -- would bind the wrong values
        // for every filter after the first `IN`.
        const clauses = filters.map(f => this.filterClause(f, params));
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

  /**
   * Render one filter as a parameterised SQL clause, pushing its value(s)
   * onto `params` as it goes.
   *
   * Placeholder numbering derives from `params.length` at the moment each
   * value is pushed, never from the filter's position in the array: an `IN`
   * filter contributes several parameters, so a caller numbering from the
   * filter index (`$${i + 1}`) -- correct only while every filter carried
   * exactly one value -- would bind the wrong values for every filter that
   * follows the first `IN`.
   */
  private filterClause(filter: ActivityFilter, params: SqlParam[]): string {
    const quoted =
      this.dialect === "postgresql"
        ? `"${filter.column}"`
        : `\`${filter.column}\``;

    if (filter.op === "IN") {
      const placeholders = (filter.value as SqlParam[])
        .map(v => {
          params.push(v);
          return this.dialect === "postgresql" ? `$${params.length}` : "?";
        })
        .join(", ");
      return `${quoted} IN (${placeholders})`;
    }

    params.push(filter.value as SqlParam);
    return this.dialect === "postgresql"
      ? `${quoted} = $${params.length}`
      : `${quoted} = ?`;
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
