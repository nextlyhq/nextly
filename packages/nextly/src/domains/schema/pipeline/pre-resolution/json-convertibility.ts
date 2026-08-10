/**
 * Whether a text column's contents survive being reinterpreted as JSON.
 *
 * ## Why a name cannot answer this
 *
 * The legacy repair is offered for a column pair shaped `_body` -> `body`, because a leading
 * underscore can only have been written by the old builder — field names cannot start with one. That
 * proves the column is LEGACY. It does not prove what the column CONTAINS.
 *
 * The underscore affected every field type, not only repeaters and groups. So a field originally
 * declared as ordinary text also carries a `_body` column, and changing that field to a repeater
 * during an upgrade produces exactly the same pair while the stored values are prose. Nothing in the
 * schema distinguishes the two: snapshots and rename operations carry the SQL type, never the
 * declared field type, and both cases read `text` -> `json`.
 *
 * The evidence is therefore in the data, and this asks it.
 *
 * ## Why it must run before the rename
 *
 * MySQL commits DDL implicitly. A conversion attempted after the rename and refused by the engine
 * leaves the column renamed and unconverted, with no transaction able to take it back. So the
 * question has to be answered while the column still has its old name and nothing has been changed.
 *
 * @module domains/schema/pipeline/pre-resolution/json-convertibility
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../../errors";

interface AsyncExecuteHandle {
  execute(query: unknown): Promise<unknown>;
}

interface SqliteRunHandle {
  all(query: unknown): unknown;
}

/** Quote an identifier for the dialect. */
function q(name: string, dialect: SupportedDialect): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

/**
 * Whether every non-null value in the column parses as JSON.
 *
 * The two servers answer differently, and both answers are exact rather than heuristic:
 *
 * - **MySQL** has `JSON_VALID`, so a single row matching `NOT JSON_VALID(c)` is a counterexample.
 *   `LIMIT 1` is safe in that direction: the query stops at the first row that PROVES the column
 *   unconvertible, and proving it convertible still requires reaching the end.
 * - **PostgreSQL** has no version-independent predicate — `pg_input_is_valid` arrives in 16 and the
 *   matrix tests 15 — so the cast itself is the test. `c::jsonb` RAISES on the first value it cannot
 *   parse, and that raise is the answer. Catching it is not swallowing an error; it is reading the
 *   only exact signal the server offers on every supported version.
 *
 * The PostgreSQL query must force the cast over EVERY row, which is why it aggregates rather than
 * selecting with a `LIMIT`. A `SELECT ... WHERE c::jsonb IS NOT NULL LIMIT 1` stops as soon as one
 * row satisfies it, so a column whose first row is valid JSON and whose second is prose answers
 * "convertible" — and the conversion then fails on the row the probe never looked at, which is the
 * exact mid-apply failure this exists to prevent. `count(c::jsonb)` has no early exit.
 *
 * A guess would not do here either. Deciding by a prefix like `^\s*[[{]` accepts `{oops` and would
 * hand the operator a conversion that still fails.
 *
 * ## What this does NOT answer
 *
 * Both queries skip NULL rows, which is right for the cast and only for the cast: `NULL::jsonb` is
 * NULL and raises nothing, so a NULL row cannot make a conversion fail. It would make a NOT NULL
 * fail — so if a conversion ever carries a nullability change alongside the type change, the rows
 * that break it are precisely the ones filtered out here and this probe would report safe.
 *
 * That is unreachable today: `executePreResolutionOps` calls `conversionForRename` without a
 * context, and every nullability and default statement it can emit is gated on one.
 *
 * That coupling is enforced rather than described. The caller refuses outright if a conversion ever
 * arrives carrying a nullability change, because the alternative is a probe that reads the wrong
 * rows while still looking correct — and noticing that by hand requires the person changing the call
 * site to first realise there is anything to notice.
 */
