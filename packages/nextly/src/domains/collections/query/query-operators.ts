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
} from "@revnixhq/adapter-drizzle/types";

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
  contains: "ILIKE",
  search: "ILIKE", // Alias for contains - case-insensitive search
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
 * Check if a value is a FieldCondition (has operator keys).
 */
function isFieldCondition(value: unknown): value is FieldCondition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  // Check for standard operators OR geo operators
  return keys.some(key => key in OPERATOR_MAP || GEO_OPERATORS.has(key));
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

  // Special handling for 'like', 'contains', and 'search' - wrap with wildcards
  // 'search' is an alias for 'contains' (case-insensitive ILIKE)
  if (operator === "like" || operator === "contains" || operator === "search") {
    const searchValue =
      typeof value === "string" ? `%${value}%` : String(value);
    return {
      column: field,
      op: OPERATOR_MAP[operator],
      value: searchValue,
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
  const conditions: (WhereCondition | WhereClause)[] = [];

  // Handle AND conditions
  if (payload.and && Array.isArray(payload.and)) {
    const andConditions = payload.and
      .map(cond => buildWhereClause(cond))
      .filter((c): c is WhereClause => c !== undefined);

    if (andConditions.length > 0) {
      conditions.push({ and: andConditions });
    }
  }

  // Handle OR conditions
  if (payload.or && Array.isArray(payload.or)) {
    const orConditions = payload.or
      .map(cond => buildWhereClause(cond))
      .filter((c): c is WhereClause => c !== undefined);

    if (orConditions.length > 0) {
      conditions.push({ or: orConditions });
    }
  }

  // Handle field conditions
  for (const [field, value] of Object.entries(payload)) {
    // Skip logical operators
    if (field === "and" || field === "or") continue;

    // Skip undefined/null values
    if (value === undefined || value === null) continue;

    // Check if it's a field condition with operators
    if (isFieldCondition(value)) {
      for (const [operator, operatorValue] of Object.entries(value)) {
        if (operator in OPERATOR_MAP && operatorValue !== undefined) {
          conditions.push(
            buildCondition(field, operator as QueryOperator, operatorValue)
          );
        }
      }
    }
    // Handle simple equality (shorthand: { field: value })
    else if (typeof value !== "object") {
      conditions.push({
        column: field,
        op: "=",
        value: value as WhereCondition["value"],
      });
    }
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
      return single as WhereClause;
    }
    // Otherwise wrap in AND
    return { and: [single] };
  }

  // Multiple conditions - combine with AND
  return { and: conditions };
}

/**
 * Validate that a query operator is supported.
 *
 * @param operator - Operator string to validate
 * @returns True if the operator is valid
 */
export function isValidOperator(operator: string): operator is QueryOperator {
  return operator in OPERATOR_MAP;
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

  const geoFilters: GeoFilter[] = [];
  const cleanedWhere: WhereFilter = {};
  let hasNonGeoConditions = false;

  // Process AND conditions
  if (where.and && Array.isArray(where.and)) {
    const cleanedAnd: WhereFilter[] = [];

    for (const condition of where.and) {
      const { geoFilters: nestedGeo, cleanedWhere: nestedClean } =
        extractGeoFilters(condition);
      geoFilters.push(...nestedGeo);
      if (nestedClean && Object.keys(nestedClean).length > 0) {
        cleanedAnd.push(nestedClean);
      }
    }

    if (cleanedAnd.length > 0) {
      cleanedWhere.and = cleanedAnd;
      hasNonGeoConditions = true;
    }
  }

  // Process OR conditions
  if (where.or && Array.isArray(where.or)) {
    const cleanedOr: WhereFilter[] = [];

    for (const condition of where.or) {
      const { geoFilters: nestedGeo, cleanedWhere: nestedClean } =
        extractGeoFilters(condition);
      geoFilters.push(...nestedGeo);
      if (nestedClean && Object.keys(nestedClean).length > 0) {
        cleanedOr.push(nestedClean);
      }
    }

    if (cleanedOr.length > 0) {
      cleanedWhere.or = cleanedOr;
      hasNonGeoConditions = true;
    }
  }

  // Process field conditions
  for (const [field, value] of Object.entries(where)) {
    // Skip logical operators (already handled)
    if (field === "and" || field === "or") continue;

    // Skip undefined/null values
    if (value === undefined || value === null) continue;

    // Check if it's a field condition with operators
    if (isFieldCondition(value)) {
      const geoOps: Record<string, unknown> = {};
      const nonGeoOps: Record<string, unknown> = {};

      // Separate geo and non-geo operators
      for (const [operator, operatorValue] of Object.entries(value)) {
        if (GEO_OPERATORS.has(operator)) {
          geoOps[operator] = operatorValue;
        } else {
          nonGeoOps[operator] = operatorValue;
        }
      }

      // Process geo operators
      for (const [operator, operatorValue] of Object.entries(geoOps)) {
        if (operator === "near" && typeof operatorValue === "string") {
          const parsed = parseNearQuery(operatorValue);
          if (parsed) {
            geoFilters.push({
              field,
              operator: "near",
              value: parsed,
            });
          }
        } else if (operator === "within" && typeof operatorValue === "string") {
          const parsed = parseWithinQuery(operatorValue);
          if (parsed) {
            geoFilters.push({
              field,
              operator: "within",
              value: parsed,
            });
          }
        }
      }

      // Keep non-geo operators in cleaned where
      if (Object.keys(nonGeoOps).length > 0) {
        cleanedWhere[field] = nonGeoOps;
        hasNonGeoConditions = true;
      }
    }
    // Handle simple equality (no geo operators possible)
    else if (typeof value !== "object") {
      cleanedWhere[field] = value;
      hasNonGeoConditions = true;
    }
  }

  return {
    geoFilters,
    cleanedWhere: hasNonGeoConditions ? cleanedWhere : undefined,
  };
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
  type: "component";
  component?: string;
  components?: string[];
}

