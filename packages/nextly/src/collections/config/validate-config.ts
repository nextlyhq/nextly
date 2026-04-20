/**
 * Collection Configuration Validator
 *
 * Validates a {@link CollectionConfig} using shared base-validator helpers
 * for slug/field-name/relationship/select/component rules, plus the
 * collection-specific access control (create/read/update/delete) and
 * index validation that Singles/Components don't have.
 *
 * Duplicated validation logic was moved to `src/shared/base-validator.ts`
 * in Plan 23 Phase 8. This file now orchestrates those helpers and keeps
 * only Collection-specific rules.
 *
 * @module collections/config/validate-config
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { validateCollectionConfig } from '@nextly/core';
 *
 * const result = validateCollectionConfig(config, ['users', 'posts']);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */

import {
  type BaseValidationError,
  DEFAULT_SQL_KEYWORDS_SET,
  validateComponentFieldRefShared,
  validateFieldNameShared,
  validateFieldTypeShared,
  validateRelationshipTargetShared,
  validateSelectOptionsShared,
  validateSlugShared,
} from "../../shared/base-validator";

import type { CollectionConfig } from "./define-collection";

// ============================================================
// Validation Error Types
// ============================================================

/**
 * Error codes for validation failures.
 * Used for programmatic error handling.
 */
export type ValidationErrorCode =
  // Slug errors
  | "SLUG_REQUIRED"
  | "SLUG_INVALID_TYPE"
  | "SLUG_TOO_SHORT"
  | "SLUG_TOO_LONG"
  | "SLUG_INVALID_FORMAT"
  | "SLUG_RESERVED"
  | "SLUG_SQL_KEYWORD"
  // Field errors
  | "FIELDS_REQUIRED"
  | "FIELDS_INVALID_TYPE"
  | "FIELDS_EMPTY"
  | "FIELD_NAME_REQUIRED"
  | "FIELD_NAME_INVALID_FORMAT"
  | "FIELD_NAME_SQL_KEYWORD"
  | "FIELD_NAME_DUPLICATE"
  | "FIELD_TYPE_REQUIRED"
  | "FIELD_TYPE_INVALID"
  // Field-specific errors
  | "SELECT_OPTIONS_REQUIRED"
  | "SELECT_OPTIONS_EMPTY"
  | "RADIO_OPTIONS_REQUIRED"
  | "RADIO_OPTIONS_EMPTY"
  | "RELATIONSHIP_TARGET_REQUIRED"
  | "RELATIONSHIP_TARGET_INVALID"
  | "RELATIONSHIP_TARGET_UNKNOWN"
  | "ARRAY_FIELDS_REQUIRED"
  | "GROUP_FIELDS_REQUIRED"
  | "BLOCKS_REQUIRED"
  | "BLOCKS_EMPTY"
  | "BLOCK_SLUG_REQUIRED"
  | "BLOCK_FIELDS_REQUIRED"
  // Component field errors
  | "COMPONENT_REF_REQUIRED"
  | "COMPONENT_REF_CONFLICT"
  | "COMPONENT_REF_INVALID"
  | "COMPONENT_REF_EMPTY"
  // Access errors
  | "ACCESS_INVALID_TYPE"
  | "ACCESS_FUNCTION_INVALID"
  // Index errors
  | "INDEX_INVALID_TYPE"
  | "INDEX_FIELDS_REQUIRED"
  | "INDEX_FIELDS_EMPTY"
  | "INDEX_FIELD_UNKNOWN"
  | "INDEX_NAME_INVALID";

/**
 * A single validation error with path and context.
 */
export interface ValidationError {
  /**
   * Dot-notation path to the invalid property.
   * @example 'slug', 'fields.0.name', 'fields.metadata.items.title'
   */
  path: string;

  /** Human-readable error message. */
  message: string;

  /** Machine-readable error code for programmatic handling. */
  code: ValidationErrorCode;
}

/**
 * Result of collection config validation.
 */
export interface ValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;

  /** Array of validation errors (empty if valid). */
  errors: ValidationError[];
}

// ============================================================
// Reserved Names and Keywords
// ============================================================

/**
 * Reserved collection slugs that cannot be used.
 * These are used by the system or have special meaning.
 */
