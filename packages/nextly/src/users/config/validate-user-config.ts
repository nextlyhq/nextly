/**
 * User Configuration Validator
 *
 * Validates UserConfig objects including:
 * - Field type restrictions (only scalar types allowed)
 * - Field name format and uniqueness
 * - Reserved field name checking (built-in user columns)
 * - SQL keyword blocking
 * - Select/radio option validation
 * - Admin option validation (listFields references)
 *
 * @module users/config/validate-user-config
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { validateUserConfig } from '@nextly/core';
 *
 * const result = validateUserConfig({
 *   fields: [
 *     { type: 'text', name: 'company', label: 'Company' },
 *   ],
 * });
 *
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */

import { SQL_RESERVED_KEYWORDS } from "../../collections/config/validate-config";

import type { UserConfig } from "./types";

// ============================================================
// Validation Error Types
// ============================================================

/**
 * Error codes for user config validation failures.
 */
export type UserValidationErrorCode =
  // Field type errors
  | "USER_FIELD_TYPE_NOT_ALLOWED"
  | "USER_FIELD_TYPE_REQUIRED"
  // Field name errors
  | "USER_FIELD_NAME_REQUIRED"
  | "USER_FIELD_NAME_INVALID_FORMAT"
  | "USER_FIELD_NAME_SQL_KEYWORD"
  | "USER_FIELD_NAME_DUPLICATE"
  | "USER_FIELD_NAME_RESERVED"
  // Field-specific errors
  | "USER_SELECT_OPTIONS_REQUIRED"
  | "USER_SELECT_OPTIONS_EMPTY"
  | "USER_RADIO_OPTIONS_REQUIRED"
  | "USER_RADIO_OPTIONS_EMPTY"
  // Fields array errors
  | "USER_FIELDS_INVALID_TYPE"
  // Admin errors
  | "USER_ADMIN_INVALID_TYPE"
  | "USER_ADMIN_LIST_FIELD_UNKNOWN"
  | "USER_ADMIN_GROUP_INVALID_TYPE";

/**
 * A single user config validation error with path and context.
 */
export interface UserValidationError {
  /** Dot-notation path to the invalid property. */
  path: string;
  /** Human-readable error message. */
  message: string;
  /** Machine-readable error code for programmatic handling. */
  code: UserValidationErrorCode;
}

/**
 * Result of user config validation.
 */
export interface UserValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Array of validation errors (empty if valid). */
  errors: UserValidationError[];
}

// ============================================================
// Constants
// ============================================================

/**
 * Built-in user field names that cannot be used as custom field names.
 * These correspond to columns in the core `users` table.
 */
export const RESERVED_USER_FIELD_NAMES = [
  "id",
  "name",
  "email",
  "emailVerified",
  "passwordHash",
  "passwordUpdatedAt",
  "image",
  "isActive",
  "createdAt",
  "updatedAt",
  "roles",
  "accounts",
  "password",
] as const;

/**
 * Allowed field types for user custom fields.
 * Limited to scalar types — complex types (relationship, array, group, etc.)
 * are not supported in user extension fields.
 */
export const ALLOWED_USER_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "email",
  "select",
  "radio",
  "checkbox",
  "date",
] as const;

/**
 * Set for O(1) lookup of reserved user field names.
 */
const RESERVED_NAMES_SET = new Set<string>(
  RESERVED_USER_FIELD_NAMES.map(n => n.toLowerCase())
);

/**
 * Set for O(1) lookup of allowed user field types.
 */
const ALLOWED_TYPES_SET = new Set<string>(ALLOWED_USER_FIELD_TYPES);

/**
 * Set for O(1) lookup of SQL keywords.
 */
const SQL_KEYWORDS_SET = new Set<string>(SQL_RESERVED_KEYWORDS);

/**
 * Regex pattern for valid field names.
 * Must start with a letter, contain only letters, numbers, and underscores.
 */
const FIELD_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

// ============================================================
// Validation Helper Functions
// ============================================================

/**
 * Checks if a string is a SQL reserved keyword.
 */
function isSQLKeyword(name: string): boolean {
  return SQL_KEYWORDS_SET.has(name.toLowerCase());
}

/**
 * Checks if a field name conflicts with built-in user fields.
 */
function isReservedUserFieldName(name: string): boolean {
  return RESERVED_NAMES_SET.has(name.toLowerCase());
}

/**
 * Validates a single user field's name.
 */
