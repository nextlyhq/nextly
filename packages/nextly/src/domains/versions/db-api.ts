/**
 * The narrow database surface the versions domain needs. Both the adapter
 * (non-transactional) and the transaction context passed to
 * `adapter.transaction(cb)` structurally satisfy it, so a repository built on
 * `VersionsDbApi` works for both reads (via the adapter) and in-transaction
 * capture (via the tx context) without depending on Drizzle internals.
 *
 * @module domains/versions/db-api
 */

/** A single AND-ed filter condition (subset of the adapter WhereClause). */
export interface VersionsWhereCondition {
  column: string;
  op: "=" | "!=";
  value?: unknown;
}

/** Conjunction-only where (all versions queries are simple AND filters). */
export interface VersionsWhere {
  and?: VersionsWhereCondition[];
}

/** Select options subset the versions repository uses. */
export interface VersionsSelectOptions {
  columns?: string[];
  where?: VersionsWhere;
  orderBy?: { column: string; direction?: "asc" | "desc" }[];
  limit?: number;
}

/** The database methods the versions repository depends on. */
export interface VersionsDbApi {
  insert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options?: { returning?: string[] | "*" }
  ): Promise<T>;
  select<T = unknown>(
    table: string,
    options?: VersionsSelectOptions
  ): Promise<T[]>;
}
