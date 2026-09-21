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

/** The tables this release stops creating. */
export const RETIRED_AUTH_TABLES: readonly string[] = ["accounts", "sessions"];

/** A retired table this database still has, and what it still holds. */
export interface RetiredAuthTable {
  table: string;
  rows: number;
}

export interface FindRetiredAuthTablesDeps {
  tableExists: (table: string) => Promise<boolean>;
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
    "  your decision: `nextly migrate` with NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 drops them, and adding",
    "  NEXTLY_DROP_NONEMPTY_RETIRED=1 is required for one that still holds rows.",
  ].join("\n");
}

/** What `nextly migrate` should do about the retired tables it found. */
export type RetiredAuthTablePlan =
  | { action: "drop"; tables: string[] }
  | { action: "refuse"; nonEmpty: RetiredAuthTable[] }
  | { action: "keep" };

export interface RetiredAuthDropOptions {
  /** NEXTLY_ALLOW_CORE_DESTRUCTIVE=1: the operator accepts destructive core work. */
  allowDestructive: boolean;
  /** NEXTLY_DROP_NONEMPTY_RETIRED=1: and accepts losing the rows in them. */
  allowNonEmpty: boolean;
}

/**
 * Decide what to do with the retired tables a database still has.
 *
 * Two separate permissions, because they are two different losses. Dropping an
 * empty table costs nothing but is still a schema change the operator should
 * have asked for. Dropping one with rows destroys data that nothing can
 * recreate, so saying "yes to destructive changes" is not enough on its own —
 * an operator who has not looked at what is in there has not decided anything.
 *
 * Kept as a pure decision so the policy can be tested without a database, and
 * so the caller is the only thing that touches one.
 */
export function planRetiredAuthTableDrop(
  found: readonly RetiredAuthTable[],
  opts: RetiredAuthDropOptions
): RetiredAuthTablePlan {
  if (found.length === 0 || !opts.allowDestructive) return { action: "keep" };

  const nonEmpty = found.filter(entry => entry.rows > 0);
  if (nonEmpty.length > 0 && !opts.allowNonEmpty) {
    return { action: "refuse", nonEmpty };
  }
  return { action: "drop", tables: found.map(entry => entry.table) };
}

/** Why a drop was refused, naming each table and what it would have cost. */
export function formatRetiredAuthDropRefusal(
  nonEmpty: readonly RetiredAuthTable[]
): string {
  return [
    "Refusing to drop retired auth tables that still hold rows:",
    ...nonEmpty.map(entry => `  ${entry.table}: ${entry.rows} rows`),
    "Set NEXTLY_DROP_NONEMPTY_RETIRED=1 to drop them and lose those rows.",
  ].join("\n");
}
