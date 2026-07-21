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

/** Rows returned by the probe, across the shapes the drivers use. */
function hasAnyRow(result: unknown): boolean {
  if (Array.isArray(result)) return result.length > 0;
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
 * Drop the `change_column_nullable` ops that cannot lose data.
 *
 * The returned ops are what the classifier sees. An op removed here is one the
 * database has confirmed is safe: the column holds no NULL, so requiring it
 * cannot fail on an existing row. Every other op passes through untouched, so
 * a column that does hold NULLs is still refused, with its real reason.
 */
export async function resolveSafeNullabilityOps(
  db: unknown,
  ops: readonly Operation[]
): Promise<Operation[]> {
  const queryable = db as Queryable;
  const resolved: Operation[] = [];

  for (const op of ops) {
    if (op.type !== "change_column_nullable") {
      resolved.push(op);
      continue;
    }
    // Only the NOT NULL direction can fail on existing rows; relaxing a column
    // to nullable never does, and is not classified destructive anyway.
    if (await columnHoldsNull(queryable, op.tableName, op.columnName)) {
      resolved.push(op);
    }
  }

  return resolved;
}
