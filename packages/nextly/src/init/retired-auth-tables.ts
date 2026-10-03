/**
 * Telling an operator that two auth tables still in their database no longer
 * do anything.
 *
 * `accounts` and `sessions` came from an authentication model Nextly no longer
 * uses: sessions are stateless JWTs with an opaque refresh token of their own,
 * and an external identity belongs to the plugin that authenticated it rather
 * than to a core table nothing writes. Nothing has written either table since
 * that change, and nothing reads them now.
 *
 * A fresh install no longer creates them. An existing database keeps them,
 * because dropping a table that may still hold rows is the operator's decision
 * rather than an upgrade's — and between the upgrade and that decision the
 * tables sit there looking exactly as they did when they were live. No query
 * fails and no feature errors; they simply never change again.
 *
 * So the operator is told at startup, once, which of the two are still present
 * and how many rows each holds. Reporting only: nothing here changes the
 * database. `nextly migrate` drops them when the operator asks it to.
 *
 * @module init/retired-auth-tables
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { introspectLiveSnapshot } from "../domains/schema/pipeline/diff/introspect-live";

/** The tables this release stops creating. */
export const RETIRED_AUTH_TABLES: readonly string[] = ["accounts", "sessions"];

/**
 * The columns that make a table one of OURS rather than a table that merely
 * has the name.
 *
 * A fresh install no longer creates either table, so from this release the
 * names can belong to someone else: a host app sharing the database, or a
 * session store whose default table is `sessions`. Every column listed here
 * was in every dialect's definition of the retired table, and together they
 * are specific enough that an unrelated table does not carry all of them.
 */
const RETIRED_AUTH_TABLE_SHAPES: Readonly<Record<string, readonly string[]>> = {
  accounts: ["user_id", "provider", "provider_account_id"],
  sessions: ["session_token", "user_id", "expires"],
};

/**
 * Whether a table with a retired name is the table Nextly created.
 *
 * The one predicate the startup warning, the drop and the erasure all use, so
 * none of them acts on a table another application owns: a host table named
 * `accounts` was reported as Nextly's, dropped by `nextly migrate`, and had
 * `DELETE ... WHERE user_id = ?` run against it on every user deletion — which
 * failed, and took the deletion with it.
 */
export function hasRetiredShape(
  table: string,
  columns: readonly string[]
): boolean {
  const required = RETIRED_AUTH_TABLE_SHAPES[table];
  if (!required) return false;
  const present = new Set(columns);
  return required.every(column => present.has(column));
}

/**
 * The live column names of a table, read from the database catalogue.
 *
 * Introspection rather than a probe query, because a failed SELECT cannot say
 * whether the column is missing or the connection blinked. Anything that goes
 * wrong propagates, so an unanswerable question is not read as an answer.
 */
export function liveColumnsOf(
  db: unknown,
  dialect: SupportedDialect
): (table: string) => Promise<string[]> {
  return async table => {
    const snapshot = await introspectLiveSnapshot(db, dialect, [table]);
    return (
      snapshot.tables
        .find(entry => entry.name === table)
        ?.columns.map(column => column.name) ?? []
    );
  };
}

/** A retired table this database still has, and what it still holds. */
export interface RetiredAuthTable {
  table: string;
  rows: number;
}

export interface FindRetiredAuthTablesDeps {
  tableExists: (table: string) => Promise<boolean>;
  /** A table's live column names, for telling ours from a namesake. */
  columnsOf: (table: string) => Promise<string[]>;
  countRows: (
    db: unknown,
    dialect: SupportedDialect,
    table: string
  ) => Promise<number>;
}

/**
 * Which retired tables are present, and how many rows each holds.
 *
 * Presence is asked of the database rather than assumed from the version: a
 * fresh install never had them, an operator may already have dropped them, and
 * counting rows in a table that is not there is the error this check exists to
 * avoid causing.
 *
 * A table with no rows is still REPORTED, unlike the retired access-rules
 * column, which only matters when it carries values. Here the table itself is
 * the thing to remove, and an empty one is the easy case to act on — saying
 * nothing about it would leave the operator to discover it later.
 */
