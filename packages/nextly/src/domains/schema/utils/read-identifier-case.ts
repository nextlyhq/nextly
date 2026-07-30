/**
 * Asks a live server how it compares identifier names.
 *
 * Separated from `identifierCaseRules` so the mapping from server to rules stays
 * a pure function that can be tested for every dialect without a database, while
 * the one dialect that needs a round trip pays for it in a single place.
 *
 * @module domains/schema/utils/read-identifier-case
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";

import {
  identifierCaseRules,
  parseLowerCaseTableNames,
  type IdentifierCaseRules,
} from "./resolve-catalog-name";

/**
 * The slice of a Drizzle database this helper uses.
 *
 * Declared rather than imported because the concrete type is dialect-specific
 * and `getDrizzle` is generic over it; naming only `execute` keeps this typed
 * without reaching for `any`.
 */
interface RawSqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** Minimal adapter surface this helper needs. */
export interface IdentifierCaseAdapter {
  dialect: SupportedDialect;
  getDrizzle<T = unknown>(): T;
}

/**
 * Read the server's identifier-comparison rules.
 *
 * Postgres and SQLite are decided by dialect alone, so they cost nothing. MySQL
 * needs `lower_case_table_names`, which is server configuration rather than
 * anything the dialect or the connection string states, and there is no safe
 * static answer: assuming case-insensitive matching makes a dropped table look
 * present, and assuming case-sensitive matching refuses an upgrade that is
 * legitimate on the most common Linux packaging.
 *
 * Issued through Drizzle's `sql` template rather than as a raw string, which is
 * the sanctioned way to express something the query builder has no surface for —
 * a session variable is not a table, so there is nothing to select from.
 */
export async function readIdentifierCaseRules(
  adapter: IdentifierCaseAdapter
): Promise<IdentifierCaseRules> {
  if (adapter.dialect !== "mysql") {
    return identifierCaseRules({ dialect: adapter.dialect });
  }

  const db = adapter.getDrizzle<RawSqlExecutor>();
  const result = await db.execute(
    sql`select @@lower_case_table_names as lower_case_table_names`
  );

  const row = firstRow(result);
  if (row === undefined) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "cannot determine how this MySQL server compares table names: the server returned no value",
      logContext: { reason: "lower_case_table_names query returned no rows" },
    });
  }

  return identifierCaseRules({
    dialect: "mysql",
    lowerCaseTableNames: parseLowerCaseTableNames(
      row.lower_case_table_names ?? row.lowerCaseTableNames
    ),
  });
}

/**
 * The first record out of a Drizzle `execute` result.
 *
 * The shape is driver-specific: the mysql2 driver returns a
 * `[rows, fields]` tuple, while others return the rows directly. The two are
 * told apart by whether the first element is itself an array, which is the only
 * distinction that does not depend on trusting one driver's shape.
 */
function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(result)) return undefined;
  const rows = Array.isArray(result[0]) ? result[0] : result;
  const first: unknown = rows[0];
  if (typeof first !== "object" || first === null) return undefined;
  return first as Record<string, unknown>;
}
