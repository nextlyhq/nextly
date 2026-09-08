/**
 * Dynamic Zod Schema Generator
 *
 * Converts FormField[] configuration to Zod validation schemas.
 * Supports all form field types with proper validation rules.
 *
 * @module utils/generate-schema
 * @since 0.1.0
 */

import type { FieldValidationRule } from "nextly/field-catalog";
import { z } from "zod";

import { isKnownFormField } from "../types";
import type {
  AnyFieldValidation,
  AnyFormField,
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

import { ENFORCED_VALIDATION_RULES } from "./enforced-validation";

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
  fields: AnyFormField[]
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const schemaShape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    // A plugin-contributed field's value shape is owned by the plugin: accept
    // any value, but keep the base required check so a required plugin field
    // cannot be omitted (z.unknown() alone treats a missing key as valid).
    if (!isKnownFormField(field)) {
      schemaShape[field.name] = field.required
        ? z
            .unknown()
            .refine(
              value => value !== undefined && value !== null && value !== "",
              { message: `${field.label || field.name} is required` }
            )
        : z.unknown();
      continue;
    }

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
      // Unreachable for a known FormField; plugin types are handled in
      // generateZodSchema before this switch is reached.
      return z.unknown();
  }
}

/**
 * Generate schema for text field.
 */
/**
 * The author's own wording for a failure, or `undefined` when this field's type
 * does not enforce `message`.
 *
 * Asked of the row rather than read off `validation` directly, for the reason
 * the table exists at all: the editor decides whether to OFFER the control from
 * that row, so a generator honouring a stored message regardless would enforce
 * a value the author was never shown a box for — and, worse, the table would
 * describe a rule it did not govern.
 *
 * `message` was the one rule that stayed outside this. It agreed with the table
 * only because every row happens to list it, which is agreement by coincidence:
 * drop `message` from a row and the control disappears while the wording went
 * on being applied.
 */
function customMessage(field: FormField): string | undefined {
  const enforced = ENFORCED_VALIDATION_RULES[field.type] ?? [];
  if (!enforced.includes("message")) return undefined;
  return field.validation?.errorMessage;
}

/**
 * A field's stored bounds, with the custom message already resolved by the row.
 *
 * Handed to the appliers so they cannot read an ungated message: they take a
 * validation object, and giving them one whose `errorMessage` has been through
 * {@link customMessage} makes the rule hold for every applier without each of
 * them having to remember it.
 */
function enforcedValidation(field: FormField): AnyFieldValidation {
  const stored = (field.validation ?? {}) as AnyFieldValidation;
  return { ...stored, errorMessage: customMessage(field) };
}

/**
 * Which rules a type's schema applies, and how each one constrains a string.
 *
 * The WHICH comes from {@link ENFORCED_VALIDATION_RULES}, which the field
 * editor also reads to decide what to offer. One definition answers both
 * questions, so a rule cannot be offered by the editor and ignored here, or
 * honoured here and hidden there — the two used to state the same thing
 * separately and could only agree by being edited together.
 *
 * The HOW stays here, because it is about zod and the table is deliberately
 * free of it: the editor imports the table, and pulling the schema builder in
 * behind it would ship this file and its validation library to every admin
 * client before anyone opened a field.
 */
const STRING_RULE_APPLIERS: Partial<
  Record<
    FieldValidationRule,
    (
      schema: z.ZodString,
      validation: AnyFieldValidation,
      fallback: string
    ) => z.ZodString
  >
> = {
  minLength: (schema, validation) =>
    validation.minLength === undefined
      ? schema
      : schema.min(
          validation.minLength,
          validation.errorMessage ||
            `Minimum ${validation.minLength} characters required`
        ),
  maxLength: (schema, validation) =>
    validation.maxLength === undefined
      ? schema
      : schema.max(
          validation.maxLength,
          validation.errorMessage ||
            `Maximum ${validation.maxLength} characters allowed`
        ),
  pattern: (schema, validation, fallback) =>
    validation.pattern
      ? schema.regex(
          new RegExp(validation.pattern),
          validation.errorMessage || fallback
        )
      : schema,
};

