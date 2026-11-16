/**
 * What a read's `select` means, for every read that takes one.
 *
 * One meaning for a collection's entries and a Single's document: a field
 * named `true` is included, a `false` entry is ignored, and a selection with no
 * `true` entry (empty or all `false`) leaves the document whole. The id and the
 * system timestamps are always kept. Collections and Singles both shape their
 * answers here, so a selection cannot come to mean one thing on one read and
 * another on the other.
 *
 * @module shared/lib/field-selection
 */

import { SYSTEM_TIMESTAMP_KEYS } from "./case-conversion";

/** A read's field selection: field names (or dot paths) to `true` to include them. */
export type FieldSelection = Record<string, boolean>;

/**
 * The paths a selection includes, in the order it names them; empty when it
 * includes none, which leaves the document whole.
 */
export function selectedFieldPaths(
  select: FieldSelection | undefined
): string[] {
  if (!select) return [];
  return Object.entries(select)
    .filter(([, include]) => include)
    .map(([field]) => field);
}

/**
 * The top-level field names a selection includes: each path's first segment,
 * once each, so `author.name` includes `author`.
 */
export function selectedTopLevelFields(
  select: FieldSelection | undefined
): Set<string> {
  return new Set(selectedFieldPaths(select).map(path => path.split(".")[0]));
}

/**
 * Apply a field selection to one entry.
 *
 * Filters an entry object to only include fields specified in the select parameter.
 * The `id` field is always included regardless of selection.
 * Supports nested field selection using dot notation (e.g., "author.name").
 *
 * @param entry - The entry object to filter
 * @param select - Object with field names as keys and boolean values (true = include)
 * @returns Filtered entry with only selected fields
 *
 * @example
 * ```typescript
 * const entry = { id: '1', title: 'Hello', content: 'World', author: { id: '2', name: 'John' } };
 * const select = { title: true, 'author.name': true };
 * const result = applyFieldSelection(entry, select);
 * // Result: { id: '1', title: 'Hello', author: { id: '2', name: 'John' } }
 * ```
 */
export function applyFieldSelection(
  entry: Record<string, unknown>,
  select: FieldSelection
): Record<string, unknown> {
  const selectedFields = selectedFieldPaths(select);

  // If no fields selected, return entry as-is
  if (selectedFields.length === 0) {
    return entry;
  }

  // Build result with only selected fields
  const result: Record<string, unknown> = {};

  // Always include id
  if (entry.id !== undefined) {
    result.id = entry.id;
  }

  // Always include the system timestamps, for consistency across responses. Taken from the
  // shared list rather than named one by one: this ran BEFORE camelCase conversion and knew
  // only the original two, so a selected read dropped the first-publication marker even when
  // the caller asked for it by name.
  for (const key of SYSTEM_TIMESTAMP_KEYS) {
    if (entry[key] !== undefined) {
      result[key] = entry[key];
    }
  }

  for (const fieldPath of selectedFields) {
    if (fieldPath === "id") {
      // Already handled above
      continue;
    }

    if (fieldPath.includes(".")) {
      selectNestedPath(entry, result, fieldPath);
    } else if (entry[fieldPath] !== undefined) {
      // Simple field selection
      result[fieldPath] = entry[fieldPath];
    }
  }

  return result;
}

/** Copy one dot path (e.g. "author.name") from `entry` into `result`. */
function selectNestedPath(
  entry: Record<string, unknown>,
  result: Record<string, unknown>,
  fieldPath: string
): void {
  const [parentField, ...childParts] = fieldPath.split(".");
  const childPath = childParts.join(".");

  if (entry[parentField] === undefined || entry[parentField] === null) {
    return;
  }
  const parentValue = entry[parentField];

  // Handle array of objects (e.g., hasMany relationships)
  if (Array.isArray(parentValue)) {
    if (!result[parentField]) {
      result[parentField] = parentValue.map(() => ({}));
    }
    parentValue.forEach((item, index) => {
      if (typeof item === "object" && item !== null) {
        const itemRecord = item as Record<string, unknown>;
        const resultArray = result[parentField] as Record<string, unknown>[];
        // Always include id in nested objects
        if (itemRecord.id !== undefined) {
          resultArray[index].id = itemRecord.id;
        }
        // Get nested value using child path
        const nestedValue = getNestedValue(itemRecord, childPath);
        if (nestedValue !== undefined) {
          setNestedValue(resultArray[index], childPath, nestedValue);
        }
      }
    });
    return;
  }
  // Handle single object (e.g., hasOne relationship)
  if (typeof parentValue === "object") {
    const parentRecord = parentValue as Record<string, unknown>;
    if (!result[parentField]) {
      result[parentField] = {};
      // Always include id in nested objects
      if (parentRecord.id !== undefined) {
        (result[parentField] as Record<string, unknown>).id = parentRecord.id;
      }
    }
    const nestedValue = getNestedValue(parentRecord, childPath);
    if (nestedValue !== undefined) {
      setNestedValue(
        result[parentField] as Record<string, unknown>,
        childPath,
        nestedValue
      );
    }
  }
}

/**
 * Get a nested value from an object using dot notation path.
 *
 * @param obj - Source object
 * @param path - Dot-separated path (e.g., "author.name")
 * @returns The nested value or undefined
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a nested value in an object using dot notation path.
 *
 * @param obj - Target object to modify
 * @param path - Dot-separated path (e.g., "author.name")
 * @param value - Value to set
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}
