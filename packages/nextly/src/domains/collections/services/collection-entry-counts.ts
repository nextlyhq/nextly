/**
 * How many entries a collection delete removes: counted for its review, and counted again where the
 * delete holds the collections' registry rows, compared with the counts the person confirmed. One
 * count serves both, so the review and the delete can never be asking different questions.
 *
 * @module domains/collections/services/collection-entry-counts
 */
import { type SQL, sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";

/** How many entries of `collection` the person confirmed deleting, as its review showed them. */
export interface ConfirmedEntries {
  collection: string;
  count: number;
}

/** A collection's entries as its delete review shows them. */
export interface ReviewedEntries {
  collection: string;
  rowCount: number;
  /** True where the count could not be read: never shown as an empty collection. */
  rowCountUnknown?: true;
}

/**
 * Where a count runs: the adapter, for a review, or the delete's transaction, whose statements see
 * what it holds. Both run a Drizzle statement and answer its rows.
 */
interface RunsStatements {
  queryStatement<T = Record<string, unknown>>(statement: SQL): Promise<T[]>;
}

/** A collection deleted: its slug and the table its entries are in. */
interface CountedCollection {
  slug: string;
  tableName: string;
}

/**
 * The entries in `tableName`, through `db`. The table's name is quoted as an identifier, so one
 * spelled with a hyphen is counted. A result with no readable count is a failure, never a zero.
 */
export async function countEntries(
  db: RunsStatements,
  tableName: string
): Promise<number> {
  const [row] = await db.queryStatement<{ count: unknown }>(
    sql`SELECT COUNT(*) AS ${sql.identifier("count")} FROM ${sql.identifier(tableName)}`
  );
  // PostgreSQL answers a count as text (a bigint); MySQL and SQLite as a number.
  const count = Number(row?.count);
  if (row === undefined || !Number.isSafeInteger(count) || count < 0) {
    throw NextlyError.internal({
      logContext: { reason: "entry count unreadable", table: tableName },
    });
  }
  return count;
}

/**
 * Each collection's entries for the delete review, in the order given. A count that cannot be read
 * is shown as unknown, so the dialog never offers it as an empty collection.
 */
export async function reviewedEntries(
  db: RunsStatements,
  collections: readonly CountedCollection[]
): Promise<ReviewedEntries[]> {
  const reviewed: ReviewedEntries[] = [];
  for (const { slug, tableName } of collections) {
    try {
      reviewed.push({
        collection: slug,
        rowCount: await countEntries(db, tableName),
      });
    } catch {
      reviewed.push({ collection: slug, rowCount: 0, rowCountUnknown: true });
    }
  }
  return reviewed;
}

/**
 * Refuses the delete, before it removes anything, where a collection's entries are no longer the
 * count the person confirmed (`confirmed`; a collection it does not name confirmed none). Counted
 * through `db`, the delete's transaction once it holds the registry rows, so no entry write lands
 * between this count and the removal. Without confirmed counts (a caller that sends none) nothing
 * is compared, as before.
 */
export async function refuseEntriesChanged(
  db: RunsStatements,
  collections: readonly CountedCollection[],
  confirmed: readonly ConfirmedEntries[] | undefined
): Promise<void> {
  if (confirmed === undefined) return;
  const confirmedOf = new Map(
    confirmed.map(entry => [entry.collection, entry.count])
  );
  const changed: Array<{
    slug: string;
    counted: number;
    confirmedCount: number;
  }> = [];
  for (const { slug, tableName } of collections) {
    const counted = await countEntries(db, tableName);
    const confirmedCount = confirmedOf.get(slug) ?? 0;
    if (counted !== confirmedCount) {
      changed.push({ slug, counted, confirmedCount });
    }
  }
  if (changed.length === 0) return;
  const entries = (n: number) =>
    `${String(n)} ${n === 1 ? "entry" : "entries"}`;
  throw NextlyError.validation({
    errors: changed.map(({ slug, counted, confirmedCount }) => ({
      path: `collections.${slug}`,
      code: "DELETION_COUNT_CHANGED",
      message: `${slug} now holds ${entries(counted)}, not the ${String(confirmedCount)} confirmed, so nothing was deleted. Review the new count and delete again.`,
    })),
    logContext: {
      reason: "deletion-count-changed",
      collections: changed.map(({ slug, counted, confirmedCount }) => ({
        slug,
        counted,
        confirmed: confirmedCount,
      })),
    },
  });
}
