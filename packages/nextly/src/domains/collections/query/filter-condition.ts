/**
 * A filter over one collection's entries, as an SQL condition.
 *
 * Built in two steps so the condition can be asked for where no I/O may run:
 * {@link prepareFilterCondition} loads what the filter needs to know about the
 * collection — its fields, the component tables its component paths reach and
 * their discriminator columns — and the condition it returns is then built
 * from that alone. A read builds it on the pool; a write builds it inside its
 * own transaction, on that transaction's Drizzle, under the row lock it holds.
 *
 * Every filter over a collection's entries goes through here: a caller's own
 * `where`, and a rule's filter wherever it is applied, so one filter means the
 * same rows wherever it is read.
 *
 * @module domains/collections/query/filter-condition
 */
import { caseInsensitiveContains } from "@nextlyhq/adapter-drizzle/text-match";
import { and, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import {
  FILTER_NAMES_A_COMPONENT_FIELD,
  reportRuleFilterMisuse,
  type RuleFilter,
} from "../../../auth/access/rule-answer";
import { NextlyError } from "../../../errors/nextly-error";
import { toSnakeCase } from "../../../lib/case-conversion";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { CompanionSchema } from "../../../services/collection-file-manager";
import {
  buildDrizzleCondition,
  buildLocalizedWhereExists,
  type LocalizedQueryContext,
} from "../../../services/collections/drizzle-condition";
import {
  buildWhereClause,
  extractComponentFieldConditions,
  type ComponentFieldFilter,
  type WhereFilter,
} from "../../../services/collections/query-operators";
import type { Logger } from "../../../services/shared";
import {
  resolveTypeColumns,
  type CatalogReadAdapter,
} from "../../field-groups/storage/resolve-storage-names";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import { collectionTableName } from "../services/collection-utils";

/** A collection's runtime table: its columns, by field name. */
export type DynamicSchema = Record<string, SQLWrapper | undefined>;

/** Where a filter's facts about its collection are read. */
export interface FilterConditionSources {
  /** The collection's stored record, carrying its fields. */
  getCollection(collectionName: string): Promise<unknown>;
  /** The physical table name of a component, where the registry knows it. */
  getComponentTableName?(slug: string): Promise<string | null | undefined>;
  /**
   * Where the catalog naming a component table's discriminator is read: the
   * adapter, or one bound to the transaction a write already holds, so the
   * read takes no second connection.
   */
  adapter: CatalogReadAdapter;
}

/** A filter whose facts are loaded, ready to be built as SQL with no I/O. */
export interface PreparedFilterCondition {
  /** The component tables the filter's component paths reach, by slug. */
  readonly componentTables: Map<string, string>;
  /** The discriminator column of each component table it reaches. */
  readonly componentTypeColumns: Map<string, string>;
  /** Whether the filter names a field inside a component. */
  readonly namesComponentFields: boolean;
  /**
   * The filter as one SQL condition over `schema`, or `undefined` for a
   * filter that constrains nothing. Pure: it reads nothing, so it may be
   * called inside a transaction or with any Drizzle the schema belongs to.
   */
  condition(
    schema: DynamicSchema,
    localizedCtx: LocalizedQueryContext | null
  ): SQLWrapper | undefined;
}

/**
 * Load what `filter` needs to know about `collectionName`.
 *
 * `filter` arrives with its language and geo keys already taken out, by the
 * machinery that can express them. Component tables and discriminator columns
 * a caller resolved already, such as a list handing its own to its count, are
 * reused rather than looked up again.
 */
export async function prepareFilterCondition(
  params: {
    collectionName: string;
    filter: WhereFilter | undefined;
    resolvedComponentTables?: Map<string, string>;
    resolvedComponentTypeColumns?: Map<string, string>;
  },
  sources: FilterConditionSources
): Promise<PreparedFilterCondition> {
  if (!params.filter) {
    return {
      componentTables: params.resolvedComponentTables ?? new Map(),
      componentTypeColumns: params.resolvedComponentTypeColumns ?? new Map(),
      namesComponentFields: false,
      condition: () => undefined,
    };
  }

  const collection = await sources.getCollection(params.collectionName);
  const { componentFilters, cleanedWhere } = extractComponentFieldConditions(
    params.filter,
    declaredFields(collection)
  );
  const componentTables =
    params.resolvedComponentTables ??
    (await componentTableNamesFor(componentSlugsOf(componentFilters), sources));
  const componentTypeColumns =
    params.resolvedComponentTypeColumns ??
    (await componentTypeColumnsFor(
      componentFilters,
      componentTables.values(),
      sources.adapter
    ));
  // Components record their parent under the physical table the write
  // resolved, so the filter must name the same one for a `dbName` collection
  // or it matches no component row.
  const parentTable = collectionTableName(collection, params.collectionName);

  return {
    componentTables,
    componentTypeColumns,
    namesComponentFields: componentFilters.length > 0,
    condition(schema, localizedCtx) {
      const parts: SQLWrapper[] = [];
      const componentCondition = componentFieldCondition(
        componentFilters,
        parentTable,
        schema.id,
        componentTables,
        componentTypeColumns
      );
      if (componentCondition) parts.push(componentCondition);
      // What remains once the component keys are taken by the EXISTS
      // subqueries above, which the generic builder has no way to express.
      if (cleanedWhere) {
        const whereCondition = buildDrizzleCondition(
          buildWhereClause(cleanedWhere),
          schema,
          localizedCtx,
          buildLocalizedWhereExists
        );
        if (whereCondition) parts.push(whereCondition);
      }
      if (parts.length === 0) return undefined;
      return parts.length === 1 ? parts[0] : and(...parts);
    },
  };
}

/**
 * The condition a read rule's filter adds to a read of `collectionName`. A
 * filter that cannot be built against the collection as it stands, one naming
 * a field it no longer has, matches no entry: a read by id then answers as a
 * missing entry does, a list finds nothing, and a relationship withholds
 * every row. The rule's own error is logged for whoever maintains the rule,
 * by its code alone, and never handed to the caller, to whom it would
 * describe the rule.
 *
 * Every read that applies a read rule's filter builds it here, so a filter
 * matches the same entries whichever read applies it.
 */
export async function ruleFilterCondition(
  params: {
    collectionName: string;
    filter: RuleFilter;
    schema: DynamicSchema;
    localizedCtx: LocalizedQueryContext | null;
  },
  sources: FilterConditionSources,
  logger: Pick<Logger, "error">
): Promise<SQLWrapper | undefined> {
  const { collectionName } = params;
  const unbuildable = (error: unknown): SQLWrapper => {
    // Only the builder's own refusal of the filter, a validation error
    // naming what the collection lacks, is a filter that cannot be built.
    // Anything else, a lookup the build needs failing as a lost connection
    // does, fails the read as it would any other.
    if (!NextlyError.isValidation(error)) throw error;
    logger.error("A read rule's filter could not be built", {
      collectionName,
      code: error.code,
    });
    return sql`1 = 0`;
  };
  let prepared: PreparedFilterCondition;
  try {
    prepared = await prepareFilterCondition(
      { collectionName, filter: params.filter },
      sources
    );
  } catch (error) {
    return unbuildable(error);
  }
  // A field inside a component cannot be used in a rule's filter yet: it is
  // refused as a filter that is not well formed, reported once and raised
  // in development, and matches no entry. Asked before any condition is
  // built, so no query runs on a component path the component may not have.
  if (prepared.namesComponentFields) {
    reportRuleFilterMisuse(
      collectionName,
      "read",
      "collection",
      FILTER_NAMES_A_COMPONENT_FIELD
    );
    return sql`1 = 0`;
  }
  try {
    // A localized field the read shows from a fallback language is judged
    // on that language's value too, so the read shows nothing the rule
    // refuses.
    return prepared.condition(
      params.schema,
      params.localizedCtx
        ? { ...params.localizedCtx, inEveryFallbackLanguage: true }
        : null
    );
  } catch (error) {
    return unbuildable(error);
  }
}

/**
 * What a filter on a localized field reads: the companion table's rows in the
 * read's language, the head of `localeChain`. `null` for a collection with no
 * companion or a read with no language. `statusFilterValues` is the read's
 * Draft/Published filter, resolved before this is built, so a per-locale
 * check constrains by the same status (a public read never matches a draft).
 */
export function localizedFilterContext(
  companion: CompanionSchema | null,
  localeChain: readonly string[] | null,
  schema: DynamicSchema,
  statusFilterValues?: readonly string[] | null
): LocalizedQueryContext | null {
  if (!companion || !localeChain || localeChain.length === 0) return null;
  return {
    companionTableName: companion.companionTableName,
    localizedFields: companion.localizedFields,
    mainIdColumn: schema.id,
    locale: localeChain[0],
    localeChain,
    companionTable: companion.table,
    // Only constrain by status when the collection has per-locale status and the
    // read resolved to a single status; otherwise leave it unfiltered.
    statusValues:
      companion.hasStatus && statusFilterValues
        ? statusFilterValues
        : undefined,
  };
}

/**
 * A collection's declared top-level fields: under `schemaDefinition.fields`
 * for a Builder collection, `fields` for a code-first one.
 */
function declaredFields(collection: unknown): Array<{
  name: string;
  type: string;
  component?: string;
  components?: string[];
}> {
  const record = (collection ?? {}) as Record<string, unknown>;
  const definition = record.schemaDefinition as
    | Record<string, unknown>
    | undefined;
  return (definition?.fields || record.fields || []) as Array<{
    name: string;
    type: string;
    component?: string;
    components?: string[];
  }>;
}

/**
 * The component slugs whose tables `filters` reach. A `_componentType` filter
 * pinned to one type reaches only that table, so resolving the whole zone
 * would cost a round trip per unused component choice.
 */
function componentSlugsOf(filters: readonly ComponentFieldFilter[]): string[] {
  return filters.flatMap(filter =>
    filter.isComponentTypeFilter && typeof filter.value === "string"
      ? [filter.value]
      : filter.componentSlugs
  );
}

/**
 * The physical table name of each component slug the registry knows; a slug
 * it does not know is left out, for the caller's canonical fallback.
 */
export async function componentTableNamesFor(
  slugs: Iterable<string>,
  sources: Pick<FilterConditionSources, "getComponentTableName">
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const lookup = sources.getComponentTableName;
  if (!lookup) return resolved;
  // Resolved together rather than in sequence: these are independent point
  // lookups, and this runs on every request carrying a component filter.
  const lookups = await Promise.all(
    [...new Set(slugs)].map(async slug => ({
      slug,
      tableName: await lookup(slug),
    }))
  );
  for (const { slug, tableName } of lookups) {
    if (tableName) resolved.set(slug, tableName);
  }
  return resolved;
}

/**
 * The physical discriminator column each named component table carries.
 *
 * The component predicate is built as raw SQL rather than through the table
 * object, so it emits the column name it is handed: a `_componentType` filter
 * must be given the name the table actually has, or it addresses a column the
 * storage migration has moved and the query fails instead of matching.
 */
async function componentTypeColumnsFor(
  filters: readonly ComponentFieldFilter[],
  tableNames: Iterable<string>,
  adapter: CatalogReadAdapter
): Promise<Map<string, string>> {
  // Only a `_componentType` filter addresses the discriminator. Every other
  // component filter names a user column, so introspecting here would spend
  // per-table catalog queries on a value nothing goes on to read.
  if (!filters.some(filter => filter.isComponentTypeFilter)) return new Map();
  const tables = [...new Set(tableNames)];
  if (tables.length === 0) return new Map();
  return resolveTypeColumns(adapter, tables);
}

/**
 * The component-field predicates as EXISTS subqueries against the component
 * tables, ANDed: an entry matches when each predicate finds a matching
 * component row in one of the tables its field may store in.
 */
function componentFieldCondition(
  componentFilters: readonly ComponentFieldFilter[],
  parentTableName: string,
  parentIdColumn: SQLWrapper | undefined,
  componentTableNames: Map<string, string>,
  componentTypeColumns: Map<string, string>
): SQL | undefined {
  const existsConditions: SQL[] = [];
  for (const filter of componentFilters) {
    const condition = anyComponentTableMatches(filter, {
      parentTableName,
      parentIdColumn,
      componentTableNames,
      componentTypeColumns,
    });
    if (condition) existsConditions.push(condition);
  }
  if (existsConditions.length === 0) return undefined;
  return existsConditions.length === 1
    ? existsConditions[0]
    : and(...existsConditions);
}

/** Where a component predicate's EXISTS subqueries look, per table. */
interface ComponentTables {
  parentTableName: string;
  parentIdColumn: SQLWrapper | undefined;
  componentTableNames: Map<string, string>;
  componentTypeColumns: Map<string, string>;
}

/**
 * One component predicate: an entry matches when any table its field may
 * store in holds a matching row. A `_componentType` filter names the one type
 * it looks for, so only that component's table is queried.
 */
function anyComponentTableMatches(
  filter: ComponentFieldFilter,
  tables: ComponentTables
): SQL | undefined {
  const slugsToQuery =
    filter.isComponentTypeFilter && typeof filter.value === "string"
      ? [filter.value]
      : filter.componentSlugs;
  const perTable = slugsToQuery
    .map(slug => componentTableMatches(filter, slug, tables))
    .filter((condition): condition is SQL => condition !== undefined);
  if (perTable.length <= 1) return perTable[0];
  return or(...perTable);
}

/**
 * Whether the component table of `slug` holds a row of this entry matching
 * `filter`, as an EXISTS subquery; `undefined` for an operator with nothing to
 * match there.
 */
function componentTableMatches(
  filter: ComponentFieldFilter,
  slug: string,
  tables: ComponentTables
): SQL | undefined {
  // The registry records the physical name, which is the only source for a
  // component with a custom dbName; canonical resolution is the fallback.
  const componentTableName =
    tables.componentTableNames.get(slug) ?? resolveComponentTableName(slug);
  // The discriminator's physical name is resolved PER TABLE: the storage
  // migration may have moved it on some tables and not others.
  const dbColumnName = filter.isComponentTypeFilter
    ? (tables.componentTypeColumns.get(componentTableName) ??
      STORAGE_FORMAT.columns.type)
    : toSnakeCase(filter.componentFieldPath);
  // An operator with nothing to match — an empty `in` list, or one this
  // builder does not implement — contributes no condition for this table.
  const valueCondition = componentValueCondition(filter, dbColumnName);
  if (valueCondition === undefined) return undefined;
  return sql`
    EXISTS (
      SELECT 1 FROM ${sql.identifier(componentTableName)}
      WHERE ${sql.identifier(STORAGE_FORMAT.columns.parentId)} = ${tables.parentIdColumn}
      AND ${sql.identifier(STORAGE_FORMAT.columns.parentTable)} = ${tables.parentTableName}
      AND ${sql.identifier(STORAGE_FORMAT.columns.parentField)} = ${filter.fieldName}
      AND ${valueCondition}
    )
  `;
}

/** The comparison each comparing operator writes, from a fixed list. */
const COMPARISONS: Readonly<Record<string, string>> = {
  equals: "=",
  not_equals: "!=",
  greater_than: ">",
  greater_than_equal: ">=",
  less_than: "<",
  less_than_equal: "<=",
};

/**
 * One component-field predicate, as raw SQL against a named column. Built once
 * per component TABLE rather than once per filter, since the column it names
 * can differ between tables.
 */
function componentValueCondition(
  filter: ComponentFieldFilter,
  dbColumnName: string
): SQL | undefined {
  const column = sql.identifier(dbColumnName);
  const comparison = COMPARISONS[filter.operator];
  // The operator is one of the fixed comparisons above, never caller text.
  if (comparison) return sql`${column} ${sql.raw(comparison)} ${filter.value}`;
  switch (filter.operator) {
    case "like":
      return sql`${column} LIKE ${`%${String(filter.value)}%`}`;
    case "contains":
    case "search":
      // The same rule as every other case-insensitive search: whatever the
      // collation, and with the text matched as typed.
      return caseInsensitiveContains(sql`${column}`, String(filter.value));
    case "in":
    case "not_in":
      return listCondition(column, filter);
    case "exists":
      return filter.value === true || filter.value === "true"
        ? sql`${column} IS NOT NULL`
        : sql`${column} IS NULL`;
    default:
      // An operator this builder does not implement contributes no condition.
      return undefined;
  }
}

/** An `in` or `not_in` predicate; an empty list has nothing to match. */
function listCondition(
  column: ReturnType<typeof sql.identifier>,
  filter: ComponentFieldFilter
): SQL | undefined {
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  if (values.length === 0) return undefined;
  const list = sql.join(
    values.map(value => sql`${value}`),
    sql`, `
  );
  return filter.operator === "in"
    ? sql`${column} IN (${list})`
    : sql`${column} NOT IN (${list})`;
}
