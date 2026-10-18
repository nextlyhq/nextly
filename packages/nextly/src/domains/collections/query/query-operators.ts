/**
 * Query operators for filtering collection entries.
 *
 * This module provides mapping between Nextly query operator syntax and
 * the internal adapter-drizzle WhereClause format. It supports operators
 * for filtering, comparison, and existence checks.
 *
 * @example
 * ```typescript
 * import { buildWhereClause, WhereFilter } from './query-operators';
 *
 * // Simple equality
 * const where: WhereFilter = { status: { equals: 'published' } };
 * const adapterWhere = buildWhereClause(where);
 *
 * // Complex query with AND/OR
 * const complexWhere: WhereFilter = {
 *   and: [
 *     { status: { equals: 'published' } },
 *     { or: [
 *       { author: { equals: 'john' } },
 *       { author: { equals: 'jane' } }
 *     ]}
 *   ]
 * };
 * ```
 *
 * @packageDocumentation
 */

import type {
  WhereClause,
  WhereCondition,
  WhereOperator,
} from "@nextlyhq/adapter-drizzle/types";

import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "../../field-groups/storage/field-group-field-type";
import { isFieldGroupTypeKey } from "../../field-groups/storage/field-group-type-key";

import {
  assertWellFormedFilter,
  isPlainObject,
  refuseFilterProblems,
  snapshotFilter,
  type FilterProblem,
} from "./filter-shape";
import type { GeoFilter } from "./geo-utils";
import { parseNearQuery, parseWithinQuery } from "./geo-utils";

/**
 * Query operators for filtering collection entries.
 *
 * These operators are used in Nextly's REST API and Direct API
 * for filtering, comparison, and existence checks.
 */
export type QueryOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "greater_than_equal"
  | "less_than"
  | "less_than_equal"
  | "like"
  | "contains"
  | "search"
  | "in"
  | "not_in"
  | "exists";

/**
 * Geospatial query operators for point fields.
 *
 * These operators filter by geographic location and are applied
 * in the application layer after the database query.
 *
 * Used for point field filtering in collection queries.
 */
export type GeoQueryOperator = "near" | "within";

/**
 * All supported query operators (standard + geo).
 */
export type AllQueryOperators = QueryOperator | GeoQueryOperator;

/**
 * Set of geo operators for quick lookup.
 */
export const GEO_OPERATORS: Set<string> = new Set(["near", "within"]);

/**
 * Mapping from Nextly query operators to adapter-drizzle operators.
 */
const OPERATOR_MAP: Record<QueryOperator, WhereOperator> = {
  equals: "=",
  not_equals: "!=",
  greater_than: ">",
  greater_than_equal: ">=",
  less_than: "<",
  less_than_equal: "<=",
  like: "LIKE",
  // Case-insensitive literal substring matching, compiled by the adapter's one rule for it
  // (`caseInsensitiveContains`) whatever the column's collation.
  contains: "ICONTAINS",
  search: "ICONTAINS", // Alias for contains
  in: "IN",
  not_in: "NOT IN",
  exists: "IS NOT NULL", // Will be handled specially for false value
};

/**
 * Field condition with query operators.
 *
 * @example
 * ```typescript
 * // Simple equality
 * const condition: FieldCondition = { equals: 'published' };
 *
 * // Numeric comparison
 * const priceCondition: FieldCondition = { greater_than: 100 };
 *
 * // Array membership
 * const tagsCondition: FieldCondition = { in: ['news', 'featured'] };
 * ```
 */
export type FieldCondition = {
  [K in QueryOperator]?: unknown;
};

