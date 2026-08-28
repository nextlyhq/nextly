/**
 * "Was this failure a duplicate key?" — asked once, for every caller.
 *
 * A unique violation reaches application code in several different shapes
 * depending on where it is caught, and each layer respells it:
 *
 * | where it is caught | what it looks like |
 * | --- | --- |
 * | inside a transaction callback | the RAW driver error, with the driver's own code |
 * | after the adapter wraps it | `DatabaseError`, `kind: "unique_violation"` (underscore) |
 * | at the nextly service boundary | `DbError`, `kind: "unique-violation"` (hyphen) |
 *
 * The two `kind` spellings are different enums, not a typo.
 *
 * It also arrives NESTED. A failed query is an adapter `DatabaseError` wrapping
 * a `DrizzleQueryError` wrapping the driver's error, so the only object
 * carrying `SQLITE_CONSTRAINT_UNIQUE` sits at depth TWO. A one-level check
 * answers `false` for an ordinary duplicate key — measured, and the reason this
 * walk is depth-bounded rather than shallow.
 *
 * ## Why this lives in `shared/lib` rather than in a domain
 *
 * It began in `domains/versions/version-conflict`, which is where its first
 * caller was. The job queue is the second, and `domains/jobs` has nothing to do
 * with versions — importing one from the other would add a dependency edge that
 * describes history rather than meaning. `canonicalJson` moved here for exactly
 * this reason when it gained a second consumer. `version-conflict` re-exports
 * it, so its own callers are unchanged.
 *
 * @module shared/lib/unique-violation
 */

import { isDbError } from "../../database/errors";

/**
 * Raw driver unique-violation identifiers by dialect. The transaction-context
 * insert path throws the driver error directly — it is NOT normalized to a
 * nextly `DbError` until it escapes the transaction — so a caller must be able
 * to recognize the raw driver codes at the insert site.
 */
const RAW_UNIQUE_CODES = new Set<string>([
  "23505", // PostgreSQL unique_violation (SQLSTATE)
  "ER_DUP_ENTRY", // MySQL
  "SQLITE_CONSTRAINT_UNIQUE", // better-sqlite3
  "SQLITE_CONSTRAINT_PRIMARYKEY",
]);

/** One error object, in any of the three shapes described above. */
function isUniqueViolationShape(err: unknown): boolean {
  // Fully-normalized nextly DbError (service-layer boundary).
  if (isDbError(err) && err.kind === "unique-violation") return true;
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; errno?: unknown; kind?: unknown };
  // Adapter-layer DatabaseError: distinct name, underscore kind.
  if (e.kind === "unique_violation") return true;
  // MySQL surfaces the duplicate as errno 1062.
  if (e.errno === 1062) return true;
  // pg SQLSTATE / mysql code string / sqlite constraint code.
  if (typeof e.code === "string" && RAW_UNIQUE_CODES.has(e.code)) return true;
  return false;
}

/**
 * True when `err`, or anything in its `cause` chain, is a unique-constraint
 * violation.
 *
 * The depth bound also guards a cyclic chain: an error whose `cause` points
 * back at itself would otherwise hang the check.
 */
export function isUniqueViolation(err: unknown): boolean {
  let cursor: unknown = err;
  for (let depth = 0; depth < 10 && cursor != null; depth++) {
    if (isUniqueViolationShape(cursor)) return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}
