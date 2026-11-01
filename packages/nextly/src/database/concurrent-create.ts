/**
 * Creating a table that several processes may create at the same moment.
 *
 * On PostgreSQL `CREATE TABLE IF NOT EXISTS` checks for the table and then creates it, and two
 * sessions can both pass the check. The one that commits second fails, with one of three errors
 * depending on which catalog entry it reaches first:
 *
 * - 42P07 (duplicate_table): the relation exists.
 * - 42710 (duplicate_object): the table's row type exists (`type "t" already exists`).
 * - 23505 (unique_violation) on a catalog's name index: `pg_type_typname_nsp_index` for the row
 *   type, `pg_class_relname_nsp_index` for the relation or its primary key's index.
 *
 * Each means the other session created the table, so here each counts as success once the table
 * can be read. MySQL takes a metadata lock on the name for the whole statement, and SQLite runs
 * one write at a time, so `IF NOT EXISTS` already holds there and nothing is tolerated.
 *
 * @module database/concurrent-create
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { firstAnswer, ownCode, ownMessage } from "./missing-column";

/** PostgreSQL: duplicate_table. */
const POSTGRES_DUPLICATE_TABLE = "42P07";
/** PostgreSQL: duplicate_object. */
const POSTGRES_DUPLICATE_OBJECT = "42710";
/** PostgreSQL: unique_violation. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

/** The catalog indexes on a type's and a relation's name, which a concurrent create collides on. */
const CATALOG_NAME_INDEXES = [
  "pg_type_typname_nsp_index",
  "pg_class_relname_nsp_index",
];

/** The constraint THIS error object names, read without following the chain. */
function ownConstraint(link: unknown): string | undefined {
  if (!link || typeof link !== "object") return undefined;
  const constraint = (link as Record<string, unknown>).constraint;
  return typeof constraint === "string" ? constraint : undefined;
}

/**
 * Whether one level of the chain reports a concurrent create. A unique violation counts only on a
 * catalog name index, named by the same level that carries the code: as the driver's `constraint`
 * field, or quoted in its message when a wrapper kept the code but not the field.
 */
function levelIsConcurrentCreate(link: unknown): true | undefined {
  const code = ownCode(link);
  if (code === POSTGRES_DUPLICATE_TABLE || code === POSTGRES_DUPLICATE_OBJECT) {
    return true;
  }
  if (code !== POSTGRES_UNIQUE_VIOLATION) return undefined;
  const constraint = ownConstraint(link);
  const message = ownMessage(link);
  const onCatalog = CATALOG_NAME_INDEXES.some(index =>
    constraint === undefined
      ? message.includes(`"${index}"`)
      : constraint === index
  );
  return onCatalog ? true : undefined;
}

/**
 * Whether a failed PostgreSQL `CREATE TABLE IF NOT EXISTS` lost to another session creating the
 * same table. Read by code at every level of the error and its causes.
 */
export function isConcurrentCreateError(error: unknown): boolean {
  return firstAnswer(error, levelIsConcurrentCreate) ?? false;
}

/**
 * Run `statement`, a `CREATE TABLE IF NOT EXISTS` for `table`, so that processes running it at the
 * same moment all succeed.
 *
 * On PostgreSQL a concurrent-create error is followed by a read of the table: it succeeds when the
 * other session's table is there, and the original error is thrown when it is not. Every other
 * error, on every dialect, is thrown unchanged.
 */
export async function createTableIfAbsent(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  table: string,
  statement: string
): Promise<void> {
  try {
    await adapter.executeQuery(statement);
  } catch (error) {
    if (dialect !== "postgresql" || !isConcurrentCreateError(error)) {
      throw error;
    }
    try {
      await adapter.queryStatement(
        sql`SELECT 1 FROM ${sql.identifier(table)} WHERE 1 = 0`
      );
    } catch {
      throw error;
    }
  }
}