/**
 * Check if a field definition is a component field.
 */
function isComponentFieldDef(field: {
  name: string;
  type: string;
}): field is ComponentFieldDefinition {
  return field.type === "component";
}

/**
 * Build a map of field names to component field definitions.
 */
function buildComponentFieldMap(
  fields: Array<{
    name: string;
    type: string;
    component?: string;
    components?: string[];
  }>
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
 */
export function extractComponentFieldConditions(
  where: WhereFilter | undefined,
  fields: Array<{
    name: string;
    type: string;
    component?: string;
    components?: string[];
  }>
): ExtractComponentFiltersResult {
  if (!where) {
    return { componentFilters: [], cleanedWhere: undefined };
  }

  const componentFieldMap = buildComponentFieldMap(fields);
  const componentFilters: ComponentFieldFilter[] = [];
  const cleanedWhere: WhereFilter = {};
  let hasNonComponentConditions = false;

  // Process AND conditions recursively
  if (where.and && Array.isArray(where.and)) {
    const cleanedAnd: WhereFilter[] = [];

    for (const condition of where.and) {
      const { componentFilters: nestedFilters, cleanedWhere: nestedClean } =
        extractComponentFieldConditions(condition, fields);
      componentFilters.push(...nestedFilters);
      if (nestedClean && Object.keys(nestedClean).length > 0) {
        cleanedAnd.push(nestedClean);
      }
    }

    if (cleanedAnd.length > 0) {
      cleanedWhere.and = cleanedAnd;
      hasNonComponentConditions = true;
    }
  }

  // Process OR conditions recursively
  if (where.or && Array.isArray(where.or)) {
    const cleanedOr: WhereFilter[] = [];

    for (const condition of where.or) {
      const { componentFilters: nestedFilters, cleanedWhere: nestedClean } =
        extractComponentFieldConditions(condition, fields);
      componentFilters.push(...nestedFilters);
      if (nestedClean && Object.keys(nestedClean).length > 0) {
        cleanedOr.push(nestedClean);
      }
    }

    if (cleanedOr.length > 0) {
      cleanedWhere.or = cleanedOr;
      hasNonComponentConditions = true;
    }
  }

  // Process field conditions
  for (const [field, value] of Object.entries(where)) {
    // Skip logical operators (already handled)
    if (field === "and" || field === "or") continue;

    // Skip undefined/null values
    if (value === undefined || value === null) continue;

    // Check for dot notation (component field access)
    const dotIndex = field.indexOf(".");
    if (dotIndex > 0) {
      const fieldName = field.slice(0, dotIndex);
      const componentFieldPath = field.slice(dotIndex + 1);

      // Check if the top-level field is a component field
      const componentField = componentFieldMap.get(fieldName);

      if (componentField) {
        // This is a component field condition — extract it
        const componentSlugs = componentField.component
          ? [componentField.component]
          : componentField.components || [];

        // Check if it's a field condition with operators
        if (isFieldCondition(value)) {
          for (const [operator, operatorValue] of Object.entries(value)) {
            if (operator in OPERATOR_MAP && operatorValue !== undefined) {
              componentFilters.push({
                fieldName,
                componentSlugs,
                componentFieldPath,
                operator: operator as QueryOperator,
                value: operatorValue,
                isComponentTypeFilter: componentFieldPath === "_componentType",
              });
            }
          }
        }
        // Handle simple equality shorthand
        else if (typeof value !== "object") {
          componentFilters.push({
            fieldName,
            componentSlugs,
            componentFieldPath,
            operator: "equals",
            value,
            isComponentTypeFilter: componentFieldPath === "_componentType",
          });
        }

        // Don't add to cleanedWhere — this condition is handled separately
        continue;
      }
    }

    // Not a component field condition — keep in cleanedWhere
    cleanedWhere[field] = value;
    hasNonComponentConditions = true;
  }

  return {
    componentFilters,
    cleanedWhere: hasNonComponentConditions ? cleanedWhere : undefined,
  };
}
