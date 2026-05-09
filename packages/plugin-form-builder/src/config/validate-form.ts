/**
 * Form Configuration Validator
 *
 * Provides comprehensive validation for form configurations including:
 * - Slug validation (format, reserved names)
 * - Field name validation (format, duplicates)
 * - Field-specific validation (select/radio options, min/max constraints)
 * - Conditional logic validation
 * - Nested field validation
 *
 * @module config/validate-form
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { validateFormConfig } from '@nextly/plugin-form-builder';
 *
 * const result = validateFormConfig(config);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */

import type { FormConfig, FormField, FormFieldType } from "../types";

// ============================================================
// Validation Error Types
// ============================================================

/**
 * Error codes for form validation failures.
 * Used for programmatic error handling.
 */
export type FormValidationErrorCode =
  // Slug errors
  | "SLUG_REQUIRED"
  | "SLUG_INVALID_TYPE"
  | "SLUG_TOO_SHORT"
  | "SLUG_TOO_LONG"
  | "SLUG_INVALID_FORMAT"
  | "SLUG_RESERVED"
  // Field errors
  | "FIELDS_REQUIRED"
  | "FIELDS_INVALID_TYPE"
  | "FIELDS_EMPTY"
  | "FIELD_NAME_REQUIRED"
  | "FIELD_NAME_INVALID_FORMAT"
  | "FIELD_NAME_DUPLICATE"
  | "FIELD_TYPE_REQUIRED"
  | "FIELD_TYPE_INVALID"
  | "FIELD_LABEL_REQUIRED"
  // Field-specific errors
  | "OPTIONS_REQUIRED"
  | "OPTIONS_EMPTY"
  | "MIN_GREATER_THAN_MAX"
  | "MIN_LENGTH_GREATER_THAN_MAX"
  | "FILE_MAX_SIZE_INVALID"
  // Conditional logic errors
  | "CONDITIONS_REQUIRED"
  | "CONDITION_FIELD_REQUIRED"
  | "CONDITION_COMPARISON_REQUIRED"
  // Settings errors
  | "SETTINGS_INVALID_TYPE"
  | "REDIRECT_URL_REQUIRED"
  // Access errors
  | "ACCESS_INVALID_TYPE"
  | "ACCESS_FUNCTION_INVALID";

/**
 * A single validation error with path and context.
 *
 * @example
 * ```typescript
 * const error: FormValidationError = {
 *   path: 'fields.email.validation',
 *   message: "Min length cannot be greater than max length",
 *   code: 'MIN_LENGTH_GREATER_THAN_MAX',
 * };
 * ```
 */
export interface FormValidationError {
  /**
   * Dot-notation path to the invalid property.
   * @example 'slug', 'fields.0.name', 'fields.email.options'
   */
  path: string;

  /**
   * Human-readable error message.
   */
  message: string;

  /**
   * Machine-readable error code for programmatic handling.
   */
  code: FormValidationErrorCode;
}

/**
 * Result of form config validation.
 */
export interface FormValidationResult {
  /**
   * Whether the configuration is valid.
   */
  valid: boolean;

  /**
   * Array of validation errors (empty if valid).
   */
  errors: FormValidationError[];
}

// ============================================================
// Reserved Names
// ============================================================

/**
 * Reserved form slugs that cannot be used.
 * These are used by the system or have special meaning.
 */
export const RESERVED_FORM_SLUGS = [
  // API routes
  "api",
  "submit",
  "submissions",
  "export",
  // System slugs
  "admin",
  "new",
  "create",
  "edit",
  "delete",
] as const;

/**
 * Set for O(1) lookup of reserved slugs.
 */
const RESERVED_SLUGS_SET = new Set<string>(RESERVED_FORM_SLUGS);

// ============================================================
// Validation Patterns
// ============================================================

/**
 * Regex pattern for valid form slugs.
 * Must start with a lowercase letter, contain only lowercase letters,
 * numbers, hyphens, and underscores. Length: 1-50 chars.
 * Allows hyphens for URL-friendly slugs (e.g., 'contact-form').
 */
const SLUG_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Regex pattern for valid field names.
 * Must start with a letter (upper or lower), contain only letters,
 * numbers, and underscores. Supports camelCase (e.g., 'firstName').
 */