/**
 * WHERE clause structure for filtering collection entries.
 *
 * Supports both simple field conditions and compound AND/OR queries.
 *
 * @example
 * ```typescript
 * // Simple field query
 * const where: WhereFilter = {
 *   status: { equals: 'published' },
 *   price: { greater_than: 100 }
 * };
 *
 * // Compound OR query
 * const orWhere: WhereFilter = {
 *   or: [
 *     { color: { equals: 'red' } },
 *     { color: { equals: 'blue' } }
 *   ]
 * };
 *
 * // Complex nested query
 * const complexWhere: WhereFilter = {
 *   and: [
 *     { status: { equals: 'active' } },
 *     { or: [
 *       { role: { equals: 'admin' } },
 *       { role: { equals: 'editor' } }
 *     ]}
 *   ]
 * };
 * ```
 */
export interface WhereFilter {
  /** AND conditions - all must be true */
  and?: WhereFilter[];
  /** OR conditions - at least one must be true */
  or?: WhereFilter[];
  /** Field conditions (dynamic keys) */
  [field: string]: FieldCondition | WhereFilter[] | undefined;
}

/**
 * Build a WhereCondition from a field name and query operator.
 *
 * @param field - Field name (supports dot notation for nested fields)
 * @param operator - Query operator name
 * @param value - Value to compare against
 * @returns WhereCondition for the adapter
 */
function buildCondition(
  field: string,
  operator: QueryOperator,
  value: unknown
): WhereCondition {
  // Special handling for 'exists' operator
  if (operator === "exists") {
    return {
      column: field,
      op: value === true || value === "true" ? "IS NOT NULL" : "IS NULL",
    };
  }

  // 'contains' and 'search' take the text as typed: `ICONTAINS` matches it literally and does
  // its own escaping, so a typed `%` or `_` is a character to find.
  if (operator === "contains" || operator === "search") {
    return {
      column: field,
      op: OPERATOR_MAP[operator],
      value: String(value),
    };
  }

  // 'like' - wrap with wildcards. Escape backslash, percent, and underscore in the
  // user-supplied value so they are matched as literals rather than as SQL LIKE
  // wildcards. Backslash escape MUST come first or it will double-escape the % / _
  // replacements that follow.
  if (operator === "like") {
    const escaped =
      typeof value === "string"
        ? value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
        : String(value);
    return {
      column: field,
      op: OPERATOR_MAP[operator],
      value: `%${escaped}%`,
    };
  }

  // Special handling for 'in' and 'not_in' - ensure array
  if (operator === "in" || operator === "not_in") {
    const arrayValue = Array.isArray(value) ? value : [value];
    return {
      column: field,
      op: OPERATOR_MAP[operator],
      value: arrayValue,
    };
  }

  // Standard operators
  return {
    column: field,
    op: OPERATOR_MAP[operator],
    value: value as WhereCondition["value"],
  };
}

/**
 * Build adapter-drizzle WhereClause from a WhereFilter.
 *
 * Converts Nextly query syntax to the internal WhereClause format
 * used by the adapter-drizzle package.
 *
 * REFUSES a filter that is not well formed rather than building what it can
 * of it (see ./filter-shape). Skipping the member it did not understand used
 * to leave its siblings to decide alone, which answers a wider question than
 * the one asked. A geo operator is refused here too: the list read lifts geo
 * conditions out and applies them in memory before it calls this, so one that
 * still arrives has no SQL to become and would otherwise vanish.
 *
 * `undefined` means "no condition" (every row); an `or` with no members
 * becomes `{ or: [] }`, which the condition builder renders as matching no
 * row, as an empty disjunction is false.
 *
 * @param payload - WhereFilter input
 * @returns WhereClause for the adapter, or undefined if empty
 *
 * @example
 * ```typescript
 * // Simple equality
 * const where = buildWhereClause({ status: { equals: 'published' } });
 * // Result: { and: [{ column: 'status', op: '=', value: 'published' }] }
 *
 * // OR query
 * const orWhere = buildWhereClause({
 *   or: [
 *     { color: { equals: 'red' } },
 *     { color: { equals: 'blue' } }
 *   ]
 * });
 * // Result: { or: [{ and: [...] }, { and: [...] }] }
 * ```
 */
