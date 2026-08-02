/**
 * Component Configuration Validator
 *
 * Validates a {@link FieldGroupConfig} using shared base-validator helpers
 * for slug/field-name/relationship/component rules. Components do not have
 * domain-specific access rules or index validation; cross-component
 * checks (circular references, nesting depth) run at `defineConfig()` time
 * when all component definitions are available.
 *
 * Duplicated validation logic was moved to `src/shared/base-validator.ts`
 * This file now orchestrates those helpers and keeps
 * only Component-specific error types and reserved slug constants.
 *
 * @module field-groups/config/validate-field-group
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { validateFieldGroupConfig } from 'nextly';
 *
 * const result = validateFieldGroupConfig(config);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */

import { RESERVED_SLUGS } from "../../collections/config/validate-config";
import {
  isDataField,
  isFieldGroupField,
} from "../../collections/fields/guards";
import type { FieldConfig } from "../../collections/fields/types";
import { isPluginFieldTypeOnSurface } from "../../domains/schema/field-types/field-type-registry";
import { isPluginDataField } from "../../domains/schema/services/plugin-codegen";
import { NextlyError } from "../../errors";
import {
  isReservedSystemColumn,
  toPhysicalColumnName,
} from "../../lib/system-columns";
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

import type { FieldGroupConfig } from "./types";

// Re-export constants for external use
export {
  RESERVED_SLUGS,
  SQL_RESERVED_KEYWORDS,
} from "../../collections/config/validate-config";

// ============================================================
// Constants
// ============================================================

/**
 * Maximum nesting depth for component-within-component references.
 *
 * A depth of 3 means:
 * - Level 1: Component A used in a Collection/Single
 * - Level 2: Component B nested inside Component A
 * - Level 3: Component C nested inside Component B
 *
 * Enforced at `defineConfig()` time when all component definitions are available.
 */
export const MAX_FIELD_GROUP_NESTING_DEPTH = 3;

// ============================================================
// Validation Error Types
// ============================================================

/**
 * Error codes for Component validation failures.
 */
export type FieldGroupValidationErrorCode =
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
  // A name that snake-cases onto a column this group's table already carries. The same code the
  // collection and single validators report, because it is the same mistake with the same fix.
  | "FIELD_NAME_RESERVED"
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
  | "ARRAY_FIELDS_REQUIRED"
  | "GROUP_FIELDS_REQUIRED"
  | "DECIMAL_PRECISION_INVALID"
  | "DECIMAL_SCALE_INVALID"
  | "DECIMAL_SCALE_EXCEEDS_PRECISION"
  // Component field errors
  | "COMPONENT_REF_REQUIRED"
  | "COMPONENT_REF_CONFLICT"
  | "COMPONENT_REF_INVALID"
  | "COMPONENT_REF_EMPTY";

/**
 * A single validation error with path and context.
 */
export interface FieldGroupValidationError {
  /**
   * Dot-notation path to the invalid property.
   * @example 'slug', 'fields.0.name', 'fields.seo.component'
   */
  path: string;

  /** Human-readable error message. */
  message: string;

  /** Machine-readable error code for programmatic handling. */
  code: FieldGroupValidationErrorCode;
}

/**
 * Result of Component config validation.
 */
export interface FieldGroupValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;

  /** Array of validation errors (empty if valid). */
  errors: FieldGroupValidationError[];
}

// ============================================================
// Reserved Names for Components
// ============================================================

/**
 * Reserved Component slugs that cannot be used.
 *
 * Extends the base RESERVED_SLUGS with Component-specific reserved names.
 */
export const RESERVED_FIELD_GROUP_SLUGS = [
  ...RESERVED_SLUGS,
  // API namespace. A slug matching a live route segment would make the two
  // indistinguishable in a URL.
  "field-groups",
  "field-group",
] as const;

const RESERVED_COMPONENT_SLUGS_SET: Set<string> = new Set<string>(
  RESERVED_FIELD_GROUP_SLUGS
);

// ============================================================
// Domain-Specific Field Validation
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
  errors: FieldGroupValidationError[],
  seenNames: Set<string>
): void {
  if (!field || typeof field !== "object") {
    return;
  }

  const f = field as Record<string, unknown>;
  const errsBase = errors as unknown as BaseValidationError[];

  // Plugin types are accepted only when they opted into the entries surface —
  // registration alone is not authorization for a component field.
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
      validateRelationshipTargetShared(f, path, errsBase);
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
        validateFieldsArray(arrayFields, `${path}.fields`, errors);
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
        validateFieldsArray(groupFields, `${path}.fields`, errors);
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
  errors: FieldGroupValidationError[]
): void {
  const seenNames = new Set<string>();

  fields.forEach((field, index) => {
    const fieldPath = `${basePath}[${index}]`;
    validateField(field, fieldPath, errors, seenNames);
  });
}

