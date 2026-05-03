/**
 * Component Configuration Validator
 *
 * Validates a {@link ComponentConfig} using shared base-validator helpers
 * for slug/field-name/relationship/component rules. Components do not have
 * domain-specific access rules or index validation; cross-component
 * checks (circular references, nesting depth) run at `defineConfig()` time
 * when all component definitions are available.
 *
 * Duplicated validation logic was moved to `src/shared/base-validator.ts`
 * in Plan 23 Phase 8. This file now orchestrates those helpers and keeps
 * only Component-specific error types and reserved slug constants.
 *
 * @module components/config/validate-component
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { validateComponentConfig } from '@revnixhq/nextly';
 *
 * const result = validateComponentConfig(config);
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

import type { ComponentConfig } from "./types";

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
export const MAX_COMPONENT_NESTING_DEPTH = 3;

// ============================================================
// Validation Error Types
// ============================================================

/**
 * Error codes for Component validation failures.
 */
export type ComponentValidationErrorCode =
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
  // Component field errors
  | "COMPONENT_REF_REQUIRED"
  | "COMPONENT_REF_CONFLICT"
  | "COMPONENT_REF_INVALID"
  | "COMPONENT_REF_EMPTY";

/**
 * A single validation error with path and context.
 */
export interface ComponentValidationError {
  /**
   * Dot-notation path to the invalid property.
   * @example 'slug', 'fields.0.name', 'fields.seo.component'
   */
  path: string;

  /** Human-readable error message. */
  message: string;

  /** Machine-readable error code for programmatic handling. */
  code: ComponentValidationErrorCode;
}

/**
 * Result of Component config validation.
 */
export interface ComponentValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;

  /** Array of validation errors (empty if valid). */
  errors: ComponentValidationError[];
}

// ============================================================
// Reserved Names for Components
// ============================================================

/**
 * Reserved Component slugs that cannot be used.
 *
 * Extends the base RESERVED_SLUGS with Component-specific reserved names.
 */
export const RESERVED_COMPONENT_SLUGS = [
  ...RESERVED_SLUGS,
  // API namespace for Components
  "components",
  "component",
] as const;

const RESERVED_COMPONENT_SLUGS_SET: Set<string> = new Set<string>(
  RESERVED_COMPONENT_SLUGS
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
  errors: ComponentValidationError[],
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
  errors: ComponentValidationError[]
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
  errors: ComponentValidationError[]
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

  // Why: empty fields list is now valid for both code-first defines and
  // the new modal-driven create flow (Builder redesign PR 2/3). System
  // columns are auto-injected at runtime so a "fieldless" Component
  // still has id, title, slug. Devs can scaffold first and add fields
  // incrementally.
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
 * import { validateComponentConfig } from '@revnixhq/nextly';
 *
 * const result = validateComponentConfig(config);
 * if (!result.valid) {
 *   result.errors.forEach(err => {
 *     console.error(`[${err.code}] ${err.path}: ${err.message}`);
 *   });
 * }
 * ```
 */
export function validateComponentConfig(
  config: ComponentConfig
): ComponentValidationResult {
  const errors: ComponentValidationError[] = [];
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
 * Convenience wrapper around {@link validateComponentConfig}.
 */
export function assertValidComponentConfig(config: ComponentConfig): void {
  const result = validateComponentConfig(config);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(err => `  - [${err.code}] ${err.path}: ${err.message}`)
      .join("\n");

    throw new Error(
      `Invalid Component config for '${config.slug || "unknown"}':\n${errorMessages}`
    );
  }
}
