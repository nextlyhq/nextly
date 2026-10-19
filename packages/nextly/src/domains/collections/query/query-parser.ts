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
 * Default caps for the REST query parser.
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
  if (raw === null || raw === undefined || raw === "")
    return defaults.defaultLimit;
  const parsed = typeof raw === "number" ? raw : parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaults.defaultLimit;
  return Math.min(parsed, max);
}

/**
 * Parse one scalar from a query string: a boolean, `null`, a number, or text.
 *
 * @param value - String value from query parameter
 * @returns Parsed value with appropriate type
 */
function parseScalar(value: string): unknown {
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

  // Return as string
  return value;
}

/**
 * Parse a query-string value for the operator it is given to.
 *
 * Only a membership operator reads commas as a list separator, and it always
 * gets a list, since a query string has no other way to write a list of one.
 * Every other operator gets the value whole: splitting turned `equals=Hello,
 * world` into a list the column was then compared with, and a `near` point
 * into numbers the geo filter could not read. Geo operands stay text, which is
 * the form their parser takes.
 *
 * @param value - String value from query parameter
 * @param operator - The last segment of the bracket path
 */
function parseValue(value: string, operator: string | undefined): unknown {
  if (operator === "in" || operator === "not_in") {
    return value.split(",").map(v => parseScalar(v.trim()));
  }
  if (operator === "near" || operator === "within") return value;
  return parseScalar(value);
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

    // An own key only: an inherited one (`__proto__` above all) would hand
    // back a shared prototype to write into. parseBracketPath refuses those
    // names; this keeps the walk from ever reaching one.
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      current[key] = isNextArray ? [] : {};
    } else if (typeof current[key] !== "object" || current[key] === null) {
      // Another parameter already gave this segment a value, so nothing can
      // nest under it; assigning onto that value would throw.
      refuseKey(bracketKey(path), "It nests under a value already given.");
    } else if (Array.isArray(current[key]) !== isNextArray) {
      // A named key set on a list is ignored by everything that reads the
      // list, and an index under an object is no list member, so either way
      // the condition under it would vanish.
      refuseKey(
        bracketKey(path),
        "It mixes list indexes and named keys at one level."
      );
    }

    current = current[key] as Record<string, unknown>;
  }

  // Set the final value
  const lastKey = path[path.length - 1];
  // The same condition given twice is refused rather than overwritten, so the
  // filter that runs is never one part of what the caller sent.
  if (Object.prototype.hasOwnProperty.call(current, lastKey)) {
    refuseKey(bracketKey(path), "It is given more than once.");
  }
  current[lastKey] = value;
}

/** A bracket path written back as the parameter name it came from. */
function bracketKey(path: string[]): string {
  return `where[${path.join("][")}]`;
}

/**
 * Parse bracket notation path from query parameter key.
 *
 * Converts `where[field][operator]` to `['field', 'operator']`. A key that
 * starts `where[` but is not a run of bracketed segments is refused: it was
 * once read into a field name that matched no column, and that member of the
 * filter was then dropped.
 *
 * @param key - Query parameter key (e.g., 'where[status][equals]')
 * @returns Array of path segments, or null if not a where parameter
 */
function parseBracketPath(key: string): string[] | null {
  if (!key.startsWith("where[")) {
    return null;
  }
  if (!/^where(\[[^[\]]+\])+$/.test(key)) {
    refuseKey(
      key,
      "Write each segment in brackets, as where[field][operator]=value."
    );
  }
  const segments = [...key.matchAll(/\[([^[\]]+)\]/g)].map(match => match[1]);
  for (const segment of segments) {
    // `__proto__` would make the object being built write onto a prototype
    // every other object shares. Other names are walked as own keys.
    if (segment === "__proto__") {
      refuseKey(key, `"${segment}" cannot be a filter segment.`);
    }
    // An index written with leading zeros is not an array index: it would be
    // set as a property the list's length ignores, and its member dropped.
    if (/^\d+$/.test(segment) && !/^(0|[1-9]\d*)$/.test(segment)) {
      refuseKey(
        key,
        `A list index is written as a plain integer, not "${segment}".`
      );
    }
    // Refused before any list is built: an index makes a list that long, and
    // a filter cannot have more members than it may have conditions.
    if (/^\d+$/.test(segment) && Number(segment) >= MAX_QUERY_CONDITIONS) {
      refuseKey(
        key,
        `A list index must be below ${MAX_QUERY_CONDITIONS}, the most conditions a filter may have.`
      );
    }
  }
  return segments;
}

/** Refuse a bracket filter parameter, saying what is wrong with it. */
function refuseKey(key: string, why: string): never {
  throw NextlyError.validation({
    errors: [
      {
        path: "where",
        code: "FILTER_INVALID_KEY",
        message: `"${key}" is not a filter parameter. ${why}`,
      },
    ],
  });
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

    // Parse the value for the operator it is given to
    const parsedValue = parseValue(value, path[path.length - 1]);

    // Set the nested value in where object
    setNestedValue(where, path, parsedValue);
    hasConditions = true;
  }

  const result = hasConditions ? where : undefined;
  // Refuse to return a parsed filter that exceeds the depth or
  // condition cap. The validator throws so the caller's error handler
  // turns it into a 422.
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
        const primitiveValue: string | number | boolean | bigint = value as
          | string
          | number
          | boolean
          | bigint;
        params.append(newPrefix, String(primitiveValue));
      }
    }
  }

  addParams(where, "");
  return params;
}