/**
 * Validate the top-level fields array.
 */
function validateFields(
  fields: unknown,
  errors: FieldGroupValidationError[]
): void {
  const path = "fields";

  if (!fields) {
    errors.push({
      path,
      message: "Component fields are required",
      code: "FIELDS_REQUIRED",
    });
    return;
  }

  if (!Array.isArray(fields)) {
    errors.push({
      path,
      message: "Component fields must be an array",
      code: "FIELDS_INVALID_TYPE",
    });
    return;
  }

  // Block names that collide with a column this group's table already carries. Such a field is
  // emitted alongside the injected column, so the CREATE TABLE declares it twice and the database
  // refuses the statement — the group could never have been created, and refusing the name reports
  // that where it is chosen rather than as a migration failure.
  //
  // Compared as the PHYSICAL column rather than as a spelling, because a field name reaches the
  // column through the generator's own conversion: `createdAt` and `CreatedAt` both arrive at
  // `created_at`, and a set of literal spellings can only ever hold the ones somebody listed.
  //
  // Only fields that actually emit a column are checked. A field group referencing another group
  // keeps its data in the referenced table and the generator emits nothing for it, so its name
  // never reaches a column and refusing it would reject a configuration that works.
  fields.forEach((field, index) => {
    if (!field || typeof field !== "object") return;
    const candidate = field as FieldConfig;
    if (!isDataField(candidate) && !isPluginDataField(candidate)) return;
    if (isFieldGroupField(candidate)) return;

    const name = (field as Record<string, unknown>).name;
    if (typeof name !== "string") return;
    const column = toPhysicalColumnName(name);
    if (isReservedSystemColumn(column, "fieldGroupConfig")) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' is reserved: it becomes the system column '${column}'`,
        code: "FIELD_NAME_RESERVED",
      });
    }
  });

  // An empty fields list is valid for both code-first defines and the
  // modal-driven create flow. A field group's table still gets its id and the
  // system columns that bind a row to its parent entry, so a fieldless group is
  // a usable table and an author can scaffold first and add fields later.
  validateFieldsArray(fields, path, errors);
}

// ============================================================
// Main Validation Function
// ============================================================

/**
 * Validates a complete Component configuration.
 *
 * Performs comprehensive validation including slug format/reserved names,
 * SQL keyword blocking, recursive field validation, select options,
 * relationship targets, and component references.
 *
 * **Note:** Cross-component validation (circular references, nesting
 * depth, slug conflicts with Collections/Singles) is performed in
 * `defineConfig()`.
 *
 * @example
 * ```typescript
 * import { validateFieldGroupConfig } from 'nextly';
 *
 * const result = validateFieldGroupConfig(config);
 * if (!result.valid) {
 *   result.errors.forEach(err => {
 *     console.error(`[${err.code}] ${err.path}: ${err.message}`);
 *   });
 * }
 * ```
 */
export function validateFieldGroupConfig(
  config: FieldGroupConfig
): FieldGroupValidationResult {
  const errors: FieldGroupValidationError[] = [];
  const errsBase = errors as unknown as BaseValidationError[];

  validateSlugShared(config.slug, errsBase, {
    entityLabel: "Component",
    reservedSlugsSet: RESERVED_COMPONENT_SLUGS_SET,
    sqlKeywordsSet: DEFAULT_SQL_KEYWORDS_SET,
  });

  validateFields(config.fields, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Throws an error if the Component configuration is invalid.
 *
 * Convenience wrapper around {@link validateFieldGroupConfig}.
 */
export function assertValidFieldGroupConfig(config: FieldGroupConfig): void {
  const result = validateFieldGroupConfig(config);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(err => `  - [${err.code}] ${err.path}: ${err.message}`)
      .join("\n");

    throw NextlyError.validation({
      errors: result.errors.map(err => ({
        path: err.path,
        code: err.code,
        message: err.message,
      })),
      logContext: {
        reason: "component-config-invalid",
        slug: config.slug,
        details: errorMessages,
      },
    });
  }
}