export const RESERVED_SLUGS = [
  // API routes
  "api",
  "graphql",
  "rest",
  // Admin routes
  "admin",
  "dashboard",
  // Auth routes
  "auth",
  "login",
  "logout",
  "register",
  "signup",
  "signin",
  "signout",
  "forgot-password",
  "reset-password",
  "verify",
  "verify-email",
  // System routes
  "static",
  "public",
  "assets",
  "_next",
  "health",
  "status",
  "metrics",
  // Common system collections
  "users",
  "roles",
  "permissions",
  "sessions",
  "tokens",
  "media",
  "uploads",
  "files",
] as const;

/**
 * SQL reserved keywords that should not be used as identifiers.
 *
 * Curated list of the most problematic keywords across PostgreSQL, MySQL,
 * and SQLite. Using these as table or column names can cause issues even
 * with quoting.
 *
 * @see https://sqlite.org/lang_keywords.html
 * @see https://www.postgresql.org/docs/current/sql-keywords-appendix.html
 * @see https://dev.mysql.com/doc/refman/8.0/en/keywords.html
 */
export const SQL_RESERVED_KEYWORDS = [
  // Data manipulation
  "select",
  "insert",
  "update",
  "delete",
  "from",
  "where",
  "set",
  "values",
  // Table operations
  "create",
  "drop",
  "alter",
  "table",
  "index",
  "view",
  "trigger",
  "database",
  // Joins and relations
  "join",
  "inner",
  "outer",
  "left",
  "right",
  "cross",
  "full",
  "on",
  "using",
  // Clauses
  "order",
  "group",
  "by",
  "having",
  "limit",
  "offset",
  "distinct",
  "as",
  "case",
  "when",
  "then",
  "else",
  "end",
  // Logical
  "and",
  "or",
  "not",
  "in",
  "is",
  "null",
  "like",
  "between",
  "exists",
  // Constraints
  "primary",
  "foreign",
  "key",
  "references",
  "unique",
  "check",
  "constraint",
  "default",
  // Transactions
  "begin",
  "commit",
  "rollback",
  "transaction",
  // Aggregates (can cause confusion)
  "count",
  "sum",
  "avg",
  "min",
  "max",
  // Other commonly problematic
  "all",
  "any",
  "union",
  "except",
  "intersect",
  "column",
  "row",
  "rows",
  "for",
  "to",
  "into",
  "with",
  // High-risk specific keywords
  "user",
  "password",
  "role",
  "session",
  "grant",
  "revoke",
  "match",
  "natural",
] as const;

const RESERVED_SLUGS_SET: Set<string> = new Set<string>(RESERVED_SLUGS);

// ============================================================
// Index Validation (collection-specific)
// ============================================================

/**
 * Regex pattern for valid index names.
 * Must be alphanumeric with underscores, starting with a letter.
 */
const INDEX_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Extracts all field names from the fields array (including nested fields).
 * Used to validate index field references.
 */
function extractFieldNames(
  fields: unknown[],
  prefix: string = ""
): Set<string> {
  const names = new Set<string>();

  for (const field of fields) {
    if (!field || typeof field !== "object") continue;
    const f = field as Record<string, unknown>;

    const name = f.name;
    if (typeof name === "string") {
      const fullName = prefix ? `${prefix}.${name}` : name;
      names.add(name);
      names.add(fullName);
    }

    if (Array.isArray(f.fields)) {
      const nestedPrefix =
        typeof name === "string"
          ? prefix
            ? `${prefix}.${name}`
            : name
          : prefix;
      const nestedNames = extractFieldNames(
        f.fields as unknown[],
        nestedPrefix
      );
      nestedNames.forEach(n => names.add(n));
    }
  }

  return names;
}

/**
 * Validates the indexes configuration.
 */
