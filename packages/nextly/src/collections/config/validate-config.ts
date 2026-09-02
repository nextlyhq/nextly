/**
 * Collection Configuration Validator
 *
 * Validates a {@link CollectionConfig} using shared base-validator helpers
 * for slug/field-name/relationship/select/component rules, plus the
 * collection-specific access control (create/read/update/delete) and
 * index validation that Singles/Components don't have.
 *
 * Duplicated validation logic was moved to `src/shared/base-validator.ts`
 * This file now orchestrates those helpers and keeps
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

import { isPluginFieldTypeOnSurface } from "../../domains/schema/field-types/field-type-registry";
import {
  fieldProducesColumn,
  toSnakeCase,
} from "../../domains/schema/services/field-column-descriptor";
import {
  isLifecycleSystemColumn,
  isOwnableSystemColumn,
  isReservedSystemColumn,
} from "../../lib/system-columns";
import {
  NEWLY_RESERVED_SLUG_NOTES,
  SYSTEM_RESOURCES,
} from "../../schemas/_zod/rbac";
import {
  type BaseValidationError,
  DEFAULT_SQL_KEYWORDS_SET,
  validateComponentFieldRefShared,
  validateFieldNameShared,
  validateFieldTypeShared,
  validateNumberDecimalDimensionsShared,
  validateRelationshipTargetShared,
  validatePluginFieldOptionsShared,
  validateSelectOptionsShared,
  validateSlugShared,
} from "../../shared/base-validator";
// RESERVED_SLUGS and SQL_RESERVED_KEYWORDS used to live in this file. They
// moved to shared/sql-reserved.ts to break a circular dependency with
// base-validator. Imported here for local use in RESERVED_SLUGS_SET below
// and re-exported so existing consumers that import them from this file's
// path continue to work unchanged.
import {
  RESERVED_SLUGS,
  SQL_RESERVED_KEYWORDS,
} from "../../shared/sql-reserved";
// C7/D16 — accept plugin-registered custom field types (must be registered
// before the config is validated; see field-type-registry).

import type { CollectionConfig } from "./define-collection";

export { RESERVED_SLUGS, SQL_RESERVED_KEYWORDS };

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
  | "FIELD_NAME_RESERVED"
  // A name that reaches a system column under a different spelling. Allowed only as the
  // column's own name, because the declared name stays the identity in every payload.
  | "FIELD_NAME_SYSTEM_ALIAS"
  // A name that reaches a column the Draft/Published lifecycle owns, while it is enabled.
  | "FIELD_NAME_LIFECYCLE_RESERVED"
  | "FIELD_TYPE_REQUIRED"
  | "FIELD_TYPE_INVALID"
  // A declared default the field's own rules reject.
  | "FIELD_DEFAULT_INVALID"
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
  | "DECIMAL_PRECISION_INVALID"
  | "DECIMAL_SCALE_INVALID"
  | "DECIMAL_SCALE_EXCEEDS_PRECISION"
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

// RESERVED_SLUGS and SQL_RESERVED_KEYWORDS were defined here historically;
// they now live in shared/sql-reserved.ts and are re-exported above so the
// public API surface for this file is unchanged.

// System-resource names are added on top of the base reserved slugs. A
// collection named after a system resource would seed the same permission rows
// that resource's routes check (a `settings` collection reaches the user-fields
// and component admin surfaces, a `media` collection the media routes), so it is
// rejected here — at config validation, before any migration or table is built.
// The names are NOT in the shared base list, because that list also feeds the
// component validator and a component does not seed a permission under its slug.
const RESERVED_SLUGS_SET: Set<string> = new Set<string>([
  ...RESERVED_SLUGS,
  ...SYSTEM_RESOURCES,
]);

// System columns injected onto a collection table, under both the snake_case
// name and the camelCase alias that snake-cases to the same column. A code-first
// collection must not declare a top-level field with either name, or its DDL
// would collide with the injected column and the system's own stamp would
// consume a user field.
//
// `created_by` is the owner column. `first_published_at` records the first
// transition into published; it is injected only when the draft/publish
// lifecycle is enabled, but it is reserved unconditionally, because a
// collection can enable that lifecycle later and the field would collide the
// moment it did — failing at migration time rather than at config validation,
// which is much further from the mistake.
//
// Components embed in JSON and carry neither column, so they may use both names
// freely. Nested repeater/group fields are stored inside JSON, not as table
// columns, so the reservation applies to the top level only.

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

  // Plugin types are accepted only when they opted into the entries surface —
  // registration alone is not authorization for a collection field.
  // Whether a name is usable as a column does not depend on the field's type,
  // and a contributed type has no answer here at all — it defers to boot. Left
  // behind the type check, a plugin field's name was never checked by anything:
  // the deferral returns before this, and the boot gate asks only whether the
  // token was claimed. A duplicate or SQL-reserved name reached schema
  // generation as a colliding column.
  validateFieldNameShared(
    f.name,
    path,
    errsBase,
    seenNames,
    DEFAULT_SQL_KEYWORDS_SET
  );

  if (
    !validateFieldTypeShared(f.type, path, errsBase, type =>
      isPluginFieldTypeOnSurface(type, "entries")
    )
  ) {
    return;
  }
  const fieldType = f.type as string;

  // A plugin type reaches none of the cases below, so its own declaration
  // checks run here rather than as a case that could never be written for a
  // type core does not know.
  validatePluginFieldOptionsShared(f, path, errsBase);

  switch (fieldType) {
    case "select":
      validateSelectOptionsShared(f, path, errsBase, "select");
      break;

    case "radio":
      validateSelectOptionsShared(f, path, errsBase, "radio");
      break;

    case "blocks":
      // A blocks default must satisfy the same field policy the write applies.
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

    case "number":
      validateNumberDecimalDimensionsShared(f, path, errsBase);
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
  allCollectionSlugs?: string[],
  lifecycleEnabled = false
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

  // Block names that become a column the table already carries. Such a field is emitted alongside
  // the injected one, so the table declares the column twice and the database refuses the
  // statement — a collection carrying one could never have been created.
  //
  // Compared as the PHYSICAL column, through the same conversion schema generation uses, because a
  // field name reaches its column that way: `createdAt`, `created_at` and `CreatedAt` all arrive at
  // `created_at`, and a set of literal spellings can only hold the ones somebody listed.
  //
  // `title`, `slug` and `status` are deliberately absent. The first two step aside for an author's
  // own field by design, and a `status` field is accepted by the lifecycle rather than duplicated;
  // reserving any of them would refuse a configuration that works today.
  //
  // Nested fields are validated recursively inside validateFieldsArray and are intentionally
  // exempt: they are stored inside JSON and never become columns of their own.
  //
  // Ownership is GLOBAL, not per table. Two names that reach one column are refused even when the
  // generators would put them in different tables — a shared `foo_bar` beside a localized
  // `FooBar`. Physical separation does not keep the two values apart, because the write path
  // normalizes payload keys through the same conversion BEFORE it splits localized fields off:
  //
  //   for (const [key, value] of Object.entries(rawEntryData))
  //     entryData[toSnakeCase(key)] = value;
  //
  // Both keys land on `foo_bar` and the second silently overwrites the first, so one of the two
  // authored values is already gone by the time anything decides which table it belongs to.
  const columnOwners = new Map<string, string>();
  fields.forEach((field, index) => {
    if (!field || typeof field !== "object") return;
    const candidate = field as Record<string, unknown>;
    const name = candidate.name;
    if (typeof name !== "string") return;
    const column = toSnakeCase(name);
    if (isReservedSystemColumn(column, "collectionConfig")) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' is reserved: it becomes the system column '${column}'`,
        code: "FIELD_NAME_RESERVED",
      });
      return;
    }
    // Everything below is about columns, so a field that occupies none is exempt. A component or
    // a many-to-many named `Title` takes over nothing: its values live in its own table and its
    // payload key stays `Title`, distinct from the system field's `title`.
    // The lifecycle is emitted into the generated artifacts as well as into the
    // table: the interface and the Zod schema each declare a `status` member
    // under the column's own name. A column-less field keeps its DECLARED name
    // as its payload key and as its generated member, so the two collide there
    // even though they never share a column — and the column-based exemption
    // immediately below cannot see that, because it is about columns.
    //
    // Matched on the declared name rather than the converted column, because
    // that is the key the artifacts emit: a column-less `Status` stays a
    // distinct member and is left alone.
    if (lifecycleEnabled && isLifecycleSystemColumn(name, "collection")) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' is owned by the Draft/Published lifecycle and would be declared twice in the generated types. Rename the field, or turn the lifecycle off`,
        code: "FIELD_NAME_LIFECYCLE_RESERVED",
      });
      return;
    }
    if (!fieldProducesColumn(candidate)) return;
    // A field may take over `title` or `slug` — that is the documented "user wins" behaviour —
    // but only under the column's own name. `Title` reaches the same column while staying a
    // different identity everywhere the declared name is the key: the runtime table's property,
    // the payload keys a mutation generates, the response document, the generated types. The two
    // would then write one column under two names, and the generated value would overwrite the
    // author's. Refused here, with the spelling that works, rather than normalized at every layer.
    if (column !== name && isOwnableSystemColumn(column, "collection")) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' becomes the system column '${column}'. Name the field '${column}' to replace that column, or choose a different name`,
        code: "FIELD_NAME_SYSTEM_ALIAS",
      });
      return;
    }
    // The Draft/Published lifecycle owns its columns outright: their length, their NOT NULL, the
    // 'draft' default and the values publish/unpublish write. An author's field cannot stand in
    // for one, so any name reaching them is a collision rather than a takeover, and the table
    // would declare the column twice. Only when the lifecycle is on — with it off these are
    // ordinary names and a `status` field is measured clean in all three generators.
    if (lifecycleEnabled && isLifecycleSystemColumn(column, "collection")) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' becomes the column '${column}', which the Draft/Published lifecycle owns. Rename the field, or turn the lifecycle off`,
        code: "FIELD_NAME_LIFECYCLE_RESERVED",
      });
      return;
    }
    // Two names that reach one column cannot both be emitted, so the table could never be
    // created. Checked here rather than in the shared field-name rule because only this level has
    // columns at all: a repeater or group keeps its children inside a single JSON column, where
    // two names that convert alike are simply two keys.
    //
    // Column-less field types are exempt for the same reason. A component and a many-to-many
    // relationship store their values in their own tables, keyed by the field's declared name, so
    // two of them whose names converge stay distinct and nothing is emitted twice.
    const owner = columnOwners.get(column);
    if (owner !== undefined) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' collides with '${owner}': both become the column '${column}'`,
        code: "FIELD_NAME_DUPLICATE",
      });
      return;
    }
    columnOwners.set(column, name);
  });

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
    reservedSlugNotes: NEWLY_RESERVED_SLUG_NOTES,
    sqlKeywordsSet: DEFAULT_SQL_KEYWORDS_SET,
  });

  validateFields(
    config.fields,
    errors,
    allCollectionSlugs,
    (config as { status?: boolean }).status === true
  );

  validateIndexes(config.indexes, config.fields, errors);

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
