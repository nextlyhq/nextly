/**
 * Single Configuration Validator
 *
 * Validates a {@link SingleConfig} using the shared base-validator helpers
 * for slug/field-name/relationship/component rules, plus Single-specific
 * access control validation (read/update only, no create/delete).
 *
 * Duplicated validation logic was moved to `src/shared/base-validator.ts`
 *
 * @module singles/config/validate-single
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { validateSingleConfig } from 'nextly';
 *
 * const result = validateSingleConfig(config);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */

import { RESERVED_SLUGS } from "../../collections/config/validate-config";
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
  // A field named after a column the system injects onto the Single's table.
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
  | "REPEATER_FIELDS_REQUIRED"
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
 * Extends the base RESERVED_SLUGS with every system-resource name. A single
 * named after a system resource seeds `read-<name>` / `update-<name>`, the rows
 * that resource's routes check (a `settings` single reaches the user-fields and
 * component admin surfaces), so it is rejected here at config validation, before
 * any migration or table is built. The system-resource names are added here
 * rather than in the shared base list, which also feeds the component validator
 * where they must not apply.
 */
export const RESERVED_SINGLE_SLUGS = [
  ...RESERVED_SLUGS,
  ...SYSTEM_RESOURCES,
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

  // Plugin types are accepted only when they opted into the entries surface —
  // registration alone is not authorization for a single field.
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
      const repeaterFields = f.fields;
      if (!repeaterFields) {
        errors.push({
          path: `${path}.fields`,
          message: "Repeater field must have a 'fields' array",
          code: "REPEATER_FIELDS_REQUIRED",
        });
      } else if (Array.isArray(repeaterFields)) {
        validateFieldsArray(repeaterFields, `${path}.fields`, errors);
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
    case "fieldGroup":
      // The migrated spelling follows the same reference rule for singles.
      validateComponentFieldRefShared(f, path, errsBase);
      break;

    case "number":
      validateNumberDecimalDimensionsShared(f, path, errsBase);
      break;
  }
}

// System columns injected onto a Single's table, under both the snake_case name
// and the camelCase alias that snake-cases to the same column. A Single gets no
// owner column, so unlike a collection only the first-publication marker is
// reserved here — which is why this check had to be added rather than extended:
// until the marker reached a Single's table there was nothing to collide with.

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
  errors: SingleValidationError[],
  lifecycleEnabled = false
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

  // Block the injected system columns at the top level, before per-field
  // validation. Reserved even when the draft/publish lifecycle is off, so
  // enabling it later fails here rather than at migration time. Nested
  // repeater/group fields live inside JSON and are exempt, as for collections.
  //
  // Ownership is GLOBAL, not per table. Two names that reach one column are refused even when the
  // generators would put them in different tables — a shared `foo_bar` beside a localized
  // `FooBar`. Physical separation does not keep the two values apart, because the write path
  // normalizes payload keys through the same conversion BEFORE it splits localized fields off, so
  // both keys land on `foo_bar` and the second silently overwrites the first. One of the two
  // authored values is already gone by the time anything decides which table it belongs to.
  const columnOwners = new Map<string, string>();
  fields.forEach((field, index) => {
    if (!field || typeof field !== "object") return;
    const candidate = field as Record<string, unknown>;
    const name = candidate.name;
    if (typeof name !== "string") return;
    const column = toSnakeCase(name);
    if (isReservedSystemColumn(column, "singleConfig")) {
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
    if (!fieldProducesColumn(candidate)) return;
    // A field may take over `title` or `slug` — the documented "user wins" behaviour — but only
    // under the column's own name. `Title` reaches the same column while staying a different
    // identity everywhere the declared name is the key, so the two would write one column under
    // two names and the generated value would overwrite the author's.
    if (column !== name && isOwnableSystemColumn(column, "single")) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' becomes the system column '${column}'. Name the field '${column}' to replace that column, or choose a different name`,
        code: "FIELD_NAME_SYSTEM_ALIAS",
      });
      return;
    }
    // The Draft/Published lifecycle owns its columns outright, so any name reaching them is a
    // collision rather than a takeover. Only when the lifecycle is on — with it off these are
    // ordinary names.
    if (lifecycleEnabled && isLifecycleSystemColumn(column, "single")) {
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
 * import { validateSingleConfig } from 'nextly';
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
    reservedSlugNotes: NEWLY_RESERVED_SLUG_NOTES,
    sqlKeywordsSet: DEFAULT_SQL_KEYWORDS_SET,
  });

  validateFields(
    config.fields,
    errors,
    (config as { status?: boolean }).status === true
  );

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