export function buildWhereClause(
  payload: WhereFilter
): WhereClause | undefined {
  // One read of the filter, checked and translated alike.
  const filter = snapshotFilter(payload);
  assertWellFormedFilter(filter);
  const geo: FilterProblem[] = [];
  const clause = buildClause(filter, "where", geo);
  refuseFilterProblems(geo);
  return clause;
}

/**
 * The clause for one well-formed filter node, recording any geo operator met.
 *
 * Only reached after `assertWellFormedFilter`, so every value here is a
 * scalar shorthand or an object of known operators with usable operands.
 */
function buildClause(
  payload: WhereFilter,
  path: string,
  geo: FilterProblem[]
): WhereClause | undefined {
  const conditions: (WhereCondition | WhereClause)[] = [
    ...logicalClauses(payload, path, geo),
  ];
  for (const [field, value] of Object.entries(payload)) {
    if (field === "and" || field === "or") continue;
    conditions.push(...fieldConditions(field, value, `${path}.${field}`, geo));
  }

  // Return undefined if no conditions
  if (conditions.length === 0) {
    return undefined;
  }

  // Single condition - return directly
  if (conditions.length === 1) {
    const single = conditions[0];
    // If it's already a WhereClause (has and/or), return it
    if ("and" in single || "or" in single) {
      return single;
    }
    // Otherwise wrap in AND
    return { and: [single] };
  }

  // Multiple conditions - combine with AND
  return { and: conditions };
}

/** The clauses a node's `and` and `or` lists contribute. */
function logicalClauses(
  payload: WhereFilter,
  path: string,
  geo: FilterProblem[]
): WhereClause[] {
  const clauses: WhereClause[] = [];

  // AND conditions. A member with no condition is true, and leaving a true
  // member out of a conjunction does not change it.
  if (Array.isArray(payload.and)) {
    const andConditions = payload.and
      .map((cond, i) => buildClause(cond, `${path}.and.${i}`, geo))
      .filter((c): c is WhereClause => c !== undefined);
    if (andConditions.length > 0) clauses.push({ and: andConditions });
  }

  // OR conditions. A member with no condition is true, which makes the whole
  // disjunction true; dropping only that member would make the `or` NARROWER
  // than written. An `or` with no members at all is false, and is kept as an
  // empty list for the builder to render.
  if (Array.isArray(payload.or)) {
    // A member with no condition is kept as an empty conjunction rather than
    // folding the `or` away here: the condition builder still has to resolve
    // every other member's fields, and it treats the empty one as true.
    clauses.push({
      or: payload.or.map(
        (cond, i) => buildClause(cond, `${path}.or.${i}`, geo) ?? { and: [] }
      ),
    });
  }
  return clauses;
}

/** The conditions one field's value contributes. */
function fieldConditions(
  field: string,
  value: unknown,
  path: string,
  geo: FilterProblem[]
): WhereCondition[] {
  // Simple equality (shorthand: { field: value })
  if (!isPlainObject(value)) {
    return [
      { column: field, op: "=", value: value as WhereCondition["value"] },
    ];
  }
  const conditions: WhereCondition[] = [];
  for (const [operator, operatorValue] of Object.entries(value)) {
    if (GEO_OPERATORS.has(operator)) {
      geo.push({
        path: `${path}.${operator}`,
        code: "FILTER_GEO_NOT_HERE",
        message: `"${operator}" can only filter a list of entries, which applies it to the rows it reads. It cannot narrow a count or a grouping.`,
      });
    } else {
      // An empty `not_in` is kept rather than dropped, although it excludes
      // nothing: the condition builder still has to resolve its field, or a
      // misspelt one would pass as an unfiltered read. It renders as true.
      conditions.push(
        buildCondition(field, operator as QueryOperator, operatorValue)
      );
    }
  }
  return conditions;
}