const FIELD_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * All valid form field types.
 */
const VALID_FIELD_TYPES: FormFieldType[] = [
  "text",
  "email",
  "number",
  "phone",
  "url",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "file",
  "date",
  "time",
  "hidden",
];

const VALID_FIELD_TYPES_SET = new Set<string>(VALID_FIELD_TYPES);

// ============================================================
// Validation Helper Functions
// ============================================================

/**
 * Checks if a string is a reserved form slug.
 */
function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS_SET.has(slug.toLowerCase());
}

/**
 * Validates a form slug.
 */
function validateSlug(slug: unknown, errors: FormValidationError[]): void {
  const path = "slug";

  if (!slug) {
    errors.push({
      path,
      message: "Form slug is required",
      code: "SLUG_REQUIRED",
    });
    return;
  }

  if (typeof slug !== "string") {
    errors.push({
      path,
      message: "Form slug must be a string",
      code: "SLUG_INVALID_TYPE",
    });
    return;
  }

  if (slug.length < 1) {
    errors.push({
      path,
      message: "Form slug must be at least 1 character",
      code: "SLUG_TOO_SHORT",
    });
  }

  if (slug.length > 50) {
    errors.push({
      path,
      message: "Form slug must be at most 50 characters",
      code: "SLUG_TOO_LONG",
    });
  }

  if (!SLUG_PATTERN.test(slug)) {
    errors.push({
      path,
      message:
        "Form slug must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, and underscores",
      code: "SLUG_INVALID_FORMAT",
    });
  }

  if (isReservedSlug(slug)) {
    errors.push({
      path,
      message: `Form slug '${slug}' is reserved and cannot be used`,
      code: "SLUG_RESERVED",
    });
  }
}

/**
 * Validates a single field name.
 */
function validateFieldName(
  name: unknown,
  path: string,
  errors: FormValidationError[],
  seenNames: Set<string>
): void {
  if (!name) {
    errors.push({
      path: `${path}.name`,
      message: "Field name is required",
      code: "FIELD_NAME_REQUIRED",
    });
    return;
  }

  if (typeof name !== "string") {
    errors.push({
      path: `${path}.name`,
      message: "Field name must be a string",
      code: "FIELD_NAME_REQUIRED",
    });
    return;
  }

  if (!FIELD_NAME_PATTERN.test(name)) {
    errors.push({
      path: `${path}.name`,
      message: `Field name '${name}' must start with a letter and contain only letters, numbers, and underscores`,
      code: "FIELD_NAME_INVALID_FORMAT",
    });
  }

  // Check for duplicates at this level
  const nameLower = name.toLowerCase();
  if (seenNames.has(nameLower)) {
    errors.push({
      path: `${path}.name`,
      message: `Duplicate field name '${name}'`,
      code: "FIELD_NAME_DUPLICATE",
    });
  } else {
    seenNames.add(nameLower);
  }
}

/**
 * Validates a single field label.
 */
function validateFieldLabel(
  label: unknown,
  path: string,
  errors: FormValidationError[]
): void {
  if (!label || (typeof label === "string" && label.trim() === "")) {
    errors.push({
      path: `${path}.label`,
      message: "Field label is required",
      code: "FIELD_LABEL_REQUIRED",
    });
  }
}

/**
 * Validates select/radio/checkbox-group field options.
 */
function validateOptions(
  field: FormField,
  path: string,
  errors: FormValidationError[]
): void {
  // Type assertion for fields with options
  const fieldWithOptions = field as {
    options?: Array<{ label: string; value: string }>;
  };
  const options = fieldWithOptions.options;

  if (!options) {
    errors.push({
      path: `${path}.options`,
      message: `${field.type} field must have an 'options' array`,
      code: "OPTIONS_REQUIRED",
    });
    return;
  }

  if (!Array.isArray(options)) {
    errors.push({
      path: `${path}.options`,
      message: `${field.type} field 'options' must be an array`,
      code: "OPTIONS_REQUIRED",
    });
    return;
  }

  if (options.length === 0) {
    errors.push({
      path: `${path}.options`,
      message: `${field.type} field must have at least one option`,
      code: "OPTIONS_EMPTY",
    });
  }
}

