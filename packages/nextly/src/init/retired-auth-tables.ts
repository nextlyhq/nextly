/**
 * Telling an operator that auth tables still in their database no longer do
 * anything.
 *
 * `accounts` and `sessions` came from an authentication model Nextly no longer
 * uses: sessions are stateless JWTs with an opaque refresh token of their own.
 * Nothing has written either table since that change, and nothing reads them
 * now. `user_permission_cache` held permission answers between requests; a
 * user's access is now kept in memory, and nothing reads or writes it either.
 *
 * A fresh install no longer creates them. An existing database keeps them,
 * because dropping a table that may still hold rows is the operator's decision
 * rather than an upgrade's — and between the upgrade and that decision the
 * tables sit there looking exactly as they did when they were live. No query
 * fails and no feature errors; they simply never change again.
 *
 * So the operator is told at startup, once, which of them are still present
 * and how many rows each holds. Reporting only: nothing here changes the
 * database. `nextly migrate` drops them when the operator asks it to.
 *
 * Nextly keeps no record that it created the sign-in tables: older versions
 * created them with `CREATE TABLE IF NOT EXISTS` and a schema push, and the schema
 * ledger's `core_apply` rows name no tables. Their shape is not proof either,
 * because it is the shape of the Auth.js (NextAuth) SQL adapters' tables of
 * the same names, which a host app sharing the database may own. So nothing
 * here acts on a table by its shape alone: the startup report and the drop
 * the operator asks for name the table first, and a user deletion erases from
 * one only when the operator has named it in `NEXTLY_ERASE_RETIRED_AUTH_TABLES`.
 * A deleted user's rows in `user_permission_cache` are removed with the user
 * where the table has a foreign key to `users` (PostgreSQL, SQLite), and stay
 * until the drop on MySQL, where it has none.
 *
 * @module init/retired-auth-tables
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { z } from "zod";

import { introspectLiveSnapshot } from "../domains/schema/pipeline/diff/introspect-live";

import { RETIRED_AUTH_TABLES } from "./retired-auth-table-names";

export { RETIRED_AUTH_TABLES };

/**
 * The columns that make a table one of OURS rather than a table that merely
 * has the name.
 *
 * A fresh install no longer creates these tables, so the names can belong to
 * someone else: a host app sharing the database, or a session store whose
 * default table is `sessions`. Every column listed here was in every dialect's
 * definition of the retired table, and together they are specific enough that
 * an unrelated table does not carry all of them.
 */
const RETIRED_AUTH_TABLE_SHAPES: Readonly<Record<string, readonly string[]>> = {
  accounts: ["user_id", "provider", "provider_account_id"],
  sessions: ["session_token", "user_id", "expires"],
  user_permission_cache: [
    "user_id",
    "action",
    "resource",
    "has_permission",
    "role_ids",
    "expires_at",
  ],
};

/**
 * The retired sign-in tables: the ones a host app may own a namesake of, and
 * the ones a deleted user's rows can be erased from once the operator names
 * them.
 */
const SIGN_IN_TABLES: readonly string[] = ["accounts", "sessions"];

/**
 * Retired tables whose rows are only copies of answers recomputed from other
 * rows. `user_permission_cache` held a user's permission answers between
 * requests; every one is recomputed from their roles. Dropping one with rows
 * loses nothing, so the drop asked for is enough on its own.
 */
const DERIVED_ROW_TABLES: readonly string[] = ["user_permission_cache"];

/**
 * Whether a table with a retired name has the shape Nextly created it with.
 *
 * NECESSARY rather than sufficient: the startup warning, the drop and the
 * erasure all require it, so none of them acts on a namesake of another
 * shape — a host table named `accounts` was reported as Nextly's, dropped by
 * `nextly migrate`, and had `DELETE ... WHERE user_id = ?` run against it on
 * every user deletion, which failed and took the deletion with it. An Auth.js
 * table has this shape too, so the erasure also needs the operator's
 * {@link retiredTablesNamedForErasure}.
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

/** The variable an operator names the retired tables Nextly may erase from in. */
export const ERASE_RETIRED_AUTH_TABLES_ENV = "NEXTLY_ERASE_RETIRED_AUTH_TABLES";