function validateUserFieldName(
  name: unknown,
  path: string,
  errors: UserValidationError[],
  seenNames: Set<string>
): void {
  if (!name) {
    errors.push({
      path: `${path}.name`,
      message: "Field name is required",
      code: "USER_FIELD_NAME_REQUIRED",
    });
    return;
  }

  if (typeof name !== "string") {
    errors.push({
      path: `${path}.name`,
      message: "Field name must be a string",
      code: "USER_FIELD_NAME_REQUIRED",
    });
    return;
  }

  if (!FIELD_NAME_PATTERN.test(name)) {
    errors.push({
      path: `${path}.name`,
      message: `Field name '${name}' must start with a letter and contain only letters, numbers, and underscores`,
      code: "USER_FIELD_NAME_INVALID_FORMAT",
    });
  }

  if (isReservedUserFieldName(name)) {
    errors.push({
      path: `${path}.name`,
      message: `Field name '${name}' conflicts with a built-in user field. Reserved names: ${RESERVED_USER_FIELD_NAMES.join(", ")}`,
      code: "USER_FIELD_NAME_RESERVED",
    });
  }

  if (isSQLKeyword(name)) {
    errors.push({
      path: `${path}.name`,
      message: `Field name '${name}' is a SQL reserved keyword. Consider using a different name like '${name}Field' or '${name}Value'`,
      code: "USER_FIELD_NAME_SQL_KEYWORD",
    });
  }

  const nameLower = name.toLowerCase();
  if (seenNames.has(nameLower)) {
    errors.push({
      path: `${path}.name`,
      message: `Duplicate field name '${name}'`,
      code: "USER_FIELD_NAME_DUPLICATE",
    });
  } else {
    seenNames.add(nameLower);
  }
}

/**
 * Validates that a field's type is in the allowed set.
 */
function validateUserFieldType(
  field: Record<string, unknown>,
  path: string,
  errors: UserValidationError[]
): void {
  const fieldType = field.type;

  if (!fieldType) {
    errors.push({
      path: `${path}.type`,
      message: "Field type is required",
      code: "USER_FIELD_TYPE_REQUIRED",
    });
    return;
  }

  if (typeof fieldType !== "string" || !ALLOWED_TYPES_SET.has(fieldType)) {
    errors.push({
      path: `${path}.type`,
      message: `User custom fields do not support type '${fieldType}'. Allowed types: ${ALLOWED_USER_FIELD_TYPES.join(", ")}`,
      code: "USER_FIELD_TYPE_NOT_ALLOWED",
    });
  }
}

/**
 * Validates select/radio field options.
 */
function validateUserSelectOptions(
  field: Record<string, unknown>,
  path: string,
  errors: UserValidationError[],
  fieldType: "select" | "radio"
): void {
  const options = field.options;

  if (!options) {
    errors.push({
      path: `${path}.options`,
      message: `${fieldType} field must have an 'options' array`,
      code:
        fieldType === "select"
          ? "USER_SELECT_OPTIONS_REQUIRED"
          : "USER_RADIO_OPTIONS_REQUIRED",
    });
    return;
  }

  if (!Array.isArray(options)) {
    errors.push({
      path: `${path}.options`,
      message: `${fieldType} field 'options' must be an array`,
      code:
        fieldType === "select"
          ? "USER_SELECT_OPTIONS_REQUIRED"
          : "USER_RADIO_OPTIONS_REQUIRED",
    });
    return;
  }

  if (options.length === 0) {
    errors.push({
      path: `${path}.options`,
      message: `${fieldType} field must have at least one option`,
      code:
        fieldType === "select"
          ? "USER_SELECT_OPTIONS_EMPTY"
          : "USER_RADIO_OPTIONS_EMPTY",
    });
  }
}

/**
 * Validates the fields array in UserConfig.
 */
function validateUserFields(
  fields: unknown,
  errors: UserValidationError[]
): Set<string> {
  const fieldNames = new Set<string>();

  if (fields === undefined || fields === null) {
    return fieldNames;
  }

  if (!Array.isArray(fields)) {
    errors.push({
      path: "fields",
      message: "User fields must be an array",
      code: "USER_FIELDS_INVALID_TYPE",
    });
    return fieldNames;
  }

  const seenNames = new Set<string>();

  fields.forEach((field, index) => {
    const fieldPath = `fields[${index}]`;

    if (!field || typeof field !== "object") {
      return;
    }

    const f = field as Record<string, unknown>;

    validateUserFieldType(f, fieldPath, errors);
    validateUserFieldName(f.name, fieldPath, errors, seenNames);

    // Field-specific validation
    const fieldType = f.type;
    if (fieldType === "select") {
      validateUserSelectOptions(f, fieldPath, errors, "select");
    } else if (fieldType === "radio") {
      validateUserSelectOptions(f, fieldPath, errors, "radio");
    }

    // Track valid field names for admin.listFields validation
    if (typeof f.name === "string" && FIELD_NAME_PATTERN.test(f.name)) {
      fieldNames.add(f.name);
    }
  });

  return fieldNames;
}