/**
 * Validates conditional logic configuration.
 */
function validateConditionalLogic(
  field: FormField,
  path: string,
  errors: FormValidationError[]
): void {
  const { conditionalLogic } = field;

  if (!conditionalLogic || !conditionalLogic.enabled) {
    return;
  }

  if (
    !conditionalLogic.conditions ||
    conditionalLogic.conditions.length === 0
  ) {
    errors.push({
      path: `${path}.conditionalLogic.conditions`,
      message: "Conditional logic must have at least one condition",
      code: "CONDITIONS_REQUIRED",
    });
    return;
  }

  conditionalLogic.conditions.forEach((condition, index) => {
    const conditionPath = `${path}.conditionalLogic.conditions[${index}]`;

    if (!condition.field) {
      errors.push({
        path: `${conditionPath}.field`,
        message: "Condition must specify a field name",
        code: "CONDITION_FIELD_REQUIRED",
      });
    }

    if (!condition.comparison) {
      errors.push({
        path: `${conditionPath}.comparison`,
        message: "Condition must specify a comparison operator",
        code: "CONDITION_COMPARISON_REQUIRED",
      });
    }
  });
}

/**
 * Validates field based on its type.
 */
function validateFieldByType(
  field: FormField,
  path: string,
  errors: FormValidationError[]
): void {
  switch (field.type) {
    case "select":
    case "radio":
      validateOptions(field, path, errors);
      break;

    case "number": {
      const numberField = field;
      if (numberField.validation) {
        const { min, max } = numberField.validation;
        if (min !== undefined && max !== undefined && min > max) {
          errors.push({
            path: `${path}.validation`,
            message: "Min value cannot be greater than max value",
            code: "MIN_GREATER_THAN_MAX",
          });
        }
      }
      break;
    }

    case "text":
    case "textarea": {
      const textField = field;
      if (textField.validation) {
        const { minLength, maxLength } = textField.validation;
        if (
          minLength !== undefined &&
          maxLength !== undefined &&
          minLength > maxLength
        ) {
          errors.push({
            path: `${path}.validation`,
            message: "Min length cannot be greater than max length",
            code: "MIN_LENGTH_GREATER_THAN_MAX",
          });
        }
      }
      break;
    }

    case "file": {
      const fileField = field;
      if (fileField.maxFileSize !== undefined && fileField.maxFileSize <= 0) {
        errors.push({
          path: `${path}.maxFileSize`,
          message: "File maxFileSize must be a positive number",
          code: "FILE_MAX_SIZE_INVALID",
        });
      }
      break;
    }
  }
}

/**
 * Validates a single field configuration.
 */
function validateField(
  field: unknown,
  path: string,
  errors: FormValidationError[],
  seenNames: Set<string>
): void {
  if (!field || typeof field !== "object") {
    return;
  }

  const f = field as Record<string, unknown>;

  // Validate field type
  const fieldType = f.type;
  if (!fieldType) {
    errors.push({
      path: `${path}.type`,
      message: "Field type is required",
      code: "FIELD_TYPE_REQUIRED",
    });
    return;
  }

  if (typeof fieldType !== "string" || !VALID_FIELD_TYPES_SET.has(fieldType)) {
    let fieldTypeRepr: string;
    if (typeof fieldType === "object" && fieldType !== null) {
      fieldTypeRepr = JSON.stringify(fieldType);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- fieldType narrowed to primitive above; rule doesn't follow control flow on unknown
      fieldTypeRepr = String(fieldType);
    }
    errors.push({
      path: `${path}.type`,
      message: `Invalid field type '${fieldTypeRepr}'. Valid types: ${VALID_FIELD_TYPES.join(", ")}`,
      code: "FIELD_TYPE_INVALID",
    });
    return;
  }

  validateFieldName(f.name, path, errors, seenNames);

  // All fields except hidden require a label
  if (fieldType !== "hidden") {
    validateFieldLabel(f.label, path, errors);
  }

  // Type-specific validation
  validateFieldByType(field as FormField, path, errors);

  // Validate conditional logic if present
  if (f.conditionalLogic) {
    validateConditionalLogic(field as FormField, path, errors);
  }
}

/**
 * Validates an array of field configurations.
 */
