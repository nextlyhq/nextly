/**
 * Schema Hash Utility
 *
 * Provides deterministic SHA-256 hashing for schema definitions.
 * Used for change detection between schema versions to determine
 * when migrations are needed.
 *
 * @module services/schema/schema-hash
 * @since 1.0.0
 */

import { createHash } from "crypto";

import type { FieldConfig } from "@nextly/collections";

// ============================================================
// System Schema Version
// ============================================================

/**
 * System schema version for tracking changes to auto-generated columns.
 *
 * Bump this version whenever changes are made to:
 * - Primary key column (id)
 * - Timestamp columns (created_at, updated_at)
 * - Any other system-generated columns
 *
 * This version is included in the schema hash to ensure tables are
 * recreated when system column definitions change.
 *
 * History:
 * - v1: Initial version (createdAt, updatedAt - camelCase)
 * - v2: Changed to snake_case (created_at, updated_at)
 */
export const SYSTEM_SCHEMA_VERSION = 2;

// ============================================================
// Types
// ============================================================

/**
 * Properties that should be excluded from hash calculation.
 *
 * These properties contain runtime behavior (functions) or
 * admin UI settings that don't affect the database schema.
 */
const EXCLUDED_PROPERTIES = new Set([
  // Functions (can't be meaningfully hashed)
  "validate",
  "hooks",
  "access",
  "filterOptions",
  "defaultValue", // Can be a function
  // Admin UI only (no database impact)
  "admin",
  "custom",
  // React components
  "components",
]);

/**
 * Properties that contain nested field configurations.
 * These need recursive normalization.
 */
const NESTED_FIELD_PROPERTIES = new Set(["fields"]);

// ============================================================
// Public API
// ============================================================

/**
 * Generates a deterministic SHA-256 hash of a fields array.
 *
 * Used for change detection between schema versions. The hash
 * is calculated from the normalized field structure, ignoring
 * runtime properties like functions and admin UI settings.
 *
 * **Normalization includes:**
 * - Sorting fields by name alphabetically
 * - Sorting object keys alphabetically
 * - Removing undefined values
 * - Excluding function properties (validate, hooks, access)
 * - Excluding admin UI properties
 * - Recursively normalizing nested fields (array, group, blocks, tabs)
 *
 * @param fields - Array of field configurations to hash
 * @returns 64-character hex string (SHA-256 hash)
 *
 * @example
 * ```typescript
 * import { calculateSchemaHash } from '@nextly/services/schema';
 *
 * const fields = [
 *   { name: 'title', type: 'text', required: true },
 *   { name: 'content', type: 'richText' },
 * ];
 *
 * const hash = calculateSchemaHash(fields);
 * // Returns: "a1b2c3d4..." (64 character hex string)
 *
 * // Same fields in different order = same hash
 * const fields2 = [
 *   { name: 'content', type: 'richText' },
 *   { name: 'title', type: 'text', required: true },
 * ];
 * const hash2 = calculateSchemaHash(fields2);
 * // hash === hash2 (true - order doesn't matter)
 * ```
 */