/**
 * An empty `not_in` excludes nothing. A component condition with one is left
 * out, because the component builder has no "true" to render it as.
 */
function excludesNothing(operator: string, operand: unknown): boolean {
  return (
    operator === "not_in" && Array.isArray(operand) && operand.length === 0
  );
}

/**
 * Validate that a query operator is supported.
 *
 * @param operator - Operator string to validate
 * @returns True if the operator is valid
 */
export function isValidOperator(operator: string): operator is QueryOperator {
  // An own key, not `in`: `in` reaches Object.prototype, so `toString` or
  // `constructor` would pass here while the filter shape check refused them.
  return Object.prototype.hasOwnProperty.call(OPERATOR_MAP, operator);
}

/**
 * Get the list of supported query operators.
 *
 * @returns Array of supported operator names
 */
export function getSupportedOperators(): QueryOperator[] {
  return Object.keys(OPERATOR_MAP) as QueryOperator[];
}

// ============================================================================
// Geo Filter Extraction
// ============================================================================

/**
 * Result of extracting geo filters from a where clause.
 */
export interface ExtractGeoFiltersResult {
  /** Geo filters to apply after database query */
  geoFilters: GeoFilter[];
  /** Where clause with geo operators removed (for database query) */
  cleanedWhere: WhereFilter | undefined;
}

/**
 * Extract geo filters from a where clause.
 *
 * Geo operators (`near`, `within`) cannot be translated to SQL and must
 * be applied in the application layer after fetching data. This function
 * separates geo filters from the main where clause.
 *
 * @param where - Original where clause that may contain geo operators
 * @returns Object with geo filters and cleaned where clause
 *
 * @example
 * ```typescript
 * const where = {
 *   status: { equals: 'published' },
 *   location: { near: '-74.006,40.7128,10000' },
 * };
 *
 * const { geoFilters, cleanedWhere } = extractGeoFilters(where);
 *
 * // geoFilters: [{ field: 'location', operator: 'near', value: { point: {...}, maxDistance: 10000 } }]
 * // cleanedWhere: { status: { equals: 'published' } }
 * ```
 */
export function extractGeoFilters(
  where: WhereFilter | undefined
): ExtractGeoFiltersResult {
  if (!where) {
    return { geoFilters: [], cleanedWhere: undefined };
  }
  // Judged whole first, so nothing below has to decide what to do with a
  // member it does not understand: extraction used to drop such a member, and
  // the builder downstream never got to refuse it.
  const filter = snapshotFilter(where);
  assertWellFormedFilter(filter, { allowTranslated: true });

  const out = {
    geoFilters: [] as GeoFilter[],
    misplaced: [] as FilterProblem[],
  };
  const cleanedWhere = rebuildFilter(filter, ROOT_SITE, (field, value, site) =>
    liftGeo(field, value, site, out)
  );
  refuseFilterProblems(out.misplaced);
  return { geoFilters: out.geoFilters, cleanedWhere };
}

/** One field condition's value, as a filter object holds it. */
type FieldValue = WhereFilter[string];

/** Where a field condition sits: its path, and whether an `or` encloses it. */
interface FieldSite {
  path: string;
  underOr: boolean;
}

const ROOT_SITE: FieldSite = { path: "where", underOr: false };

/**
 * A well-formed filter rebuilt with `keep` deciding what remains of each field
 * condition — the value to keep, or `undefined` once it has been lifted out.
 *
 * The one walk both extractors share. Every `and`/`or` list and member is kept
 * as written, emptied or not: an empty `or` is false and a member left with no
 * condition is true, and dropping either would change what the filter
 * matches.
 */
