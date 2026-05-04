/**
 * Nextly query string parser.
 *
 * Parses URL query parameters to internal WhereFilter.
 * Supports the full Nextly query syntax including nested conditions.
 *
 * @example
 * ```typescript
 * import { parseWhereQuery } from './query-parser';
 *
 * // Parse URL search params
 * const url = new URL('https://example.com/api/posts?where[status][equals]=published');
 * const where = parseWhereQuery(url.searchParams);
 * // Result: { status: { equals: 'published' } }
 *
 * // Complex query
 * const complexUrl = new URL('https://example.com/api/posts?where[or][0][color][equals]=red&where[or][1][color][equals]=blue');
 * const complexWhere = parseWhereQuery(complexUrl.searchParams);
 * // Result: { or: [{ color: { equals: 'red' } }, { color: { equals: 'blue' } }] }
 * ```
 *
 * @packageDocumentation
 */

import { NextlyError } from "../../../errors/nextly-error";

import type { WhereFilter } from "./query-operators";

/**
 *  default caps for the REST query parser.
 *
 *   - `MAX_QUERY_DEPTH`      — deepest `and` / `or` nesting accepted.
 *   - `MAX_QUERY_CONDITIONS` — total leaf conditions (a single
 *     `field: { op: value }` pair is one condition).
 *   - `MAX_QUERY_LIMIT`      — server-side ceiling on `?limit=` so a
 *     client can't yank an entire collection in one round-trip.
 *
 * The functions below accept opts so a future operator-supplied
 * `security.queryLimits` config can override; for now the defaults
 * are hardcoded and the validators throw `NextlyError.validation`
 * when exceeded.
 */
export const MAX_QUERY_DEPTH = 5;
export const MAX_QUERY_CONDITIONS = 50;
export const MAX_QUERY_LIMIT = 200;

export interface QueryLimitOpts {
  maxDepth?: number;
  maxConditions?: number;
}

/**
 * Walk a parsed `WhereFilter` and reject queries that exceed the
 * configured caps. Counts every `and`/`or` array as one nesting level
 * and every `field: { op: value }` as one condition. Throws
 * `NextlyError.validation` so the route layer surfaces a 422 with the
 * cap violation reason.
 */
export function validateWhereFilter(
  filter: WhereFilter | undefined,
  opts: QueryLimitOpts = {}
): void {
  if (!filter) return;
  const maxDepth = opts.maxDepth ?? MAX_QUERY_DEPTH;
  const maxConditions = opts.maxConditions ?? MAX_QUERY_CONDITIONS;

  let conditionCount = 0;

  function walk(node: unknown, depth: number): void {
    if (node === null || typeof node !== "object") return;
    if (depth > maxDepth) {
      throw NextlyError.validation({
        errors: [
          {
            path: "where",
            code: "TOO_DEEP",
            message: `Query nesting depth exceeds the limit of ${maxDepth}.`,
          },
        ],
      });
    }

    for (const [key, value] of Object.entries(node)) {
      if ((key === "and" || key === "or") && Array.isArray(value)) {
        for (const child of value) walk(child, depth + 1);
        continue;
      }
      // Anything else is a leaf field condition like
      // `status: { equals: "published" }`. Count it once per field.
      conditionCount++;
      if (conditionCount > maxConditions) {
        throw NextlyError.validation({
          errors: [
            {
              path: "where",
              code: "TOO_MANY_CONDITIONS",
              message: `Query has more than ${maxConditions} conditions.`,
            },
          ],
        });
      }
    }
  }

  walk(filter, 1);
}

/**
 * Resolve a raw `limit` query parameter to a
 * server-side-clamped integer. Falls back to the supplied default
 * when missing / NaN; clamps the upper bound so a client cannot
 * request more than `max` rows in one call.
 */
export function clampLimit(
  raw: string | number | null | undefined,
  defaults: { defaultLimit: number; max?: number }
): number {
  const max = defaults.max ?? MAX_QUERY_LIMIT;
  if (raw === null || raw === undefined || raw === "") return defaults.defaultLimit;
  const parsed = typeof raw === "number" ? raw : parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaults.defaultLimit;
  return Math.min(parsed, max);
}

/**
 * Parse a single value from query string.
 *
 * Handles type coercion for booleans, numbers, and arrays.
 *
 * @param value - String value from query parameter
 * @returns Parsed value with appropriate type
 */
function parseValue(value: string): unknown {
  // Boolean coercion
  if (value === "true") return true;
  if (value === "false") return false;

  // Null coercion
  if (value === "null") return null;

  // Number coercion (only if it looks like a number)
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    if (!isNaN(num)) return num;
  }

  // Array coercion (comma-separated values)
  if (value.includes(",")) {
    return value.split(",").map(v => parseValue(v.trim()));
  }

  // Return as string
  return value;
}

/**
 * Set a nested value in an object using path array.
 *
 * Creates intermediate objects/arrays as needed.
 *
 * @param obj - Target object to modify
 * @param path - Array of keys representing the path
 * @param value - Value to set at the path
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  let current = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextKey = path[i + 1];

    // Determine if next level should be array or object
    const isNextArray = /^\d+$/.test(nextKey);

    if (current[key] === undefined) {
      current[key] = isNextArray ? [] : {};
    }

    current = current[key] as Record<string, unknown>;
  }

  // Set the final value
  const lastKey = path[path.length - 1];
  current[lastKey] = value;
}

/**
 * Parse bracket notation path from query parameter key.
 *
 * Converts `where[field][operator]` to `['field', 'operator']`
 *
 * @param key - Query parameter key (e.g., 'where[status][equals]')
 * @returns Array of path segments, or null if not a where parameter
 */