function validateIndexes(
  indexes: unknown,
  fields: unknown[],
  errors: ValidationError[]
): void {
  if (!indexes) {
    return;
  }

  if (!Array.isArray(indexes)) {
    errors.push({
      path: "indexes",
      message: "Indexes must be an array",
      code: "INDEX_INVALID_TYPE",
    });
    return;
  }

  const validFieldNames = extractFieldNames(fields);
  validFieldNames.add("id");
  validFieldNames.add("createdAt");
  validFieldNames.add("updatedAt");

  indexes.forEach((index, idx) => {
    const indexPath = `indexes[${idx}]`;

    if (!index || typeof index !== "object") {
      errors.push({
        path: indexPath,
        message: "Each index must be an object",
        code: "INDEX_INVALID_TYPE",
      });
      return;
    }

    const i = index as Record<string, unknown>;

    if (!i.fields) {
      errors.push({
        path: `${indexPath}.fields`,
        message: "Index must specify 'fields' array",
        code: "INDEX_FIELDS_REQUIRED",
      });
      return;
    }

    if (!Array.isArray(i.fields)) {
      errors.push({
        path: `${indexPath}.fields`,
        message: "Index 'fields' must be an array",
        code: "INDEX_FIELDS_REQUIRED",
      });
      return;
    }

    if (i.fields.length === 0) {
      errors.push({
        path: `${indexPath}.fields`,
        message: "Index must specify at least one field",
        code: "INDEX_FIELDS_EMPTY",
      });
      return;
    }

    i.fields.forEach((fieldName, fieldIdx) => {
      if (typeof fieldName !== "string") {
        errors.push({
          path: `${indexPath}.fields[${fieldIdx}]`,
          message: "Index field must be a string",
          code: "INDEX_FIELD_UNKNOWN",
        });
        return;
      }

      if (!validFieldNames.has(fieldName)) {
        errors.push({
          path: `${indexPath}.fields[${fieldIdx}]`,
          message: `Unknown field '${fieldName}' in index. Available fields: ${Array.from(validFieldNames).sort().join(", ")}`,
          code: "INDEX_FIELD_UNKNOWN",
        });
      }
    });

    if (i.name !== undefined) {
      if (typeof i.name !== "string") {
        errors.push({
          path: `${indexPath}.name`,
          message: "Index name must be a string",
          code: "INDEX_NAME_INVALID",
        });
      } else if (!INDEX_NAME_PATTERN.test(i.name)) {
        errors.push({
          path: `${indexPath}.name`,
          message: `Invalid index name '${i.name}'. Must start with a letter and contain only letters, numbers, and underscores`,
          code: "INDEX_NAME_INVALID",
        });
      }
    }

    if (i.unique !== undefined && typeof i.unique !== "boolean") {
      errors.push({
        path: `${indexPath}.unique`,
        message: "Index 'unique' must be a boolean",
        code: "INDEX_INVALID_TYPE",
      });
    }
  });
}

// ============================================================
// Field Validation (orchestrates shared helpers)
// ============================================================

/**
 * Validate a single field configuration recursively.
 *
 * Dispatches to shared helpers for name/type/relationship/select/component
 * rules, and recurses into `repeater`/`group` children.
 */
function validateField(
  field: unknown,
  path: string,
  errors: ValidationError[],
  seenNames: Set<string>,
  allCollectionSlugs?: string[]
): void {
  if (!field || typeof field !== "object") {
    return;
  }

  const f = field as Record<string, unknown>;
  const errsBase = errors as unknown as BaseValidationError[];

  if (!validateFieldTypeShared(f.type, path, errsBase)) {
    return;
  }
  const fieldType = f.type as string;

  validateFieldNameShared(
    f.name,
    path,
    errsBase,
    seenNames,
    DEFAULT_SQL_KEYWORDS_SET
  );

  switch (fieldType) {
    case "select":
      validateSelectOptionsShared(f, path, errsBase, "select");
      break;

    case "radio":
      validateSelectOptionsShared(f, path, errsBase, "radio");
      break;

    case "relationship":
      validateRelationshipTargetShared(f, path, errsBase, allCollectionSlugs);
      break;

    case "repeater": {
      const arrayFields = f.fields;
      if (!arrayFields) {
        errors.push({
          path: `${path}.fields`,
          message: "Array field must have a 'fields' array",
          code: "ARRAY_FIELDS_REQUIRED",
        });
      } else if (Array.isArray(arrayFields)) {
        validateFieldsArray(
          arrayFields,
          `${path}.fields`,
          errors,
          allCollectionSlugs
        );
      }
      break;
    }

    case "group": {
      const groupFields = f.fields;
      if (!groupFields) {
        errors.push({
          path: `${path}.fields`,
          message: "Group field must have a 'fields' array",
          code: "GROUP_FIELDS_REQUIRED",
        });
      } else if (Array.isArray(groupFields)) {
        validateFieldsArray(
          groupFields,
          `${path}.fields`,
          errors,
          allCollectionSlugs
        );
      }
      break;
    }

    case "component":
      validateComponentFieldRefShared(f, path, errsBase);
      break;
  }
}

