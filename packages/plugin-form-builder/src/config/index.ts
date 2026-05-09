/**
 * Form Configuration Utilities
 *
 * Exports validation, default application, and field helper utilities
 * for form configurations.
 *
 * @module config
 */

// Validation utilities
export {
  validateFormConfig,
  assertValidFormConfig,
  RESERVED_FORM_SLUGS,
  type FormValidationError,
  type FormValidationErrorCode,
  type FormValidationResult,
} from "./validate-form";

// Default application utilities
export {
  applyFormDefaults,
  applyFieldDefaults,
  createFormConfig,
  toTitleCase,
  pluralize,
  DEFAULT_FORM_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
} from "./defaults";

// Field helper utilities
export {
  // Utility helper
  option,
  type FormFieldOption,
  // Text input helpers
  text,
  email,
  phone,
  url,
  textarea,
  // Numeric helpers
  number,
  // Selection helpers
  select,
  checkbox,
  radio,
  // File helpers
  file,
  // Date/time helpers
  date,
  time,
  // Special helpers
  hidden,
} from "./field-helpers";