function parseBracketPath(key: string): string[] | null {
  // Must start with 'where['
  if (!key.startsWith("where[")) {
    return null;
  }

  // Remove 'where[' prefix and trailing ']'
  const pathStr = key.slice(6); // Remove 'where['

  // Split by '][' to get path segments
  const segments: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < pathStr.length; i++) {
    const char = pathStr[i];

    if (char === "[") {
      if (depth === 0 && current) {
        // Remove trailing ']' from current segment
        segments.push(current.replace(/\]$/, ""));
        current = "";
      }
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) {
        if (current) {
          segments.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    } else {
      current += char;
    }
  }

  // Handle any remaining content
  if (current) {
    segments.push(current.replace(/\]$/, ""));
  }

  return segments.length > 0 ? segments : null;
}

/**
 * Parse Nextly query parameters from URLSearchParams.
 *
 * Supports the full Nextly query syntax:
 * - Simple: `?where[field][operator]=value`
 * - Nested: `?where[author.name][equals]=John`
 * - AND/OR: `?where[or][0][field][operator]=value`
 *
 * @param searchParams - URLSearchParams to parse
 * @returns Parsed WhereFilter, or undefined if no where params
 *
 * @example
 * ```typescript
 * // Simple equality
 * const params = new URLSearchParams('where[status][equals]=published');
 * parseWhereQuery(params);
 * // Result: { status: { equals: 'published' } }
 *
 * // Multiple conditions (AND)
 * const params2 = new URLSearchParams('where[status][equals]=published&where[featured][equals]=true');
 * parseWhereQuery(params2);
 * // Result: { status: { equals: 'published' }, featured: { equals: true } }
 *
 * // OR conditions
 * const params3 = new URLSearchParams('where[or][0][color][equals]=red&where[or][1][color][equals]=blue');
 * parseWhereQuery(params3);
 * // Result: { or: [{ color: { equals: 'red' } }, { color: { equals: 'blue' } }] }
 *
 * // Nested fields (dot notation)
 * const params4 = new URLSearchParams('where[author.name][equals]=John');
 * parseWhereQuery(params4);
 * // Result: { 'author.name': { equals: 'John' } }
 *
 * // Numeric comparisons
 * const params5 = new URLSearchParams('where[price][greater_than]=100');
 * parseWhereQuery(params5);
 * // Result: { price: { greater_than: 100 } }
 *
 * // Array membership
 * const params6 = new URLSearchParams('where[tags][in]=news,featured');
 * parseWhereQuery(params6);
 * // Result: { tags: { in: ['news', 'featured'] } }
 * ```
 */
export function parseWhereQuery(
  searchParams: URLSearchParams
): WhereFilter | undefined {
  const where: WhereFilter = {};
  let hasConditions = false;

  for (const [key, value] of searchParams.entries()) {
    const path = parseBracketPath(key);

    if (!path || path.length === 0) {
      continue;
    }

    // Parse the value
    const parsedValue = parseValue(value);

    // Set the nested value in where object
    setNestedValue(where, path, parsedValue);
    hasConditions = true;
  }

  const result = hasConditions ? where : undefined;
  // refuse to return a parsed filter that exceeds
  // the depth or condition cap. The validator throws so the caller's
  // error handler turns it into a 422.
  validateWhereFilter(result);
  return result;
}

/**
 * Parse where clause from request body or query string.
 *
 * Handles both URL query parameter format and JSON body format.
 *
 * @param source - URLSearchParams or parsed JSON object
 * @returns Parsed WhereFilter, or undefined if no where clause
 */
export function parseWhere(
  source: URLSearchParams | Record<string, unknown> | undefined
): WhereFilter | undefined {
  if (!source) {
    return undefined;
  }

  // URLSearchParams - parse query string format
  if (source instanceof URLSearchParams) {
    return parseWhereQuery(source);
  }

  // Object - check for 'where' key or treat as where clause directly
  if (typeof source === "object") {
    // If source has a 'where' property, use that
    if ("where" in source && typeof source.where === "object") {
      return source.where as WhereFilter;
    }

    // Otherwise treat the whole object as where clause
    // Validate it looks like a where clause (has field conditions or and/or)
    const keys = Object.keys(source);
    if (keys.length > 0) {
      return source as WhereFilter;
    }
  }

  return undefined;
}

/**
 * Stringify a WhereFilter back to URL query parameters.
 *
 * Useful for building URLs with query conditions.
 *
 * @param where - WhereFilter to stringify
 * @returns URLSearchParams with encoded where conditions
 *
 * @example
 * ```typescript
 * const where = { status: { equals: 'published' } };
 * const params = stringifyWhereQuery(where);
 * // Result: URLSearchParams with 'where[status][equals]=published'
 * ```
 */
export function stringifyWhereQuery(where: WhereFilter): URLSearchParams {
  const params = new URLSearchParams();

  function addParams(obj: Record<string, unknown>, prefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      const newPrefix = prefix ? `${prefix}[${key}]` : `where[${key}]`;

      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        // For arrays in and/or conditions
        if (key === "and" || key === "or") {
          value.forEach((item, index) => {
            addParams(item, `${newPrefix}[${index}]`);
          });
        } else {
          // For array values (like 'in' operator)
          params.append(newPrefix, value.join(","));
        }
      } else if (typeof value === "object") {
        addParams(value as Record<string, unknown>, newPrefix);
      } else {
        params.append(newPrefix, String(value));
      }
    }
  }

  addParams(where, "");
  return params;
}