function rebuildFilter(
  where: WhereFilter,
  site: FieldSite,
  keep: (field: string, value: FieldValue, site: FieldSite) => FieldValue
): WhereFilter | undefined {
  const cleaned: WhereFilter = {};
  for (const [field, value] of Object.entries(where)) {
    if ((field === "and" || field === "or") && Array.isArray(value)) {
      cleaned[field] = value.map(
        (member: WhereFilter, i: number) =>
          rebuildFilter(
            member,
            {
              path: `${site.path}.${field}.${i}`,
              underOr: site.underOr || field === "or",
            },
            keep
          ) ?? {}
      );
      continue;
    }
    const kept = keep(field, value, {
      path: `${site.path}.${field}`,
      underOr: site.underOr,
    });
    if (kept !== undefined) {
      // Defined as an own key, not assigned: assigning `__proto__` sets the
      // prototype and the condition disappears. The shape check refuses that
      // name first; this keeps the walk from ever losing a key.
      Object.defineProperty(cleaned, field, {
        value: kept,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/**
 * What remains of one field condition once its geo operators are lifted out.
 *
 * Geo operators are applied in memory as one more condition every row must
 * meet, so one written under an `or` would narrow the read instead of offering
 * an alternative, and is refused.
 */
function liftGeo(
  field: string,
  value: FieldValue,
  site: FieldSite,
  out: { geoFilters: GeoFilter[]; misplaced: FilterProblem[] }
): FieldValue {
  if (!isPlainObject(value)) return value;
  const nonGeoOps: Record<string, unknown> = {};
  for (const [operator, operatorValue] of Object.entries(value)) {
    if (!GEO_OPERATORS.has(operator)) {
      nonGeoOps[operator] = operatorValue;
    } else if (site.underOr) {
      out.misplaced.push({
        path: `${site.path}.${operator}`,
        code: "FILTER_NOT_IN_OR",
        message: `"${operator}" cannot be used inside "or": it is applied to every row read, so it would narrow the read instead of offering an alternative. Move it to the top level, or into "and".`,
      });
    } else {
      // Well formed, so the operand parses: the shape check used these same
      // parsers to judge it.
      const parsed =
        operator === "near"
          ? parseNearQuery(operatorValue as string)
          : parseWithinQuery(operatorValue as string);
      if (parsed) {
        out.geoFilters.push({
          field,
          operator: operator as GeoQueryOperator,
          value: parsed,
        });
      }
    }
  }
  return Object.keys(nonGeoOps).length > 0 ? nonGeoOps : undefined;
}

// ============================================================================
// Component Field Filter Extraction
// ============================================================================

/**
 * Component field filter extracted from where clause.
 *
 * Represents a condition on a component field that requires
 * an EXISTS subquery against the component data table.
 */
export interface ComponentFieldFilter {
  /** Name of the component field on the parent entity */
  fieldName: string;

  /** Component slug(s) — single component or array for dynamic zone */
  componentSlugs: string[];

  /** Field path within the component (e.g., 'metaTitle' from 'seo.metaTitle') */
  componentFieldPath: string;

  /** Operator to apply */
  operator: QueryOperator;

  /** Value for the condition */
  value: unknown;

  /** Whether this is a _componentType filter (for dynamic zones) */
  isComponentTypeFilter?: boolean;
}

/**
 * Result of extracting component field filters from a where clause.
 */
export interface ExtractComponentFiltersResult {
  /** Component filters to apply via EXISTS subqueries */
  componentFilters: ComponentFieldFilter[];

  /** Where clause with component field conditions removed (for main table query) */
  cleanedWhere: WhereFilter | undefined;
}

/**
 * Field definition interface for component field detection.
 * Matches the structure from collections/fields/types.
 */
interface ComponentFieldDefinition {
  name: string;
  type: string;
  component?: string;
  fieldGroup?: string;
  components?: string[];
  fieldGroups?: string[];
}

/**
 * Check if a field definition is a component field.
 */
function isComponentFieldDef(field: {
  name: string;
  type: string;
}): field is ComponentFieldDefinition {
  return isFieldGroupFieldType(field.type);
}

/**
 * Build a map of field names to component field definitions.
 */
function buildComponentFieldMap(
  // The shared definition names all four reference keys. A narrower inline
  // shape here rejects a caller's migrated object literal at the excess-
  // property check, before extraction can read its references at all.
  fields: ComponentFieldDefinition[]
): Map<string, ComponentFieldDefinition> {
  const map = new Map<string, ComponentFieldDefinition>();

  for (const field of fields) {
    if (isComponentFieldDef(field)) {
      map.set(field.name, field);
    }
  }

  return map;
}

/**
 * The component tables a field's values live in: one for a single component,
 * one per allowed component for a dynamic zone.
 *
 * Read through the shared reader so a definition referencing its field group
 * through either key spelling resolves to the same tables.
 */
function componentSlugsOf(field: ComponentFieldDefinition): string[] {
  const { single, many } = extractFieldGroupReferences(field);
  return single ? [single] : (many ?? []);
}

/**
 * A filter key that addresses a column of a component table rather than of
 * the entity's own.
 */
export interface ComponentFilterTarget {
  /** The key as the caller wrote it, e.g. `seo.metaTitle`. */
  key: string;
  /** Every component the key's field can hold, so every table it can reach. */
  componentSlugs: string[];
  /** The path within the component, e.g. `metaTitle`. */
  componentFieldPath: string;
}

/**
 * Which of these filter keys reach a component table, and which column path
 * they name there.
 *
 * Decided by the same field map and slug reader as
 * {@link extractComponentFieldConditions}, so a key judged here is exactly a
 * key that extraction turns into a component predicate. Takes keys rather
 * than a filter, and ignores operators, so a caller can judge every key a
 * filter names, at any depth, whatever it is compared with.
 */
export function componentFilterTargets(
  keys: Iterable<string>,
  fields: ComponentFieldDefinition[]
): ComponentFilterTarget[] {
  const componentFieldMap = buildComponentFieldMap(fields);
  const targets: ComponentFilterTarget[] = [];
  for (const key of keys) {
    const dotIndex = key.indexOf(".");
    if (dotIndex <= 0) continue;
    const field = componentFieldMap.get(key.slice(0, dotIndex));
    if (!field) continue;
    targets.push({
      key,
      componentSlugs: componentSlugsOf(field),
      componentFieldPath: key.slice(dotIndex + 1),
    });
  }
  return targets;
}

/**
 * Extract component field conditions from a where clause.
 *
 * Component field conditions use dot notation (e.g., `seo.metaTitle`) and
 * cannot be translated to simple SQL WHERE clauses. They require EXISTS
 * subqueries against the component data tables.
 *
 * This function separates component field filters from the main where clause,
 * similar to how `extractGeoFilters` handles geo operators.
 *
 * @param where - Original where clause that may contain component field conditions
 * @param fields - Field definitions from the collection/single schema
 * @returns Object with component filters and cleaned where clause
 *
 * @example
 * ```typescript
 * const fields = [
 *   { name: 'title', type: 'text' },
 *   { name: 'seo', type: 'component', component: 'seo' },
 *   { name: 'layout', type: 'component', components: ['hero', 'cta'], repeatable: true },
 * ];
 *
 * const where = {
 *   title: { contains: 'Hello' },
 *   'seo.metaTitle': { contains: 'About' },
 *   'layout._componentType': { equals: 'hero' },
 * };
 *
 * const { componentFilters, cleanedWhere } = extractComponentFieldConditions(where, fields);
 *
 * // componentFilters: [
 * //   { fieldName: 'seo', componentSlugs: ['seo'], componentFieldPath: 'metaTitle', operator: 'contains', value: 'About' },
 * //   { fieldName: 'layout', componentSlugs: ['hero', 'cta'], componentFieldPath: '_componentType', operator: 'equals', value: 'hero', isComponentTypeFilter: true },
 * // ]
 * // cleanedWhere: { title: { contains: 'Hello' } }
 * ```
 *
 * The discriminator path is matched under every spelling the key has carried, so a filter written
 * against an older release keeps selecting on the type after the storage rename rather than
 * quietly degrading into a lookup for a column of that name. The example shows one spelling; it is
 * not the only accepted one.
 */
export function extractComponentFieldConditions(
  where: WhereFilter | undefined,
  // Same shared definition: a migrated `{ type: "fieldGroup", fieldGroup }`
  // literal must type-check against the input, not be rejected as excess.
  fields: ComponentFieldDefinition[]
): ExtractComponentFiltersResult {
  if (!where) {
    return { componentFilters: [], cleanedWhere: undefined };
  }
  // Judged whole first, for the reason `extractGeoFilters` is: a component
  // condition with an unknown operator, or a value with none, used to be
  // dropped here without the builder ever seeing it.
  const filter = snapshotFilter(where);
  assertWellFormedFilter(filter, { allowTranslated: true });

  const out = {
    componentFieldMap: buildComponentFieldMap(fields),
    componentFilters: [] as ComponentFieldFilter[],
    misplaced: [] as FilterProblem[],
  };
  const cleanedWhere = rebuildFilter(filter, ROOT_SITE, (field, value, site) =>
    liftComponent(field, value, site, out)
  );
  refuseFilterProblems(out.misplaced);
  return { componentFilters: out.componentFilters, cleanedWhere };
}

/**
 * One field condition, kept unless it addresses a component table, in which
 * case it is lifted out as component filters.
 *
 * Component conditions become EXISTS subqueries that every entry must
 * satisfy, so one written under an `or` would turn the alternative into a
 * requirement, and is refused.
 */
function liftComponent(
  field: string,
  value: FieldValue,
  site: FieldSite,
  out: {
    componentFieldMap: Map<string, ComponentFieldDefinition>;
    componentFilters: ComponentFieldFilter[];
    misplaced: FilterProblem[];
  }
): FieldValue {
  // Dot notation whose head is a component field addresses that component's
  // table; anything else stays in the filter for the main table.
  const dotIndex = field.indexOf(".");
  const componentField =
    dotIndex > 0
      ? out.componentFieldMap.get(field.slice(0, dotIndex))
      : undefined;
  if (!componentField) return value;

  if (site.underOr) {
    out.misplaced.push({
      path: site.path,
      code: "FILTER_NOT_IN_OR",
      message: `"${field}" is a component field, which cannot be filtered inside "or": its condition must hold for every entry. Move it to the top level, or into "and".`,
    });
    return undefined;
  }

  const componentFieldPath = field.slice(dotIndex + 1);
  const target = {
    fieldName: field.slice(0, dotIndex),
    componentSlugs: componentSlugsOf(componentField),
    componentFieldPath,
    // The path comes from the caller's own query, so it may name any spelling
    // the key has ever carried. Matching a single one turns an existing filter
    // into an ordinary field lookup against a column that does not exist,
    // which answers with the wrong rows rather than an error.
    isComponentTypeFilter: isFieldGroupTypeKey(componentFieldPath),
  };
  // A well-formed value is an object of known operators or, as shorthand, a
  // value meaning `equals`.
  const operators: Array<[string, unknown]> = isPlainObject(value)
    ? Object.entries(value)
    : [["equals", value]];
  for (const [operator, operatorValue] of operators) {
    if (GEO_OPERATORS.has(operator)) {
      out.misplaced.push({
        path: `${site.path}.${operator}`,
        code: "FILTER_GEO_NOT_HERE",
        message: `"${operator}" cannot filter a field inside a component.`,
      });
    } else if (!excludesNothing(operator, operatorValue)) {
      out.componentFilters.push({
        ...target,
        operator: operator as QueryOperator,
        value: operatorValue,
      });
    }
  }
  return undefined;
}
