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

import { NextlyError } from "../../../errors/nextly-error";

import {
  identifierCaseRules,
  parseLowerCaseTableNames,
  type IdentifierCaseRules,
} from "./resolve-catalog-name";

/** Minimal adapter surface this helper needs. */
export interface IdentifierCaseAdapter {
  dialect: SupportedDialect;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
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
 * Read through `executeQuery` because this is a server variable, not data.
 * Drizzle's query builder addresses tables and columns; it has no surface for
 * session variables, and there are no user-supplied values here to parameterise.
 */
export async function readIdentifierCaseRules(
  adapter: IdentifierCaseAdapter
): Promise<IdentifierCaseRules> {
  if (adapter.dialect !== "mysql") {
    return identifierCaseRules({ dialect: adapter.dialect });
  }

  const rows = await adapter.executeQuery<Record<string, unknown>>(
    "SELECT @@lower_case_table_names AS lower_case_table_names"
  );
  const first = rows[0];
  if (first === undefined) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "cannot determine how this MySQL server compares table names: the server returned no value",
      logContext: { reason: "lower_case_table_names query returned no rows" },
    });
  }

  return identifierCaseRules({
    dialect: "mysql",
    lowerCaseTableNames: parseLowerCaseTableNames(
      first.lower_case_table_names ?? first.lowerCaseTableNames
    ),
  });
}