/**
 * Validates the admin options in UserConfig.
 */
function validateAdminOptions(
  admin: unknown,
  fieldNames: Set<string>,
  errors: UserValidationError[]
): void {
  if (admin === undefined || admin === null) {
    return;
  }

  if (typeof admin !== "object" || Array.isArray(admin)) {
    errors.push({
      path: "admin",
      message: "Admin options must be an object",
      code: "USER_ADMIN_INVALID_TYPE",
    });
    return;
  }

  const adminObj = admin as Record<string, unknown>;

  // Validate listFields
  if (adminObj.listFields !== undefined) {
    if (!Array.isArray(adminObj.listFields)) {
      errors.push({
        path: "admin.listFields",
        message: "admin.listFields must be an array of field names",
        code: "USER_ADMIN_INVALID_TYPE",
      });
    } else {
      adminObj.listFields.forEach((ref: unknown, index: number) => {
        if (typeof ref !== "string") {
          errors.push({
            path: `admin.listFields[${index}]`,
            message: "Each listFields entry must be a string",
            code: "USER_ADMIN_LIST_FIELD_UNKNOWN",
          });
        } else if (!fieldNames.has(ref)) {
          const available =
            fieldNames.size > 0
              ? `Available fields: ${Array.from(fieldNames).sort().join(", ")}`
              : "No custom fields defined";
          errors.push({
            path: `admin.listFields[${index}]`,
            message: `Unknown field '${ref}' in admin.listFields. ${available}`,
            code: "USER_ADMIN_LIST_FIELD_UNKNOWN",
          });
        }
      });
    }
  }

  // Validate group
  if (adminObj.group !== undefined && typeof adminObj.group !== "string") {
    errors.push({
      path: "admin.group",
      message: "admin.group must be a string",
      code: "USER_ADMIN_GROUP_INVALID_TYPE",
    });
  }
}

// ============================================================
// Main Validation Functions
// ============================================================

/**
 * Validates a complete user configuration.
 *
 * Performs comprehensive validation including:
 * - Field type restrictions (only scalar types allowed)
 * - Field name format, uniqueness, and reserved name checking
 * - SQL keyword blocking for field names
 * - Select/radio option validation
 * - Admin listFields reference validation
 *
 * @param config - The user configuration to validate
 * @returns Validation result with any errors found
 *
 * @example
 * ```typescript
 * import { validateUserConfig } from '@nextly/core';
 *
 * const result = validateUserConfig({
 *   fields: [
 *     { type: 'text', name: 'company', label: 'Company' },
 *     { type: 'select', name: 'department', label: 'Department', options: [...] },
 *   ],
 *   admin: {
 *     listFields: ['company', 'department'],
 *   },
 * });
 *
 * if (!result.valid) {
 *   result.errors.forEach(err => {
 *     console.error(`[${err.code}] ${err.path}: ${err.message}`);
 *   });
 * }
 * ```
 */
export function validateUserConfig(config: UserConfig): UserValidationResult {
  const errors: UserValidationError[] = [];

  // Validate fields (returns set of valid field names for admin validation)
  const fieldNames = validateUserFields(config.fields, errors);

  // Validate admin options
  validateAdminOptions(config.admin, fieldNames, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Throws an error if the user configuration is invalid.
 *
 * Convenience wrapper around `validateUserConfig` that throws a
 * descriptive error instead of returning a result object.
 *
 * @param config - The user configuration to validate
 * @throws Error if validation fails with all error messages
 *
 * @example
 * ```typescript
 * import { assertValidUserConfig } from '@nextly/core';
 *
 * // Throws if invalid
 * assertValidUserConfig({
 *   fields: [
 *     { type: 'relationship', name: 'manager' }, // throws — type not allowed
 *   ],
 * });
 * ```
 */
export function assertValidUserConfig(config: UserConfig): void {
  const result = validateUserConfig(config);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(err => `  - [${err.code}] ${err.path}: ${err.message}`)
      .join("\n");

    throw new Error(`Invalid user config:\n${errorMessages}`);
  }
}