/** The same, for the bounds a number carries. */
const NUMBER_RULE_APPLIERS: Partial<
  Record<
    FieldValidationRule,
    (schema: z.ZodNumber, validation: AnyFieldValidation) => z.ZodNumber
  >
> = {
  min: (schema, validation) =>
    validation.min === undefined
      ? schema
      : schema.min(
          validation.min,
          validation.errorMessage || `Minimum value is ${validation.min}`
        ),
  max: (schema, validation) =>
    validation.max === undefined
      ? schema
      : schema.max(
          validation.max,
          validation.errorMessage || `Maximum value is ${validation.max}`
        ),
};

/**
 * Whether an author-supplied pattern actually replaces a type's intrinsic one.
 *
 * Two conditions, and both are load-bearing: a pattern must be stored, AND the
 * type's row must enforce `pattern`. A type that keeps its own shape check —
 * a phone, a URL — stands it down only for an override that will really be
 * applied, because standing down for one that will not leaves nothing behind.
 */
function overridesPattern(field: FormField): boolean {
  const enforced = ENFORCED_VALIDATION_RULES[field.type] ?? [];
  if (!enforced.includes("pattern")) return false;
  const validation = (field.validation ?? {}) as AnyFieldValidation;
  return Boolean(validation.pattern);
}

/**
 * Constrain a string schema by the rules this field's TYPE enforces.
 *
 * A rule the type does not list is not applied even when the field carries a
 * value for it, which is the point: a `pattern` stored on a textarea is a bound
 * the editor never offered, and honouring it here would enforce a restriction
 * its author could not see.
 *
 * `patternMessage` is the type's own wording for a failed pattern — "Invalid
 * URL format" reads differently from "Invalid format" — so the rule set decides
 * WHICH constraints apply while each type keeps its own voice.
 */
function applyStringRules(
  schema: z.ZodString,
  field: FormField,
  patternMessage: string
): z.ZodString {
  const validation = enforcedValidation(field);
  let constrained = schema;
  for (const rule of ENFORCED_VALIDATION_RULES[field.type] ?? []) {
    const apply = STRING_RULE_APPLIERS[rule];
    if (apply) constrained = apply(constrained, validation, patternMessage);
  }
  return constrained;
}

function generateTextSchema(field: TextFormField): z.ZodTypeAny {
  const schema = applyStringRules(z.string(), field, "Invalid format");
  return applyRequired(schema, field.required, customMessage(field));
}

/**
 * Generate schema for email field.
 */
function generateEmailSchema(field: EmailFormField): z.ZodTypeAny {
  // The format check is the type's own, not a validation rule: an email field
  // is an email field whether or not its author bounded it further.
  const schema = applyStringRules(
    z.string().email(customMessage(field) || "Invalid email address"),
    field,
    "Invalid email format"
  );

  return applyRequired(schema, field.required, customMessage(field));
}

/**
 * Generate schema for number field.
 */
