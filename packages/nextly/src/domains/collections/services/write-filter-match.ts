/**
 * Whether one entry is inside the filter a write rule answered, and whether
 * the caller may read it.
 *
 * A rule may let a caller change only the entries its filter matches. A write
 * reads its row by id, never through a list, so it asks this question of the
 * row itself: the write filter's match and the read access's match are
 * selected as columns of that row, in one query, on whichever connection the
 * write is holding — the pool before its hooks run, then the write's own
 * transaction under the row lock, so the entry it changes is the entry it
 * judged.
 *
 * An entry outside the write filter is refused: in words where the caller may
 * read it, and as a missing entry where it may not, so the refusal confirms
 * nothing the caller could not already see.
 *
 * @module domains/collections/services/write-filter-match
 */
import { sql, type SQL } from "drizzle-orm";

import type { RuleFilter } from "../../../auth/access/rule-answer";
import type { LocalizedQueryContext } from "../../../services/collections/drizzle-condition";
import type { Logger } from "../../../services/shared";
import {
  asReadOf,
  matchColumn,
  prepareRuleFilter,
  type DynamicSchema,
  type FilterConditionSources,
} from "../query/filter-condition";

/** Which of a collection's entries the caller may read. */
export type ReadReach =
  | { readonly kind: "every" }
  | { readonly kind: "matching"; readonly filter: RuleFilter }
  | { readonly kind: "none" };

/** What the row says about a write limited to a filter. */
export interface EntryWriteMatch {
  /** The row exists. */
  readonly exists: boolean;
  /** The row is inside the write filter. */
  readonly writes: boolean;
  /** The caller may read the row. */
  readonly reads: boolean;
}

/** The two match columns a write limited to a filter selects of its row. */
export interface FilteredWriteMatch {
  readonly columns: { writes: SQL<number>; reads: SQL<number> };
}

/** A write filter and a read reach whose facts are loaded, ready as SQL. */
export interface PreparedWriteMatch {
  /**
   * The two match columns over `schema`, each `1` where the row matches and
   * `0` where it does not. Pure, so they may be built inside a transaction.
   * Each is matched in a language of its own: the write filter in the
   * language the write acts in, and the read reach in the one the plain read
   * whose verdict it carries was asked in.
   */
  columns(
    schema: DynamicSchema,
    localizedCtx: WriteMatchLanguages
  ): { writes: SQL<number>; reads: SQL<number> };
}

/**
 * The language each match column reads a translated field in: the write's
 * own language for the write filter, and the plain read's languages for
 * whether the caller may read the entry. `null` for a collection without
 * languages.
 */
export interface WriteMatchLanguages {
  readonly writes: LocalizedQueryContext | null;
  readonly reads: LocalizedQueryContext | null;
}

/**
 * Load what the write filter and the read reach need to know about the
 * collection, before any transaction opens. Each is prepared as every rule's
 * filter is ({@link prepareRuleFilter}): one that cannot be built, or names a
 * field inside a component, matches no entry.
 */
export async function prepareWriteMatch(
  params: {
    collectionName: string;
    /** The write the filter limits, named when its filter is reported. */
    action: string;
    filter: RuleFilter;
    read: ReadReach;
  },
  sources: FilterConditionSources,
  logger: Pick<Logger, "error">
): Promise<PreparedWriteMatch> {
  const { collectionName } = params;
  const write = await prepareRuleFilter(
    { collectionName, filter: params.filter, action: params.action },
    sources,
    logger
  );
  const read =
    params.read.kind === "matching"
      ? await prepareRuleFilter(
          { collectionName, filter: params.read.filter },
          sources,
          logger
        )
      : null;
  const readKind = params.read.kind;

  return {
    columns(schema, localizedCtx) {
      return {
        writes: matchColumn(write.condition(schema, localizedCtx.writes)),
        // Matched as a read judges the read rule, fallback languages
        // included, so the write tells apart only what a read would show.
        reads: read
          ? matchColumn(read.condition(schema, asReadOf(localizedCtx.reads)))
          : readKind === "every"
            ? sql<number>`1`.mapWith(Number)
            : sql<number>`0`.mapWith(Number),
      };
    },
  };
}

/** The match the row's columns report, read as numbers on every dialect. */
export function writeMatchOf(
  row: { writes: unknown; reads: unknown } | undefined
): EntryWriteMatch {
  if (!row) return { exists: false, writes: false, reads: false };
  return {
    exists: true,
    writes: Number(row.writes) === 1,
    reads: Number(row.reads) === 1,
  };
}
