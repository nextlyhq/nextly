/**
 * Deciding whether adding NOT NULL to a column would actually lose anything.
 *
 * `add NOT NULL` is refused as destructive because it fails on rows that hold
 * NULL. That is true only when such rows exist, and the database can answer
 * that directly. Classified without asking, the op is refused on every column
 * that merely LOOKS newly-required — and SQLite makes that the common case,
 * because it reports a `TEXT PRIMARY KEY` as nullable (only INTEGER PRIMARY
 * KEY is implicitly NOT NULL there) while `.primaryKey()` on the desired side
 * means NOT NULL. Every primary key then reads as a pending NOT NULL addition
 * and the whole core reconcile is refused on a database nobody has changed.
 *
 * The probe lives here, not in the classifier: `classifyForMode` is pure and
 * synchronous, and giving it a database handle would make classification async
 * for every caller in the pipeline. The reconcile already holds `db`, so the
 * question is answered here and the classifier keeps deciding on facts.
 *
 * @module domains/schema/migrate/resolve-safe-nullability
 */

import { sql } from "drizzle-orm";

import type { Operation } from "../pipeline/diff/types";

/** Minimal database surface: the probe needs one read. */
interface Queryable {
  execute?: (query: unknown) => Promise<unknown>;
  all?: (query: unknown) => Promise<unknown>;
}

/**
 * Rows returned by the probe, across the shapes the drivers use.
 *
 * mysql2 resolves a query to `[rows, fieldPackets]`, so a probe that matched
 * nothing arrives as `[[], fields]` — an array of length 2. Reading the outer
 * length would call that "holds NULL" and refuse every safe migration on
 * MySQL, which is the opposite of what the probe exists to do. Unwrap the
 * tuple before treating an array as the row list.
 */
function hasAnyRow(result: unknown): boolean {
  if (Array.isArray(result)) {
    const rows = Array.isArray(result[0]) ? result[0] : result;
    return rows.length > 0;
  }
  if (result && typeof result === "object") {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows.length > 0;
  }
  return false;
}

/**
 * Whether a column currently holds any NULL.
 *
 * A probe that cannot run answers `true`: an unreadable column must stay
 * classified destructive, because treating an unknown as safe is how a real
 * data-losing change slips through.
 */
async function columnHoldsNull(
  db: Queryable,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const query = sql`SELECT 1 FROM ${sql.identifier(tableName)} WHERE ${sql.identifier(columnName)} IS NULL LIMIT 1`;
  try {
    if (typeof db.execute === "function") {
      return hasAnyRow(await db.execute(query));
    }
    if (typeof db.all === "function") {
      return hasAnyRow(await db.all(query));
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * The ops a destructive classification should consider.
 *
 * Used ONLY for classification. The caller keeps the full op list for the
 * zero-diff check and the apply, because an op removed here is safe to
 * perform, not unnecessary: dropping it from the apply would leave the
 * constraint unenforced while reporting success.
 *
 * An op is removed only when the database confirms it cannot lose data: the
 * column holds no NULL, so requiring it cannot fail on an existing row. Every
 * other op passes through, so a column that does hold NULLs is still refused
 * with its real reason.
 */
export async function resolveSafeNullabilityOps(
  db: unknown,
  ops: readonly Operation[]
): Promise<Operation[]> {
  const queryable = db as Queryable;
  const resolved: Operation[] = [];

  for (const op of ops) {
    // Only the NOT NULL direction can fail on existing rows. Relaxing a
    // column to nullable never can, and probing it would remove the op on the
    // usual no-NULLs answer, so the relaxation would be classified away.
    if (op.type !== "change_column_nullable" || op.toNullable) {
      resolved.push(op);
      continue;
    }
    if (await columnHoldsNull(queryable, op.tableName, op.columnName)) {
      resolved.push(op);
    }
  }

  return resolved;
}
