/**
 * Single Configuration Validator
 *
 * Validates a {@link SingleConfig} using the shared base-validator helpers
 * for slug/field-name/relationship/component rules, plus Single-specific
 * access control validation (read/update only, no create/delete).
 *
 * Duplicated validation logic was moved to `src/shared/base-validator.ts`
 * in Plan 23 Phase 8. This file now orchestrates those helpers and keeps
 * only Single-specific rules.
 *
 * @module singles/config/validate-single
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { validateSingleConfig } from '@revnixhq/nextly';
 *
 * const result = validateSingleConfig(config);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */

import { RESERVED_SLUGS } from "../../collections/config/validate-config";
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

import type { SingleConfig } from "./types";

// Re-export constants from collections for external use
export {
  RESERVED_SLUGS,
  SQL_RESERVED_KEYWORDS,
} from "../../collections/config/validate-config";

// ============================================================
// Validation Error Types
// ============================================================

/**
 * Error codes for Single validation failures.
 * Shares most codes with Collection/Component validators.
 */
export type SingleValidationErrorCode =
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
  // Access errors (Single-specific: only read/update)
  | "ACCESS_INVALID_TYPE"
  | "ACCESS_FUNCTION_INVALID";

/**
 * A single validation error with path and context.
 */
export interface SingleValidationError {
  /**
   * Dot-notation path to the invalid property.
   * @example 'slug', 'fields.0.name', 'fields.seo.items.title'
   */
  path: string;

  /** Human-readable error message. */
  message: string;

  /** Machine-readable error code for programmatic handling. */
  code: SingleValidationErrorCode;
}

/**
 * Result of Single config validation.
 */
export interface SingleValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;

  /** Array of validation errors (empty if valid). */
  errors: SingleValidationError[];
}

// ============================================================
// Reserved Names for Singles
// ============================================================

/**
 * Reserved Single slugs that cannot be used.
 *
 * Extends the base RESERVED_SLUGS with Single-specific reserved names.
 * Note: 'globals' is reserved as it's the API endpoint namespace.
 */
export const RESERVED_SINGLE_SLUGS = [
  ...RESERVED_SLUGS,
  // API namespace for Singles
  "globals",
  "global",
] as const;

const RESERVED_SINGLE_SLUGS_SET: Set<string> = new Set<string>(
  RESERVED_SINGLE_SLUGS
);

// ============================================================
// Domain-Specific Validation
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
  errors: SingleValidationError[],
  seenNames: Set<string>
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
  }
}

/**
 * Validate an array of field configurations.
 */
function validateFieldsArray(
  fields: unknown[],
  basePath: string,
  errors: SingleValidationError[]
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
  errors: SingleValidationError[]
): void {
  const path = "fields";

  if (!fields) {
    errors.push({
      path,
      message: "Single fields are required",
      code: "FIELDS_REQUIRED",
    });
    return;
  }

  if (!Array.isArray(fields)) {
    errors.push({
      path,
      message: "Single fields must be an array",
      code: "FIELDS_INVALID_TYPE",
    });
    return;
  }

  // Why: empty fields list is now valid for both code-first defines and the
  // new modal-driven create flow (Builder redesign PR 2/3). System columns
  // are auto-injected at runtime so a "fieldless" Single still has id,
  // title, slug, updatedAt. Devs can scaffold the Single first and add
  // fields incrementally.
  validateFieldsArray(fields, path, errors);
}

/**
 * Validate access control functions.
 *
 * Singles only support `read` and `update` access (no create/delete).
 */
function validateAccess(
  access: unknown,
  errors: SingleValidationError[]
): void {
  if (!access) {
    return; // Access is optional
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
  const validAccessKeys = ["read", "update"] as const;

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
 * Validates a complete Single configuration.
 *
 * Performs comprehensive validation including slug format/reserved names,
 * SQL keyword blocking, recursive field validation, select options,
 * relationship targets, component references, duplicate detection, and
 * Single-specific access control (read/update only).
 *
 * @example
 * ```typescript
 * import { validateSingleConfig } from '@revnixhq/nextly';
 *
 * const result = validateSingleConfig(config);
 * if (!result.valid) {
 *   result.errors.forEach(err => {
 *     console.error(`[${err.code}] ${err.path}: ${err.message}`);
 *   });
 * }
 * ```
 */
export function validateSingleConfig(
  config: SingleConfig
): SingleValidationResult {
  const errors: SingleValidationError[] = [];
  const errsBase = errors as unknown as BaseValidationError[];

  validateSlugShared(config.slug, errsBase, {
    entityLabel: "Single",
    reservedSlugsSet: RESERVED_SINGLE_SLUGS_SET,
    sqlKeywordsSet: DEFAULT_SQL_KEYWORDS_SET,
  });

  validateFields(config.fields, errors);

  validateAccess(config.access, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Throws an error if the Single configuration is invalid.
 *
 * Convenience wrapper around {@link validateSingleConfig}.
 */
export function assertValidSingleConfig(config: SingleConfig): void {
  const result = validateSingleConfig(config);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(err => `  - [${err.code}] ${err.path}: ${err.message}`)
      .join("\n");

    throw new Error(
      `Invalid Single config for '${config.slug || "unknown"}':\n${errorMessages}`
    );
  }
}