function validateFieldsArray(
  fields: unknown[],
  basePath: string,
  errors: FormValidationError[]
): void {
  // Track field names for duplicate detection
  const seenNames = new Set<string>();

  fields.forEach((field, index) => {
    const fieldPath = `${basePath}[${index}]`;
    validateField(field, fieldPath, errors, seenNames);
  });
}

/**
 * Validates the top-level fields array.
 */
function validateFields(fields: unknown, errors: FormValidationError[]): void {
  const path = "fields";

  if (!fields) {
    errors.push({
      path,
      message: "Form must have at least one field",
      code: "FIELDS_REQUIRED",
    });
    return;
  }

  if (!Array.isArray(fields)) {
    errors.push({
      path,
      message: "Form fields must be an array",
      code: "FIELDS_INVALID_TYPE",
    });
    return;
  }

  if (fields.length === 0) {
    errors.push({
      path,
      message: "Form must have at least one field",
      code: "FIELDS_EMPTY",
    });
    return;
  }

  validateFieldsArray(fields, path, errors);
}

/**
 * Validates form settings.
 */
function validateSettings(
  settings: unknown,
  errors: FormValidationError[]
): void {
  if (!settings) {
    return; // Settings are optional
  }

  if (typeof settings !== "object" || Array.isArray(settings)) {
    errors.push({
      path: "settings",
      message: "Form settings must be an object",
      code: "SETTINGS_INVALID_TYPE",
    });
    return;
  }

  const s = settings as Record<string, unknown>;

  // If confirmationType is "redirect", redirectUrl or redirectRelation is required
  if (s.confirmationType === "redirect") {
    if (!s.redirectUrl && !s.redirectRelation) {
      errors.push({
        path: "settings.redirectUrl",
        message:
          "Redirect URL or redirect relation is required when confirmation type is 'redirect'",
        code: "REDIRECT_URL_REQUIRED",
      });
    }
  }
}

/**
 * Validates form access control.
 */
function validateAccess(access: unknown, errors: FormValidationError[]): void {
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
  const validAccessKeys = ["submit", "read"];

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
 * Validates a complete form configuration.
 *
 * This is the main entry point for form validation. It performs
 * comprehensive validation including:
 * - Slug format and reserved name checking
 * - Field name validation
 * - Field-specific validation (options, min/max, etc.)
 * - Duplicate field name detection
 * - Conditional logic validation
 * - Settings validation
 * - Access function type validation
 *
 * @param config - The form configuration to validate
 * @returns Validation result with any errors found
 *
 * @example
 * ```typescript
 * import { validateFormConfig } from '@nextly/plugin-form-builder';
 *
 * const config = {
 *   slug: 'contact-form',
 *   fields: [
 *     { type: 'text', name: 'firstName', label: 'First Name' },
 *     { type: 'email', name: 'email', label: 'Email', required: true },
 *   ],
 * };
 *
 * const result = validateFormConfig(config);
 *
 * if (!result.valid) {
 *   result.errors.forEach(err => {
 *     console.error(`[${err.code}] ${err.path}: ${err.message}`);
 *   });
 * }
 * ```
 */
export function validateFormConfig(config: FormConfig): FormValidationResult {
  const errors: FormValidationError[] = [];

  // Validate slug
  validateSlug(config.slug, errors);

  // Validate fields
  validateFields(config.fields, errors);

  // Validate settings
  validateSettings(config.settings, errors);

  // Validate access control
  validateAccess(config.access, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Throws an error if the form configuration is invalid.
 *
 * This is a convenience wrapper around `validateFormConfig` that
 * throws a descriptive error instead of returning a result object.
 *
 * @param config - The form configuration to validate
 * @throws Error if validation fails with all error messages
 *
 * @example
 * ```typescript
 * import { assertValidFormConfig } from '@nextly/plugin-form-builder';
 *
 * // Throws if invalid
 * assertValidFormConfig(config);
 * ```
 */
export function assertValidFormConfig(config: FormConfig): void {
  const result = validateFormConfig(config);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(err => `  - [${err.code}] ${err.path}: ${err.message}`)
      .join("\n");

    throw new Error(
      `Invalid form config for '${config.slug || "unknown"}':\n${errorMessages}`
    );
  }
}
