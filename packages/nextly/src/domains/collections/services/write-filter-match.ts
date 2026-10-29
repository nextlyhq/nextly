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

import {
  FILTER_NAMES_A_COMPONENT_FIELD,
  reportRuleFilterMisuse,
  type RuleFilter,
} from "../../../auth/access/rule-answer";
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
 * collection, before any transaction opens.
 */
export async function prepareWriteMatch(
  params: {
    collectionName: string;
    /** The write the filter limits, named when its filter is misused. */
    action: string;
    filter: RuleFilter;
    read: ReadReach;
  },
  sources: FilterConditionSources
): Promise<PreparedWriteMatch> {
  const { collectionName } = params;
  const prepare = (filter: RuleFilter, action: string) =>
    preparedOrUnbuildable(collectionName, action, filter, sources);
  const write = await prepare(params.filter, params.action);
  const read =
    params.read.kind === "matching"
      ? await prepare(params.read.filter, "read")
      : null;
  const readKind = params.read.kind;

  return {
    columns(schema, localizedCtx) {
      return {
        writes: matchColumn(
          { collectionName, action: params.action },
          write,
          schema,
          localizedCtx.writes
        ),
        reads: read
          ? matchColumn(
              { collectionName, action: "read" },
              read,
              schema,
              localizedCtx.reads
            )
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
  action: string,
  filter: RuleFilter,
  sources: FilterConditionSources
): Promise<PreparedFilterCondition | null> {
  try {
    return await prepareFilterCondition({ collectionName, filter }, sources);
  } catch (error) {
    reportUnbuildable(collectionName, action, error);
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
  rule: { collectionName: string; action: string },
  prepared: PreparedFilterCondition | null,
  schema: DynamicSchema,
  localizedCtx: LocalizedQueryContext | null
): SQL<number> {
  const { collectionName } = rule;
  if (!prepared) return sql<number>`0`;
  // A rule's filter on a field inside a component is refused as one that is
  // not well formed, reported once and raised in development, as a read
  // refuses it: it matches no entry, and no query runs on its path.
  if (prepared.namesComponentFields) {
    reportRuleFilterMisuse(
      collectionName,
      rule.action,
      "collection",
      FILTER_NAMES_A_COMPONENT_FIELD
    );
    return sql<number>`0`;
  }
  let condition: ReturnType<PreparedFilterCondition["condition"]>;
  try {
    condition = prepared.condition(schema, localizedCtx);
  } catch (error) {
    reportUnbuildable(collectionName, rule.action, error);
    return sql<number>`0`;
  }
  // A filter that constrains nothing matches every row.
  if (!condition) return sql<number>`1`;
  return sql<number>`case when ${condition} then 1 else 0 end`;
}

/**
 * Log a rule's filter that cannot be built, by its error's code alone. Only
 * the builder's own refusal of the filter, a validation error naming what
 * the collection lacks, is a filter that cannot be built: anything else, a
 * lookup the build needs failing as a lost connection does, is rethrown and
 * fails the write as it would any other, as a read fails.
 */
function reportUnbuildable(
  collectionName: string,
  action: string,
  error: unknown
): void {
  if (!NextlyError.isValidation(error)) throw error;
  consoleLogger.error(`A ${action} rule's filter could not be built`, {
    collectionName,
    code: error.code,
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
    // A comparison's value is converted as the companion column stores it,
    // as a read converts it, so a date matches on every dialect alike.
    companionTable: companion.table,
  };
}

/**
 * The languages a plain read in the default language judges a translated
 * field's read filter in: its fallback chain, every language of it, as the
 * read by id asks it, so the write tells apart only what that read would
 * show. `null` for a collection without languages.
 */
export function readLocalizedContext(
  companion: CompanionSchema | null,
  schema: DynamicSchema,
  localeChain: readonly string[] | null
): LocalizedQueryContext | null {
  const head = localeChain?.[0];
  if (!companion || !head) return null;
  return {
    companionTableName: companion.companionTableName,
    localizedFields: companion.localizedFields,
    mainIdColumn: schema.id,
    locale: head,
    localeChain,
    companionTable: companion.table,
    inEveryFallbackLanguage: true,
  };
}
