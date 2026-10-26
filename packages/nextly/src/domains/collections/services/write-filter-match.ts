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
import type { CompanionSchema } from "../../../domains/i18n/runtime/companion-io";
import { NextlyError } from "../../../errors/nextly-error";
import type { LocalizedQueryContext } from "../../../services/collections/drizzle-condition";
import { consoleLogger } from "../../../shared/types";
import {
  prepareFilterCondition,
  type DynamicSchema,
  type FilterConditionSources,
  type PreparedFilterCondition,
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
   */
  columns(
    schema: DynamicSchema,
    localizedCtx: LocalizedQueryContext | null
  ): { writes: SQL<number>; reads: SQL<number> };
}

/**
 * Load what the write filter and the read reach need to know about the
 * collection, before any transaction opens.
 */
export async function prepareWriteMatch(
  params: { collectionName: string; filter: RuleFilter; read: ReadReach },
  sources: FilterConditionSources
): Promise<PreparedWriteMatch> {
  const { collectionName } = params;
  const prepare = (filter: RuleFilter) =>
    preparedOrUnbuildable(collectionName, filter, sources);
  const write = await prepare(params.filter);
  const read =
    params.read.kind === "matching" ? await prepare(params.read.filter) : null;
  const readKind = params.read.kind;

  return {
    columns(schema, localizedCtx) {
      return {
        writes: matchColumn(collectionName, write, schema, localizedCtx),
        reads: read
          ? matchColumn(collectionName, read, schema, localizedCtx)
          : readKind === "every"
            ? sql<number>`1`
            : sql<number>`0`,
      };
    },
  };
}

/**
 * A rule's filter, its facts loaded, or `null` where they cannot be: a rule's
 * filter is well formed (the decision refuses any other, reserved keys
 * included) but may still name a field the collection does not have.
 */
async function preparedOrUnbuildable(
  collectionName: string,
  filter: RuleFilter,
  sources: FilterConditionSources
): Promise<PreparedFilterCondition | null> {
  try {
    return await prepareFilterCondition({ collectionName, filter }, sources);
  } catch (error) {
    reportUnbuildable(collectionName, error);
    return null;
  }
}

/**
 * `1` where the row matches the prepared filter, `0` where it does not. A
 * filter that cannot be built matches no row, as a read answers it: the rule's
 * fault, never the caller's, so it is not reported to the caller as an error
 * naming the field.
 */
function matchColumn(
  collectionName: string,
  prepared: PreparedFilterCondition | null,
  schema: DynamicSchema,
  localizedCtx: LocalizedQueryContext | null
): SQL<number> {
  if (!prepared) return sql<number>`0`;
  let condition: ReturnType<PreparedFilterCondition["condition"]>;
  try {
    condition = prepared.condition(schema, localizedCtx);
  } catch (error) {
    reportUnbuildable(collectionName, error);
    return sql<number>`0`;
  }
  // A filter that constrains nothing matches every row.
  if (!condition) return sql<number>`1`;
  return sql<number>`case when ${condition} then 1 else 0 end`;
}

/** Log a rule's filter that cannot be built, by its error's code alone. */
function reportUnbuildable(collectionName: string, error: unknown): void {
  consoleLogger.error("A write rule's filter could not be built", {
    collectionName,
    code: error instanceof NextlyError ? error.code : "UNBUILDABLE",
  });
}

/**
 * The match the row's columns report, read the same on every dialect: each
 * returns the CASE as an integer, or a string of one on a driver that does.
 */
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

/**
 * The language a write's filter is matched in, for a localized collection: a
 * filter on a translated field reads that field's value in `locale`, as a
 * caller's own filter does on a read in that language. `null` for a
 * collection without languages.
 */
export function writeLocalizedContext(
  companion: CompanionSchema | null,
  schema: DynamicSchema,
  locale: string | undefined
): LocalizedQueryContext | null {
  if (!companion || !locale) return null;
  return {
    companionTableName: companion.companionTableName,
    localizedFields: companion.localizedFields,
    mainIdColumn: schema.id,
    locale,
  };
}