/**
 * Validate an array of field configurations.
 */
function validateFieldsArray(
  fields: unknown[],
  basePath: string,
  errors: ValidationError[],
  allCollectionSlugs?: string[]
): void {
  const seenNames = new Set<string>();

  fields.forEach((field, index) => {
    const fieldPath = `${basePath}[${index}]`;
    validateField(field, fieldPath, errors, seenNames, allCollectionSlugs);
  });
}

/**
 * Validate the top-level fields array.
 */
function validateFields(
  fields: unknown,
  errors: ValidationError[],
  allCollectionSlugs?: string[]
): void {
  const path = "fields";

  if (!fields) {
    errors.push({
      path,
      message: "Collection fields are required",
      code: "FIELDS_REQUIRED",
    });
    return;
  }

  if (!Array.isArray(fields)) {
    errors.push({
      path,
      message: "Collection fields must be an array",
      code: "FIELDS_INVALID_TYPE",
    });
    return;
  }

  if (fields.length === 0) {
    errors.push({
      path,
      message: "Collection must have at least one field",
      code: "FIELDS_EMPTY",
    });
    return;
  }

  validateFieldsArray(fields, path, errors, allCollectionSlugs);
}

/**
 * Validates access control functions.
 * Collections support all four access keys: create, read, update, delete.
 */
function validateAccess(access: unknown, errors: ValidationError[]): void {
  if (!access) {
    return;
  }

  if (typeof access !== "object" || Array.isArray(access)) {
    errors.push({
      path: "access",
      message: "Access control must be an object",
      code: "ACCESS_INVALID_TYPE",
    });
    return;
  }

  const accessObj = access as Record<string, unknown>;
  const validAccessKeys = ["create", "read", "update", "delete"] as const;

  for (const key of validAccessKeys) {
    const fn = accessObj[key];
    if (fn !== undefined && typeof fn !== "function") {
      errors.push({
        path: `access.${key}`,
        message: `Access control '${key}' must be a function`,
        code: "ACCESS_FUNCTION_INVALID",
      });
    }
  }
}

// ============================================================
// Main Validation Function
// ============================================================

/**
 * Validates a complete collection configuration.
 *
 * Performs comprehensive validation including slug format/reserved names,
 * SQL keyword blocking, recursive field validation, select options,
 * relationship targets (optionally cross-checked against known collection
 * slugs), duplicate detection, access function types, and index
 * configuration validation.
 *
 * @param config - The collection configuration to validate
 * @param allCollectionSlugs - Optional array of all collection slugs for relationship validation
 * @returns Validation result with any errors found
 *
 * @example
 * ```typescript
 * import { validateCollectionConfig } from '@nextly/core';
 *
 * const result = validateCollectionConfig(config, ['users', 'posts', 'categories']);
 *
 * if (!result.valid) {
 *   result.errors.forEach(err => {
 *     console.error(`[${err.code}] ${err.path}: ${err.message}`);
 *   });
 * }
 * ```
 */
export function validateCollectionConfig(
  config: CollectionConfig,
  allCollectionSlugs?: string[]
): ValidationResult {
  const errors: ValidationError[] = [];
  const errsBase = errors as unknown as BaseValidationError[];

  validateSlugShared(config.slug, errsBase, {
    entityLabel: "Collection",
    reservedSlugsSet: RESERVED_SLUGS_SET,
    sqlKeywordsSet: DEFAULT_SQL_KEYWORDS_SET,
  });

  validateFields(config.fields, errors, allCollectionSlugs);

  validateIndexes(config.indexes, config.fields as unknown[], errors);

  validateAccess(config.access, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Throws an error if the configuration is invalid.
 *
 * Convenience wrapper around {@link validateCollectionConfig}.
 */
export function assertValidCollectionConfig(
  config: CollectionConfig,
  allCollectionSlugs?: string[]
): void {
  const result = validateCollectionConfig(config, allCollectionSlugs);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(err => `  - [${err.code}] ${err.path}: ${err.message}`)
      .join("\n");

    throw new Error(
      `Invalid collection config for '${config.slug || "unknown"}':\n${errorMessages}`
    );
  }
}
