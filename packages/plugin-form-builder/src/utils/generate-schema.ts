/**
 * Dynamic Zod Schema Generator
 *
 * Converts FormField[] configuration to Zod validation schemas.
 * Supports all form field types with proper validation rules.
 *
 * @module utils/generate-schema
 * @since 0.1.0
 */

import { z } from "zod";

import type {
  FormField,
  TextFormField,
  EmailFormField,
  NumberFormField,
  PhoneFormField,
  UrlFormField,
  TextareaFormField,
  SelectFormField,
  CheckboxFormField,
  RadioFormField,
  FileFormField,
  DateFormField,
  TimeFormField,
  HiddenFormField,
} from "../types";

// ============================================================
// Main Schema Generator
// ============================================================

/**
 * Generate a Zod validation schema from form field configuration.
 *
 * Creates a dynamic Zod schema based on the form fields array,
 * applying appropriate validation rules for each field type.
 *
 * @param fields - Array of form field configurations
 * @returns Zod object schema for validating submission data
 *
 * @example
 * ```typescript
 * const fields: FormField[] = [
 *   { type: 'text', name: 'firstName', label: 'First Name', required: true },
 *   { type: 'email', name: 'email', label: 'Email', required: true },
 *   { type: 'number', name: 'age', label: 'Age', validation: { min: 18, max: 120 } },
 * ];
 *
 * const schema = generateZodSchema(fields);
 * const result = schema.safeParse({ firstName: 'John', email: 'john@example.com', age: 25 });
 * ```
 */
export function generateZodSchema(
  fields: FormField[]
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const schemaShape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    // Skip hidden fields without required flag
    if (field.type === "hidden" && !field.required) {
      // Still add to schema but make optional
      schemaShape[field.name] = z.string().optional();
      continue;
    }

    const fieldSchema = generateFieldSchema(field);
    if (fieldSchema) {
      schemaShape[field.name] = fieldSchema;
    }
  }

  return z.object(schemaShape);
}

// ============================================================
// Field Schema Generators
// ============================================================

/**
 * Generate a Zod schema for a single field.
 */
function generateFieldSchema(field: FormField): z.ZodTypeAny | null {
  switch (field.type) {
    case "text":
      return generateTextSchema(field);
    case "email":
      return generateEmailSchema(field);
    case "number":
      return generateNumberSchema(field);
    case "phone":
      return generatePhoneSchema(field);
    case "url":
      return generateUrlSchema(field);
    case "textarea":
      return generateTextareaSchema(field);
    case "select":
      return generateSelectSchema(field);
    case "checkbox":
      return generateCheckboxSchema(field);
    case "radio":
      return generateRadioSchema(field);
    case "file":
      return generateFileSchema(field);
    case "date":
      return generateDateSchema(field);
    case "time":
      return generateTimeSchema(field);
    case "hidden":
      return generateHiddenSchema(field);
    default:
      // Unknown field type - accept any value
      return z.unknown();
  }
}

/**
 * Generate schema for text field.
 */
function generateTextSchema(field: TextFormField): z.ZodTypeAny {
  let schema = z.string();

  // Apply validation rules
  if (field.validation?.minLength !== undefined) {
    schema = schema.min(
      field.validation.minLength,
      field.validation.errorMessage ||
        `Minimum ${field.validation.minLength} characters required`
    );
  }

  if (field.validation?.maxLength !== undefined) {
    schema = schema.max(
      field.validation.maxLength,
      field.validation.errorMessage ||
        `Maximum ${field.validation.maxLength} characters allowed`
    );
  }

  if (field.validation?.pattern) {
    schema = schema.regex(
      new RegExp(field.validation.pattern),
      field.validation.errorMessage || "Invalid format"
    );
  }

  return applyRequired(schema, field.required, field.validation?.errorMessage);
}

/**
 * Generate schema for email field.
 */
function generateEmailSchema(field: EmailFormField): z.ZodTypeAny {
  let schema = z
    .string()
    .email(field.validation?.errorMessage || "Invalid email address");

  if (field.validation?.pattern) {
    schema = schema.regex(
      new RegExp(field.validation.pattern),
      field.validation.errorMessage || "Invalid email format"
    );
  }

  return applyRequired(schema, field.required, field.validation?.errorMessage);
}

/**
 * Generate schema for number field.
 */