export async function columnHoldsOnlyJson(
  txOrDb: unknown,
  tableName: string,
  columnName: string,
  dialect: SupportedDialect
): Promise<boolean> {
  // SQLite stores JSON as text, so nothing is reinterpreted and nothing can fail.
  if (dialect === "sqlite") return true;

  const table = q(tableName, dialect);
  const column = q(columnName, dialect);

  if (dialect === "mysql") {
    const handle = txOrDb as AsyncExecuteHandle;
    const rows = await handle.execute(
      sql.raw(
        `SELECT 1 FROM ${table} WHERE ${column} IS NOT NULL AND NOT JSON_VALID(${column}) LIMIT 1`
      )
    );
    return countedRows(rows) === 0;
  }

  const handle = txOrDb as AsyncExecuteHandle;
  try {
    await handle.execute(
      sql.raw(
        `SELECT count(${column}::jsonb) FROM ${table} WHERE ${column} IS NOT NULL`
      )
    );
    return true;
  } catch (error) {
    // Only a DATA exception answers the question. SQLSTATE class 22 is exactly that class, and the
    // malformed-JSON cast raises 22P02 within it.
    //
    // Anything else means the probe could not run rather than that the column is unconvertible: a
    // missing table is 42P01, a lock timeout 55P03, a dropped connection class 08. Reporting those
    // as bad data would block a legitimate migration and send the operator to look at their rows
    // for a problem that is in their permissions or their cluster.
    if (isDataException(error)) return false;
    throw error;
  }
}

/**
 * Whether a driver error carries a SQLSTATE in class 22 — PostgreSQL's data-exception class.
 *
 * The chain is walked because Drizzle wraps the driver's error in a `DrizzleQueryError` and the
 * SQLSTATE stays on the original underneath. Reading `code` off the top object alone finds nothing
 * and would send every real cast failure past this check.
 *
 * It walks to the END of the chain rather than a fixed number of levels, because the wrapper count
 * is a property of the deployment and not of this code: a serverless HTTP driver or a pooler can nest
 * the driver's error deeper than a direct TCP connection does. A bound that fits the development
 * database would quietly stop finding the code on the one the product is deployed against.
 *
 * Termination comes from remembering what has been visited, since `cause` is an ordinary property
 * and nothing stops it pointing back. `MAX_CAUSE_LINKS` is a different quantity from the depth bound
 * just described and exists for a different reason: it is not a limit on how deep a legitimate chain
 * may go, it is the point past which the structure is malformed rather than deep. It THROWS instead
 * of returning, because a walk that quietly stopped early would answer "not a data exception" and
 * report a real bad-data column as an infrastructure failure — silence in the same place the rest of
 * this module refuses to be silent.
 */
const MAX_CAUSE_LINKS = 100;

function isDataException(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    if (seen.size >= MAX_CAUSE_LINKS) {
      throw NextlyError.internal({
        cause: error instanceof Error ? error : undefined,
        logContext: {
          reason: "error cause chain exceeded its sanity limit",
          maxCauseLinks: MAX_CAUSE_LINKS,
        },
      });
    }
    seen.add(current);
    if ("code" in current) {
      const { code } = current;
      if (typeof code === "string" && code.startsWith("22")) return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

/**
 * How many rows a driver reported, across the shapes the two servers return.
 *
 * mysql2 hands back `[rows, fields]`; node-postgres hands back `{ rows }`. Reading `.length` off the
 * wrong one silently answers zero, which here would report a column convertible when it is not.
 */
function countedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const first = result[0];
    return Array.isArray(first) ? first.length : result.length;
  }
  if (result && typeof result === "object" && "rows" in result) {
    // `in` narrows the property into existence and TypeScript types it `unknown`, which is exactly
    // what the Array.isArray guard below is for. No assertion needed.
    const { rows } = result;
    return Array.isArray(rows) ? rows.length : 0;
  }
  return 0;
}

/** Kept for the SQLite handle shape so the port stays honest about what it accepts. */
export type ConvertibilityHandle = AsyncExecuteHandle | SqliteRunHandle;