/** A comma-separated list of names, read as each name trimmed and non-empty. */
const TABLE_LIST = z
  .string()
  .optional()
  .transform(value =>
    (value ?? "")
      .split(",")
      .map(name => name.trim())
      .filter(name => name !== "")
  );

/**
 * The retired tables the operator has named as Nextly's to erase a deleted
 * user's rows from.
 *
 * Named by the operator because nothing else can tell Nextly's table from a
 * host app's: no record says Nextly created it, and the shape is the Auth.js
 * adapters' too. Erasing from a host's table deletes that app's sign-in links
 * for a person who may still use it, so without a name the rows stay, and the
 * startup report says so. Only the retired sign-in tables count; anything else
 * in the list is ignored, since this never erases from another table.
 */
export function retiredTablesNamedForErasure(
  value: string | undefined
): ReadonlySet<string> {
  return new Set(
    TABLE_LIST.parse(value).filter(name => SIGN_IN_TABLES.includes(name))
  );
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
  found: readonly RetiredAuthTable[],
  namedForErasure: ReadonlySet<string> = new Set()
): string {
  const signIn = found.filter(entry => SIGN_IN_TABLES.includes(entry.table));
  const derived = found.filter(entry =>
    DERIVED_ROW_TABLES.includes(entry.table)
  );
  const notErased = signIn
    .filter(entry => !namedForErasure.has(entry.table))
    .map(entry => entry.table);
  return [
    "[nextly] Your database still has auth tables this version of Nextly no longer uses.",
    "",
    ...found.map(
      entry =>
        `  ${entry.table}: ${entry.rows} ${entry.rows === 1 ? "row" : "rows"}`
    ),
    ...(signIn.length > 0
      ? [
          "",
          "  Sessions are stateless JWTs with their own refresh-token table. Nothing writes or reads",
          "  these two tables, and a new install no longer creates them. Nextly has no record that it",
          "  created them, and the Auth.js (NextAuth) SQL adapters use tables of the same names and",
          "  shape, so check they are not another app's before acting. They are left in place because",
          "  dropping a table is your decision: `nextly migrate` with NEXTLY_DROP_RETIRED_AUTH_TABLES=1",
          "  drops them, and adding NEXTLY_DROP_NONEMPTY_RETIRED=1 is required for one that still holds",
          "  rows.",
        ]
      : []),
    ...(notErased.length > 0
      ? [
          `  Until then, deleting a user does not erase their rows from ${notErased.join(" or ")}.`,
          `  Set ${ERASE_RETIRED_AUTH_TABLES_ENV}=${notErased.join(",")} if ${notErased.length === 1 ? "it is" : "they are"} Nextly's, so it does.`,
        ]
      : []),
    ...(derived.length > 0
      ? [
          "",
          "  user_permission_cache held permission answers between requests. A user's access is now",
          "  kept in memory, nothing reads or writes this table, and a new install no longer creates",
          "  it. Its rows are copies recomputed from roles, so `nextly migrate` with",
          "  NEXTLY_DROP_RETIRED_AUTH_TABLES=1 drops it whether or not it holds rows.",
        ]
      : []),
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
 * rows does not hold back an empty one: each is decided on what it holds. A
 * table whose rows are only derived copies (`user_permission_cache`) loses
 * nothing that cannot be recomputed, so the drop asked for is enough for it.
 *
 * Kept as a pure decision so the policy can be tested without a database, and
 * so the caller is the only thing that touches one.
 */
export function planRetiredAuthTableDrop(
  found: readonly RetiredAuthTable[],
  opts: RetiredAuthDropOptions
): RetiredAuthTablePlan {
  if (!opts.dropRequested) return { drop: [], kept: [] };
  const kept = opts.allowNonEmpty
    ? []
    : found.filter(
        entry => entry.rows > 0 && !DERIVED_ROW_TABLES.includes(entry.table)
      );
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