function generateNumberSchema(field: NumberFormField): z.ZodTypeAny {
  let schema = z.number({
    required_error: field.validation?.errorMessage || "This field is required",
    invalid_type_error: "Must be a number",
  });

  if (field.validation?.min !== undefined) {
    schema = schema.min(
      field.validation.min,
      field.validation.errorMessage ||
        `Minimum value is ${field.validation.min}`
    );
  }

  if (field.validation?.max !== undefined) {
    schema = schema.max(
      field.validation.max,
      field.validation.errorMessage ||
        `Maximum value is ${field.validation.max}`
    );
  }

  if (field.required) {
    return schema;
  }

  return schema.optional().nullable();
}

/**
 * Generate schema for phone field.
 */
function generatePhoneSchema(field: PhoneFormField): z.ZodTypeAny {
  let schema = z.string();

  if (field.validation?.pattern) {
    schema = schema.regex(
      new RegExp(field.validation.pattern),
      field.validation.errorMessage || "Invalid phone number format"
    );
  } else {
    // Default phone pattern - allows common formats
    schema = schema.regex(
      /^[\d\s\-+()]+$/,
      field.validation?.errorMessage || "Invalid phone number"
    );
  }

  return applyRequired(schema, field.required, field.validation?.errorMessage);
}

/**
 * Generate schema for URL field.
 */
function generateUrlSchema(field: UrlFormField): z.ZodTypeAny {
  let schema = z.string().url(field.validation?.errorMessage || "Invalid URL");

  if (field.validation?.pattern) {
    schema = schema.regex(
      new RegExp(field.validation.pattern),
      field.validation.errorMessage || "Invalid URL format"
    );
  }

  return applyRequired(schema, field.required, field.validation?.errorMessage);
}

/**
 * Generate schema for textarea field.
 */
function generateTextareaSchema(field: TextareaFormField): z.ZodTypeAny {
  let schema = z.string();

  if (field.validation?.minLength !== undefined) {
    schema = schema.min(
      field.validation.minLength,
      field.validation.errorMessage ||
        `Minimum ${field.validation.minLength} characters required`
    );
  }

  if (field.validation?.maxLength !== undefined) {
    schema = schema.max(
      field.validation.maxLength,
      field.validation.errorMessage ||
        `Maximum ${field.validation.maxLength} characters allowed`
    );
  }

  return applyRequired(schema, field.required, field.validation?.errorMessage);
}

/**
 * Generate schema for select field.
 */
function generateSelectSchema(field: SelectFormField): z.ZodTypeAny {
  const validValues = field.options.map(opt => opt.value);

  if (field.allowMultiple) {
    // Multi-select: array of valid values
    const schema = z.array(z.enum(validValues as [string, ...string[]]));

    if (field.required) {
      return schema.min(
        1,
        field.validation?.errorMessage || "Please select at least one option"
      );
    }

    return schema.optional();
  }

  // Single select
  const schema = z.enum(validValues as [string, ...string[]], {
    errorMap: () => ({
      message: field.validation?.errorMessage || "Please select a valid option",
    }),
  });

  if (field.required) {
    return schema;
  }

  return schema.optional();
}

/**
 * Generate schema for checkbox field.
 */
function generateCheckboxSchema(field: CheckboxFormField): z.ZodTypeAny {
  const schema = z.boolean();

  if (field.required) {
    // For required checkbox, value must be true
    return schema.refine(val => val === true, {
      message: field.validation?.errorMessage || "This field is required",
    });
  }

  return schema.optional();
}

/**
 * Generate schema for radio field.
 */
function generateRadioSchema(field: RadioFormField): z.ZodTypeAny {
  const validValues = field.options.map(opt => opt.value);

  const schema = z.enum(validValues as [string, ...string[]], {
    errorMap: () => ({
      message: field.validation?.errorMessage || "Please select an option",
    }),
  });

  if (field.required) {
    return schema;
  }

  return schema.optional();
}

/**
 * Generate schema for file field.
 *
 * Note: File validation is typically handled server-side.
 * This schema validates file references (IDs or URLs).
 */
function generateFileSchema(field: FileFormField): z.ZodTypeAny {
  if (field.multiple) {
    const schema = z.array(z.string());

    if (field.required) {
      return schema.min(
        1,
        field.validation?.errorMessage || "Please upload at least one file"
      );
    }

    return schema.optional();
  }

  // Single file
  const schema = z.string();
  return applyRequired(schema, field.required, field.validation?.errorMessage);
}

/**
 * Generate schema for date field.
 */