function generateNumberSchema(field: NumberFormField): z.ZodTypeAny {
  // Zod 4 unified message customization under a single `error` callback;
  // an undefined input is the "missing required" case, anything else is a
  // type mismatch.
  let schema = z.number({
    error: issue =>
      issue.input === undefined
        ? customMessage(field) || "This field is required"
        : "Must be a number",
  });

  // The same rule set the editor reads decides which bounds apply here.
  const validation = enforcedValidation(field);
  for (const rule of ENFORCED_VALIDATION_RULES[field.type] ?? []) {
    const apply = NUMBER_RULE_APPLIERS[rule];
    if (apply) schema = apply(schema, validation);
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
  // The default pattern is part of what a phone field IS, so it belongs to the
  // base rather than to the rule set: it applies when the author supplied none,
  // and the author's own pattern replaces it through the rule below.
  //
  // Whether the author CAN replace it is the row's decision, not the stored
  // value's. Standing the base down because a pattern happens to be stored,
  // while `applyStringRules` then declines to apply it because the row does not
  // list `pattern`, would leave the field with no check at all — every string
  // accepted, on the one type whose whole purpose is a shape.
  const base = overridesPattern(field)
    ? z.string()
    : z
        .string()
        .regex(
          /^[\d\s\-+()]+$/,
          customMessage(field) || "Invalid phone number"
        );

  const schema = applyStringRules(base, field, "Invalid phone number format");

  return applyRequired(schema, field.required, customMessage(field));
}

/**
 * Generate schema for URL field.
 */
function generateUrlSchema(field: UrlFormField): z.ZodTypeAny {
  const schema = applyStringRules(
    z.string().url(customMessage(field) || "Invalid URL"),
    field,
    "Invalid URL format"
  );

  return applyRequired(schema, field.required, customMessage(field));
}

/**
 * Generate schema for textarea field.
 */
function generateTextareaSchema(field: TextareaFormField): z.ZodTypeAny {
  const schema = applyStringRules(z.string(), field, "Invalid format");
  return applyRequired(schema, field.required, customMessage(field));
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
        customMessage(field) || "Please select at least one option"
      );
    }

    return schema.optional();
  }

  // Single select
  const schema = z.enum(validValues as [string, ...string[]], {
    error: () => customMessage(field) || "Please select a valid option",
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
      message: customMessage(field) || "This field is required",
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
    error: () => customMessage(field) || "Please select an option",
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
        customMessage(field) || "Please upload at least one file"
      );
    }

    return schema.optional();
  }

  // Single file
  const schema = z.string();
  return applyRequired(schema, field.required, customMessage(field));
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
    { message: customMessage(field) || "Invalid date" }
  );

  // Min/max date validation
  if (field.min || field.max) {
    schema = schema.refine(
      (val: unknown) => {
        if (!val) return true;
        const date = new Date(val as string);
        if (field.min && date < new Date(field.min)) return false;
        if (field.max && date > new Date(field.max)) return false;
        return true;
      },
      {
        message:
          customMessage(field) ||
          `Date must be between ${field.min || "any"} and ${field.max || "any"}`,
      }
    );
  }

  // Handle required vs optional
  if (field.required) {
    // Add non-empty check for required fields
    return schema.refine(
      (val: unknown) => val !== undefined && val !== null && val !== "",
      { message: customMessage(field) || "This field is required" }
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
      customMessage(field) || "Invalid time format (HH:mm)"
    );

  return applyRequired(schema, field.required, customMessage(field));
}

/**
 * Generate schema for hidden field.
 */
function generateHiddenSchema(field: HiddenFormField): z.ZodTypeAny {
  const schema = z.string();
  return applyRequired(schema, field.required, customMessage(field));
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
  fields: AnyFormField[]
): Record<string, unknown> {
  const transformed: Record<string, unknown> = {};

  for (const field of fields) {
    const value = data[field.name];

    // Skip undefined values
    if (value === undefined) {
      continue;
    }

    // A plugin field's value passes through untransformed — the plugin owns its
    // value shape; only built-in types get type coercion.
    transformed[field.name] = isKnownFormField(field)
      ? transformFieldValue(value, field)
      : value;
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
  fields: AnyFormField[]
): z.ZodSafeParseResult<Record<string, unknown>> {
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
  result: z.ZodSafeParseResult<unknown>
): Record<string, string> {
  if (result.success) {
    return {};
  }

  const errors: Record<string, string> = {};

  // Zod 4 renamed ZodError.errors to ZodError.issues.
  for (const error of result.error.issues) {
    const path = error.path.join(".");
    if (!errors[path]) {
      errors[path] = error.message;
    }
  }

  return errors;
}