export function calculateSchemaHash(fields: FieldConfig[]): string {
  const normalized = normalizeFields(fields);
  // Include system schema version to detect changes to auto-generated columns
  const hashInput = {
    systemVersion: SYSTEM_SCHEMA_VERSION,
    fields: normalized,
  };
  const json = JSON.stringify(hashInput);
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Compares two schema hashes for equality.
 *
 * A simple equality check that provides semantic clarity
 * when comparing schema versions.
 *
 * @param hash1 - First schema hash
 * @param hash2 - Second schema hash
 * @returns `true` if hashes match, `false` otherwise
 *
 * @example
 * ```typescript
 * import { calculateSchemaHash, schemaHashesMatch } from '@nextly/services/schema';
 *
 * const currentHash = calculateSchemaHash(currentFields);
 * const storedHash = collection.schemaHash;
 *
 * if (!schemaHashesMatch(currentHash, storedHash)) {
 *   console.log('Schema has changed, migration needed');
 * }
 * ```
 */
export function schemaHashesMatch(hash1: string, hash2: string): boolean {
  return hash1 === hash2;
}

/**
 * Checks if a schema has changed by comparing field definitions.
 *
 * Convenience function that calculates hashes and compares them
 * in a single call.
 *
 * @param currentFields - Current field definitions
 * @param previousHash - Previously stored schema hash
 * @returns `true` if schema has changed, `false` if unchanged
 *
 * @example
 * ```typescript
 * import { hasSchemaChanged } from '@nextly/services/schema';
 *
 * if (hasSchemaChanged(collection.fields, collection.schemaHash)) {
 *   // Trigger migration workflow
 *   await generateMigration(collection);
 * }
 * ```
 */
export function hasSchemaChanged(
  currentFields: FieldConfig[],
  previousHash: string
): boolean {
  const currentHash = calculateSchemaHash(currentFields);
  return !schemaHashesMatch(currentHash, previousHash);
}

// ============================================================
// Internal Normalization Functions
// ============================================================

/**
 * Normalizes an array of fields for deterministic hashing.
 *
 * - Maps each field through normalizeField
 * - Sorts fields by name alphabetically
 * - Fields without names (layout fields) are sorted by type
 *
 * @internal
 */
function normalizeFields(fields: FieldConfig[]): Record<string, unknown>[] {
  return fields
    .map(field => normalizeField(field))
    .sort((a, b) => {
      // Sort by name if available, otherwise by type
      const aKey = (a.name as string) || (a.type as string) || "";
      const bKey = (b.name as string) || (b.type as string) || "";
      return aKey.localeCompare(bKey);
    });
}

/**
 * Normalizes a single field for deterministic hashing.
 *
 * - Sorts object keys alphabetically
 * - Removes undefined values
 * - Excludes function properties and admin UI settings
 * - Recursively normalizes nested fields
 *
 * @internal
 */
function normalizeField(field: FieldConfig): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  // Cast to unknown first for safe property access
  const fieldRecord = field as unknown as Record<string, unknown>;

  // Get all keys and sort alphabetically
  const sortedKeys = Object.keys(fieldRecord).sort();

  for (const key of sortedKeys) {
    const value = fieldRecord[key];

    // Skip undefined values
    if (value === undefined) continue;

    // Skip excluded properties (functions, admin UI, etc.)
    if (EXCLUDED_PROPERTIES.has(key)) continue;

    // Skip if value is a function
    if (typeof value === "function") continue;

    // Handle nested field configurations
    if (NESTED_FIELD_PROPERTIES.has(key)) {
      normalized[key] = normalizeNestedFields(key, value);
    } else if (isPlainObject(value)) {
      // Recursively normalize plain objects (e.g., labels, options)
      normalized[key] = normalizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      // Normalize arrays (e.g., select options)
      normalized[key] = normalizeArray(value);
    } else {
      // Primitive values pass through
      normalized[key] = value;
    }
  }

  return normalized;
}

/**
 * Normalizes nested field configurations based on property name.
 *
 * Handles:
 * - `fields` (array, group)
 *
 * @internal
 */
function normalizeNestedFields(
  _key: string,
  value: unknown
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeFields(value as FieldConfig[]);
}

/**
 * Normalizes a plain object by sorting keys.
 *
 * @internal
 */
function normalizeObject(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const sortedKeys = Object.keys(obj).sort();

  for (const key of sortedKeys) {
    const value = obj[key];

    if (value === undefined) continue;
    if (typeof value === "function") continue;

    if (isPlainObject(value)) {
      normalized[key] = normalizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      normalized[key] = normalizeArray(value);
    } else {
      normalized[key] = value;
    }
  }

  return normalized;
}

/**
 * Normalizes an array by recursively normalizing its elements.
 *
 * @internal
 */
function normalizeArray(arr: unknown[]): unknown[] {
  return arr
    .map(item => {
      if (item === undefined || item === null) return item;
      if (typeof item === "function") return undefined;

      if (isPlainObject(item)) {
        return normalizeObject(item as Record<string, unknown>);
      }
      if (Array.isArray(item)) {
        return normalizeArray(item);
      }
      return item;
    })
    .filter(item => item !== undefined);
}

/**
 * Checks if a value is a plain object (not null, array, or other object types).
 *
 * @internal
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}
