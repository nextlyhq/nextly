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

import type { SupportedDialect } from "../../types/database";

/** A single filter condition (subset of the adapter WhereClause). */
export interface VersionsWhereCondition {
  column: string;
  // `<` powers keyset pagination (versionNo < cursor); `IN` powers the
  // retention delete, which removes several rows in one statement; `IS NULL`
  // powers the locale filter, which must also match shared (null-locale)
  // snapshots; `IS NOT NULL` powers the durable-version filter, which excludes
  // the working draft (a non-autosave row with no version number) from reads
  // that assume a non-autosave row carries a sequence number. The adapter's
  // WhereOperator spells the set operator uppercase.
  // `>=` and `<=` power the releases window query — "scheduled between these
  // two instants" — which a dashboard widget and a release index both ask with
  // different bounds. Added rather than filtered in memory: the alternative is
  // selecting every release and discarding most of it in JS, which is what
  // `findDueReleases` does and is only tolerable there because it is already
  // narrowed to `state = "scheduled"`. The adapter has supported both since
  // `WHERE_OPERATORS` was written; this union was simply narrower than what it
  // fronts, and widening a subset keeps the adapter assignable to this port.
  op: "=" | "!=" | "<" | ">=" | "<=" | "IN" | "IS NULL" | "IS NOT NULL";
  // Matches the adapter's WhereCondition.value so the adapter and the
  // transaction context both structurally satisfy VersionsDbApi (a looser
  // `unknown` here breaks that assignability under method-parameter variance).
  value?: SqlParam | SqlParam[];
}

/**
 * A where clause: a conjunction (`and`) of conditions or nested clauses, with an
 * optional disjunction (`or`) group. Still a strict subset of the adapter's
 * WhereClause, so both the adapter and the transaction context satisfy the port.
 * The `or` group exists for the locale filter alone (locale X OR shared/null).
 */
export interface VersionsWhere {
  and?: (VersionsWhereCondition | VersionsWhere)[];
  or?: (VersionsWhereCondition | VersionsWhere)[];
}

/** Select options subset the versions repository uses. */
export interface VersionsSelectOptions {
  columns?: string[];
  where?: VersionsWhere;
  /**
   * `nulls` is exposed because DEFAULT null ordering is dialect-dependent:
   * PostgreSQL sorts nulls FIRST on a descending order while MySQL and SQLite
   * sort them last. A "newest scheduled first" list containing unscheduled
   * drafts therefore returns different rows per engine, and under a limit it can
   * return only drafts and omit every scheduled release. The adapter has
   * supported the control since it was written.
   */
  orderBy?: {
    column: string;
    direction?: "asc" | "desc";
    nulls?: "first" | "last";
  }[];
  limit?: number;
}

/** The database methods the versions repository depends on. */
export interface VersionsDbApi {
  /**
   * Which engine this handle talks to, where the handle knows.
   *
   * Optional so the transaction context, which does not carry it, still
   * satisfies this port. Only the autosave upsert reads it, and only to
   * classify a driver error: a constraint code means different things per
   * engine, so a handle that cannot say which engine it is must not have its
   * errors guessed at.
   */
  readonly dialect?: SupportedDialect;
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