function generateDateSchema(field: DateFormField): z.ZodTypeAny {
  // Start with base string schema
  let schema: z.ZodTypeAny = z.string();

  // Add date format validation
  schema = (schema as z.ZodString).refine(
    val => {
      if (!val) return true; // Allow empty for optional fields
      const date = new Date(val);
      return !isNaN(date.getTime());
    },
    { message: field.validation?.errorMessage || "Invalid date" }
  );

  // Min/max date validation
  if (field.min || field.max) {
    schema = schema.refine(
      (val: string) => {
        if (!val) return true;
        const date = new Date(val);
        if (field.min && date < new Date(field.min)) return false;
        if (field.max && date > new Date(field.max)) return false;
        return true;
      },
      {
        message:
          field.validation?.errorMessage ||
          `Date must be between ${field.min || "any"} and ${field.max || "any"}`,
      }
    );
  }

  // Handle required vs optional
  if (field.required) {
    // Add non-empty check for required fields
    return schema.refine(
      (val: string) => val !== undefined && val !== null && val !== "",
      { message: field.validation?.errorMessage || "This field is required" }
    );
  }

  return schema.optional().or(z.literal(""));
}

/**
 * Generate schema for time field.
 */
function generateTimeSchema(field: TimeFormField): z.ZodTypeAny {
  const schema = z
    .string()
    .regex(
      /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
      field.validation?.errorMessage || "Invalid time format (HH:mm)"
    );

  return applyRequired(schema, field.required, field.validation?.errorMessage);
}

/**
 * Generate schema for hidden field.
 */
function generateHiddenSchema(field: HiddenFormField): z.ZodTypeAny {
  const schema = z.string();
  return applyRequired(schema, field.required, field.validation?.errorMessage);
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Apply required/optional to a schema.
 */
function applyRequired(
  schema: z.ZodString,
  required?: boolean,
  errorMessage?: string
): z.ZodTypeAny {
  if (required) {
    return schema.min(1, errorMessage || "This field is required");
  }

  return schema.optional().or(z.literal(""));
}

// ============================================================
// Data Transformation
// ============================================================

/**
 * Transform form data before validation.
 *
 * Handles type coercion and normalization:
 * - Converts string numbers to actual numbers
 * - Converts string booleans to actual booleans
 * - Trims string values
 * - Handles empty strings
 *
 * @param data - Raw form data
 * @param fields - Form field configurations
 * @returns Transformed data ready for validation
 */
export function transformFormData(
  data: Record<string, unknown>,
  fields: FormField[]
): Record<string, unknown> {
  const transformed: Record<string, unknown> = {};

  for (const field of fields) {
    const value = data[field.name];

    // Skip undefined values
    if (value === undefined) {
      continue;
    }

    transformed[field.name] = transformFieldValue(value, field);
  }

  return transformed;
}

/**
 * Transform a single field value based on its type.
 */
function transformFieldValue(value: unknown, field: FormField): unknown {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  switch (field.type) {
    case "number":
      // Coerce to number
      if (typeof value === "string") {
        const num = parseFloat(value);
        return isNaN(num) ? value : num;
      }
      return value;

    case "checkbox":
      // Coerce to boolean
      if (typeof value === "string") {
        return value === "true" || value === "1" || value === "on";
      }
      return Boolean(value);

    case "text":
    case "email":
    case "phone":
    case "url":
    case "textarea":
    case "hidden":
      // Trim strings
      if (typeof value === "string") {
        return value.trim();
      }
      return value;

    case "select":
      // Ensure array for multi-select
      if (field.allowMultiple) {
        if (!Array.isArray(value)) {
          return value ? [value] : [];
        }
      }
      return value;

    default:
      return value;
  }
}

// ============================================================
// Validation Helper
// ============================================================

/**
 * Validate form data against a form's field configuration.
 *
 * Combines transformation and validation in one step.
 *
 * @param data - Raw form data
 * @param fields - Form field configurations
 * @returns Zod safe parse result
 *
 * @example
 * ```typescript
 * const result = validateFormData({ name: 'John', email: 'john@example.com' }, fields);
 *
 * if (result.success) {
 *   console.log('Valid data:', result.data);
 * } else {
 *   console.log('Validation errors:', result.error.flatten());
 * }
 * ```
 */
export function validateFormData(
  data: Record<string, unknown>,
  fields: FormField[]
): z.SafeParseReturnType<Record<string, unknown>, Record<string, unknown>> {
  const transformed = transformFormData(data, fields);
  const schema = generateZodSchema(fields);
  return schema.safeParse(transformed);
}

/**
 * Get validation errors as a flat object.
 *
 * @param result - Zod safe parse result
 * @returns Object mapping field names to error messages
 */
export function getValidationErrors(
  result: z.SafeParseReturnType<unknown, unknown>
): Record<string, string> {
  if (result.success) {
    return {};
  }

  const errors: Record<string, string> = {};

  for (const error of result.error.errors) {
    const path = error.path.join(".");
    if (!errors[path]) {
      errors[path] = error.message;
    }
  }

  return errors;
}
