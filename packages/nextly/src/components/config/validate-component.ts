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
 * This file now orchestrates those helpers and keeps
 * only Component-specific error types and reserved slug constants.
 *
 * @module components/config/validate-component
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { validateComponentConfig } from 'nextly';
 *
 * const result = validateComponentConfig(config);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */

import { RESERVED_SLUGS } from "../../collections/config/validate-config";
import { isPluginFieldTypeOnSurface } from "../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../errors";
import { CORE_TABLE_NAMES } from "../../schemas/index";
import {
  type BaseValidationError,
  DEFAULT_SQL_KEYWORDS_SET,
  validateComponentFieldRefShared,
  validateFieldNameShared,
  validateFieldTypeShared,
  validateNumberDecimalDimensionsShared,
  validateRelationshipTargetShared,
  validateBlocksDefaultShared,
  validateBlocksPolicyShared,
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
  // Custom table-name errors
  | "DB_NAME_INVALID_TYPE"
  | "DB_NAME_RESERVED"
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

  // Plugin types are accepted only when they opted into the entries surface —
  // registration alone is not authorization for a component field.
  if (
    !validateFieldTypeShared(f.type, path, errsBase, type =>
      isPluginFieldTypeOnSurface(type, "entries")
    )
  ) {
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

    case "blocks":
      // A blocks default must satisfy the same field policy the write applies.
      validateBlocksPolicyShared(f, path, errsBase);
      validateBlocksDefaultShared(f, path, errsBase);
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
 * Validates a custom physical table name.
 *
 * A component's `dbName` is honored verbatim, so an unchecked value can name a
 * table this component does not own. Pointing the registry at a framework or
 * another entity's table would make unrelated rows look like component
 * instances, and an entity delete would sweep them.
 */
/** Prefixes owned by other entity kinds, which a component may never claim. */
const ENTITY_TABLE_PREFIXES = ["dc_", "single_"] as const;

export function assertOwnableComponentTable(
  slug: string,
  tableName: string
): void {
  const errors: ComponentValidationError[] = [];
  validateDbName(tableName, errors);
  if (errors.length === 0) return;

  throw NextlyError.validation({
    errors: errors.map(err => ({
      path: err.path,
      code: err.code,
      message: err.message,
    })),
    logContext: {
      reason: "component-table-not-ownable",
      slug,
      tableName,
    },
  });
}

function validateDbName(
  dbName: unknown,
  errors: ComponentValidationError[]
): void {
  if (dbName === undefined) return;

  if (typeof dbName !== "string" || dbName.trim() === "") {
    errors.push({
      path: "dbName",
      message: "dbName must be a non-empty string when provided.",
      code: "DB_NAME_INVALID_TYPE",
    });
    return;
  }

  // Compared with surrounding whitespace stripped and case folded: SQLite, and
  // MySQL on a case-insensitive installation, resolve `DYNAMIC_COMPONENTS` and
  // `dynamic_components` to the same physical table, and MySQL discards
  // trailing identifier spaces, so either variant would otherwise slip past and
  // let a later drop reach core storage.
  const normalized = dbName.trim().toLowerCase();

  // Only names belonging to a different OWNER are rejected: framework core
  // tables, and the namespaces of other entity kinds. The component namespace
  // is deliberately not policed here — `comp_site_seo` is a documented custom
  // name, and whether some other component generates the same table is a
  // cross-config question this single-config check cannot answer.
  // `comp_*_locales` is how a localization companion is recognised, so a main
  // table wearing that shape would be classified as one and pruned as an
  // orphaned companion whenever its supposed parent is absent.
  const looksLikeCompanion =
    normalized.startsWith("comp_") && normalized.endsWith("_locales");

  const collides =
    CORE_TABLE_NAMES.some(name => name.toLowerCase() === normalized) ||
    ENTITY_TABLE_PREFIXES.some(prefix => normalized.startsWith(prefix)) ||
    looksLikeCompanion;

  if (collides) {
    errors.push({
      path: "dbName",
      message: `dbName '${dbName}' names framework-managed storage. Choose a name outside the reserved tables and prefixes.`,
      code: "DB_NAME_RESERVED",
    });
  }
}

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
 * import { validateComponentConfig } from 'nextly';
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

  validateDbName(config.dbName, errors);

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
