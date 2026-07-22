/**
 * The narrow database surface the versions domain needs. Both the adapter
 * (non-transactional) and the transaction context passed to
 * `adapter.transaction(cb)` structurally satisfy it, so a repository built on
 * `VersionsDbApi` works for both reads (via the adapter) and in-transaction
 * capture (via the tx context) without depending on Drizzle internals.
 *
 * @module domains/versions/db-api
 */

import type { SqlParam } from "@nextlyhq/adapter-drizzle/types";

/** A single AND-ed filter condition (subset of the adapter WhereClause). */
export interface VersionsWhereCondition {
  column: string;
  // `<` powers keyset pagination (versionNo < cursor); `IN` powers the
  // retention delete, which removes several rows in one statement. The
  // adapter's WhereOperator spells the set operator uppercase.
  op: "=" | "!=" | "<" | "IN";
  // Matches the adapter's WhereCondition.value so the adapter and the
  // transaction context both structurally satisfy VersionsDbApi (a looser
  // `unknown` here breaks that assignability under method-parameter variance).
  value?: SqlParam | SqlParam[];
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
  /**
   * Delete rows matching `where`, returning the number removed. No options
   * parameter: retention needs none, and omitting it keeps the port satisfied
   * by both the adapter and the transaction context, whose wider `where` and
   * extra optional arguments remain assignable to this narrower shape.
   */
  delete(table: string, where: VersionsWhere): Promise<number>;
  /**
   * Update rows matching `where`.
   *
   * Narrow for the same reason as `delete`: the only thing that edits a stored
   * version is its label, and a snapshot is never rewritten. Keeping the port
   * to what is actually used means both the adapter and the transaction
   * context satisfy it without adapting, and makes any future widening a
   * deliberate act rather than an inherited capability.
   */
  update(
    table: string,
    data: Record<string, unknown>,
    where: VersionsWhere
  ): Promise<unknown>;
}