export async function findRetiredAuthTables(
  db: unknown,
  dialect: SupportedDialect,
  deps: FindRetiredAuthTablesDeps
): Promise<RetiredAuthTable[]> {
  const found: RetiredAuthTable[] = [];
  for (const table of RETIRED_AUTH_TABLES) {
    if (!(await deps.tableExists(table))) continue;
    // A table with the name and another shape is not ours: it is neither
    // reported, nor dropped, nor erased from.
    if (!hasRetiredShape(table, await deps.columnsOf(table))) continue;
    found.push({ table, rows: await deps.countRows(db, dialect, table) });
  }
  return found;
}

/** The startup warning, naming each table and its row count. */
export function formatRetiredAuthTablesWarning(
  found: readonly RetiredAuthTable[]
): string {
  return [
    "[nextly] Your database still has auth tables this version of Nextly no longer uses.",
    "",
    ...found.map(
      entry =>
        `  ${entry.table}: ${entry.rows} ${entry.rows === 1 ? "row" : "rows"}`
    ),
    "",
    "  Sessions are stateless JWTs with their own refresh-token table, and an external identity",
    "  belongs to the plugin that authenticated it. Nothing writes or reads these two tables, and",
    "  a new install no longer creates them. They are left in place because dropping a table is",
    "  your decision: `nextly migrate` with NEXTLY_DROP_RETIRED_AUTH_TABLES=1 drops them, and adding",
    "  NEXTLY_DROP_NONEMPTY_RETIRED=1 is required for one that still holds rows.",
  ].join("\n");
}

/** What `nextly migrate` does with the retired tables it found. */
export interface RetiredAuthTablePlan {
  /** The tables to drop. */
  drop: string[];
  /** Tables that hold rows the operator has not agreed to lose. */
  kept: RetiredAuthTable[];
}

export interface RetiredAuthDropOptions {
  /** NEXTLY_DROP_RETIRED_AUTH_TABLES=1: the operator asked for the drop. */
  dropRequested: boolean;
  /** NEXTLY_DROP_NONEMPTY_RETIRED=1: and accepts losing the rows in them. */
  allowNonEmpty: boolean;
}

/**
 * Decide, table by table, what to do with the retired tables a database still
 * has.
 *
 * Two separate permissions, because they are two different losses. Dropping an
 * empty table costs nothing but is still a schema change the operator should
 * have asked for. Dropping one with rows destroys data that nothing can
 * recreate, so asking for the drop is not enough on its own — an operator who
 * has not looked at what is in there has not decided anything. A table with
 * rows does not hold back an empty one: each is decided on what it holds.
 *
 * Kept as a pure decision so the policy can be tested without a database, and
 * so the caller is the only thing that touches one.
 */
export function planRetiredAuthTableDrop(
  found: readonly RetiredAuthTable[],
  opts: RetiredAuthDropOptions
): RetiredAuthTablePlan {
  if (!opts.dropRequested) return { drop: [], kept: [] };
  const kept = opts.allowNonEmpty ? [] : found.filter(entry => entry.rows > 0);
  return {
    drop: found
      .filter(entry => !kept.includes(entry))
      .map(entry => entry.table),
    kept,
  };
}

/** The tables a drop kept, naming each and what dropping it would cost. */
export function formatRetiredAuthTablesKept(
  kept: readonly RetiredAuthTable[]
): string {
  return [
    "Kept retired auth tables that still hold rows:",
    ...kept.map(entry => `  ${entry.table}: ${entry.rows} rows`),
    "Set NEXTLY_DROP_NONEMPTY_RETIRED=1 as well to drop them and lose those rows.",
  ].join("\n");
}
