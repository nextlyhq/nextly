/**
 * Field Validation - Client-Side Schema Generation
 *
 * Generates Zod schemas from Nextly field configurations for client-side form validation.
 * This allows automatic validation of entry forms based on collection field definitions.
 *
 * Features:
 * - Converts all data field types to Zod schemas
 * - Recursively handles nested fields (array, group, blocks)
 * - Extracts data fields from layout wrappers (tabs, row, collapsible)
 * - Supports custom validation functions (async)
 * - Handles polymorphic relationships
 *
 * @module lib/field-validation
 * @since 1.0.0
 */

import type {
  FieldConfig,
  DataFieldConfig,
  TextFieldConfig,
  TextareaFieldConfig,
  PasswordFieldConfig,
  CodeFieldConfig,
  NumberFieldConfig,
  SelectFieldConfig,
  RadioFieldConfig,
  RelationshipFieldConfig,
  UploadFieldConfig,
  RepeaterFieldConfig,
  GroupFieldConfig,
} from "@revnixhq/nextly/config";
import {
  isTextField,
  isTextareaField,
  isEmailField,
  isPasswordField,
  isCodeField,
  isRichTextField,
  isNumberField,
  isCheckboxField,
  isDateField,
  isSelectField,
  isRadioField,
  isRelationshipField,
  isUploadField,
  isRepeaterField,
  isGroupField,
  isJSONField,
  isDataField,
} from "@revnixhq/nextly/config";
import { z } from "zod";

// ============================================================
// Types
// ============================================================

/**
 * Options for schema generation
 */
export interface GenerateSchemaOptions {
  /**
   * Whether to include custom validate functions in the schema.
   * When false, only Zod built-in validations are used.
   * @default false
   */
  includeCustomValidators?: boolean;
}

/**
 * Extended field config that includes the field name and optional tab name.
 * We require `name` to be a string for data fields we process.
 */
interface ExtractedField {
  name: string;
  type: string;
  required?: boolean;
  _tabName?: string;
  [key: string]: unknown;
}

// ============================================================
// Validation Helpers
// ============================================================

/**
 * Helper to get validation values from a field.
 * Supports both flat format (field.minLength) and nested format (field.validation.minLength).
 * This allows compatibility with both static configs and dynamic collection fields.
 */
type ValidationKey =
  | "minLength"
  | "maxLength"
  | "min"
  | "max"
  | "minRows"
  | "maxRows"
  | "pattern";

function getValidation(
  field: DataFieldConfig | ExtractedField,
  key: ValidationKey
): number | string | undefined {
  // Cast to index-accessible form — field configs don't carry an index signature
  // but may hold flat validation keys (e.g., field.minLength) or a nested
  // `validation` object. Both shapes are checked below.
  const rec = field as unknown as Record<string, unknown>;
  // First check flat format (e.g., field.minLength)
  if (key in rec && rec[key] !== undefined) {
    return rec[key] as number | string | undefined;
  }
  // Then check nested validation object (e.g., field.validation.minLength)
  const validation = rec.validation as Record<string, unknown> | undefined;
  if (validation && key in validation && validation[key] !== undefined) {
    return validation[key] as number | string | undefined;
  }
  return undefined;
}

// ============================================================
// Main Exports
// ============================================================

/**
 * Generate a Zod schema from collection field definitions.
 *
 * This function recursively processes all fields, including those nested
 * within layout fields (tabs, rows, collapsibles), and generates a
 * comprehensive Zod object schema for client-side validation.
 *
 * @param fields - Array of field configurations from a collection
 * @param options - Schema generation options
 * @returns A Zod object schema that validates the collection data structure
 *
 * @example
 * ```typescript
 * import { generateClientSchema } from '@nextly/admin/lib/field-validation';
 *
 * const schema = generateClientSchema(collection.fields);
 * const result = schema.safeParse(formData);
 *
 * if (!result.success) {
 *   console.error(z.flattenError(result.error));
 * }
 * ```
 */
export function generateClientSchema(
  fields: FieldConfig[],
  options: GenerateSchemaOptions = {}
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  // Flatten and process all fields, including those in layout containers
  const dataFields = extractDataFields(fields);

  for (const field of dataFields) {
    // Handle named tabs specially - they create nested objects
    if (field._tabName) {
      const tabName = field._tabName;
      const fieldName = field.name;

      if (!shape[tabName]) {
        shape[tabName] = z.object({});
      }

      // Merge the field into the tab's object
      const currentTabShape = (
        shape[tabName] as z.ZodObject<Record<string, z.ZodTypeAny>>
      ).shape;
      shape[tabName] = z.object({
        ...currentTabShape,
        [fieldName]: fieldToZodSchema(
          field as unknown as DataFieldConfig,
          options
        ),
      });
    } else {
      shape[field.name] = fieldToZodSchema(
        field as unknown as DataFieldConfig,
        options
      );
    }
  }

  return z.object(shape);
}

/**
 * Validate a single field value using Zod schema and optional custom validator.
 *
 * This function first runs Zod validation based on the field configuration,
 * then optionally runs the field's custom validate function if defined.
 *
 * @param field - The field configuration
 * @param value - The value to validate
 * @param data - The full document data (for custom validators that need context)
 * @returns `true` if valid, or an error message string if invalid
 *
 * @example
 * ```typescript
 * import { validateFieldValue } from '@nextly/admin/lib/field-validation';
 *
 * const result = await validateFieldValue(titleField, 'Hello', formData);
 * if (result !== true) {
 *   setError('title', { message: result });
 * }
 * ```
 */
export async function validateFieldValue(
  field: FieldConfig,
  value: unknown,
  data: Record<string, unknown> = {}
): Promise<string | true> {
  // Run Zod validation first
  const zodSchema = fieldToZodSchema(field as DataFieldConfig);
  const result = zodSchema.safeParse(value);

  if (!result.success) {
    // Get the first issue from the error
    const issues = result.error.issues;
    if (issues && issues.length > 0) {
      return issues[0].message;
    }
    return "Invalid value";
  }

  // Run custom validate function if defined
  const dataField = field as DataFieldConfig;
  if ("validate" in dataField && typeof dataField.validate === "function") {
    try {
      const customResult = await dataField.validate(value as never, {
        data,
        req: {}, // Minimal request context for client-side
      });

      if (typeof customResult === "string") {
        return customResult;
      }
    } catch (error) {
      // Custom validator threw an error
      return error instanceof Error ? error.message : "Validation failed";
    }
  }

  return true;
}

// ============================================================
// Field Extraction (Handle Layout Fields)
// ============================================================

/**
 * Extract all data fields from a field array.
 * Filters to only include fields that store data.
 */
function extractDataFields(fields: FieldConfig[]): ExtractedField[] {
  const result: ExtractedField[] = [];

  for (const field of fields) {
    if (isDataField(field)) {
      result.push(field as ExtractedField);
    }
  }

  return result;
}

// ============================================================
// Field to Zod Schema Converter
// ============================================================

/**
 * Convert a single data field configuration to a Zod schema.
 */
function fieldToZodSchema(
  field: DataFieldConfig,
  options: GenerateSchemaOptions = {}
): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  // Route to the appropriate converter based on field type
  if (isTextField(field)) {
    schema = convertTextFieldToZod(field);
  } else if (isTextareaField(field)) {
    schema = convertTextareaFieldToZod(field);
  } else if (isEmailField(field)) {
    schema = convertEmailFieldToZod();
  } else if (isPasswordField(field)) {
    schema = convertPasswordFieldToZod(field);
  } else if (isCodeField(field)) {
    schema = convertCodeFieldToZod(field);
  } else if (isRichTextField(field)) {
    schema = convertRichTextFieldToZod();
  } else if (isNumberField(field)) {
    schema = convertNumberFieldToZod(field);
  } else if (isCheckboxField(field)) {
    schema = convertCheckboxFieldToZod();
  } else if (isDateField(field)) {
    schema = convertDateFieldToZod();
  } else if (isSelectField(field)) {
    schema = convertSelectFieldToZod(field);
  } else if (isRadioField(field)) {
    schema = convertRadioFieldToZod(field);
  } else if (isRelationshipField(field)) {
    schema = convertRelationshipFieldToZod(field);
  } else if (isUploadField(field)) {
    schema = convertUploadFieldToZod(field);
  } else if (isRepeaterField(field)) {
    schema = convertArrayFieldToZod(field, options);
  } else if (isGroupField(field)) {
    schema = convertGroupFieldToZod(field, options);
  } else if (isJSONField(field)) {
    schema = convertJSONFieldToZod();
  } else {
    // Unknown field type - accept anything
    schema = z.unknown();
  }

  // Handle required vs optional
  // Check both flat format (field.required) and nested format (field.validation.required)
  // for compatibility with both static configs and dynamic collections
  const fieldRecord = field as unknown as Record<string, unknown>;
  const validation = fieldRecord.validation as
    | Record<string, unknown>
    | undefined;
  const isRequired =
    Boolean(fieldRecord.required) || Boolean(validation?.required);

  if (!isRequired) {
    schema = schema.optional().nullable();
  } else if (schema instanceof z.ZodString) {
    // For required string fields, ensure they are not empty
    // unless a specific minLength is already set
    const minLength = getValidation(field, "minLength") as number | undefined;
    if (!minLength) {
      schema = schema.min(1, "This field is required");
    }
  }

  return schema;
}

// ============================================================
// String Field Converters
// ============================================================

function convertTextFieldToZod(field: TextFieldConfig): z.ZodTypeAny {
  // Get validation values from both flat and nested formats
  const minLength = getValidation(field, "minLength") as number | undefined;
  const maxLength = getValidation(field, "maxLength") as number | undefined;
  const minRows = getValidation(field, "minRows") as number | undefined;
  const maxRows = getValidation(field, "maxRows") as number | undefined;
  const pattern = getValidation(field, "pattern") as string | undefined;
  const patternMsg = getPatternMessage(field);

  if (field.hasMany) {
    // Multiple text values
    let itemSchema = z.string();
    if (minLength) {
      itemSchema = itemSchema.min(
        minLength,
        `Each item must be at least ${minLength} characters`
      );
    }
    if (maxLength) {
      itemSchema = itemSchema.max(
        maxLength,
        `Each item must be at most ${maxLength} characters`
      );
    }
    if (pattern) {
      const re = compileRegexOrUndefined(pattern);
      if (re) itemSchema = itemSchema.regex(re, patternMsg ?? "Invalid format");
    }

    let arraySchema = z.array(itemSchema);
    if (minRows) {
      arraySchema = arraySchema.min(
        minRows,
        `Minimum ${minRows} items required`
      );
    }
    if (maxRows) {
      arraySchema = arraySchema.max(
        maxRows,
        `Maximum ${maxRows} items allowed`
      );
    }

    return arraySchema;
  }

  // Single text value
  let schema = z.string();
  if (minLength) {
    schema = schema.min(minLength, `Must be at least ${minLength} characters`);
  }
  if (maxLength) {
    schema = schema.max(maxLength, `Must be at most ${maxLength} characters`);
  }
  if (pattern) {
    const re = compileRegexOrUndefined(pattern);
    if (re) schema = schema.regex(re, patternMsg ?? "Invalid format");
  }

  return schema;
}

function convertTextareaFieldToZod(field: TextareaFieldConfig): z.ZodTypeAny {
  // Get validation values from both flat and nested formats
  const minLength = getValidation(field, "minLength") as number | undefined;
  const maxLength = getValidation(field, "maxLength") as number | undefined;
  const pattern = getValidation(field, "pattern") as string | undefined;
  const patternMsg = getPatternMessage(field);

  let schema = z.string();

  if (minLength) {
    schema = schema.min(minLength, `Must be at least ${minLength} characters`);
  }
  if (maxLength) {
    schema = schema.max(maxLength, `Must be at most ${maxLength} characters`);
  }
  if (pattern) {
    const re = compileRegexOrUndefined(pattern);
    if (re) schema = schema.regex(re, patternMsg ?? "Invalid format");
  }

  return schema;
}

/**
 * Reads `validation.message` from a field config, falling back to a flat
 * `field.message` for completeness. Used together with `validation.pattern`
 * to give the user a friendly error instead of a generic "Invalid format".
 */
function getPatternMessage(
  field: DataFieldConfig | ExtractedField
): string | undefined {
  const rec = field as unknown as Record<string, unknown>;
  const validation = rec.validation as Record<string, unknown> | undefined;
  const nested = validation?.message;
  if (typeof nested === "string" && nested.trim().length > 0) return nested;
  const flat = rec.message;
  if (typeof flat === "string" && flat.trim().length > 0) return flat;
  return undefined;
}

/**
 * Safely compile a user-supplied regex. The pattern comes straight from the
 * Builder which doesn't enforce regex validity at save time, so a malformed
 * pattern would otherwise crash the Zod schema build. We log + drop in that
 * case so the form can still render.
 */
function compileRegexOrUndefined(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[field-validation] Ignoring invalid validation.pattern:",
        pattern
      );
    }
    return undefined;
  }
}

function convertEmailFieldToZod(): z.ZodTypeAny {
  // Email field has built-in email format validation
  // Note: EmailFieldConfig doesn't have minLength/maxLength
  return z.string().email("Invalid email address");
}

function convertPasswordFieldToZod(field: PasswordFieldConfig): z.ZodTypeAny {
  // Get validation values from both flat and nested formats
  const minLength = getValidation(field, "minLength") as number | undefined;
  const maxLength = getValidation(field, "maxLength") as number | undefined;

  let schema = z.string();

  if (minLength) {
    schema = schema.min(
      minLength,
      `Password must be at least ${minLength} characters`
    );
  }
  if (maxLength) {
    schema = schema.max(
      maxLength,
      `Password must be at most ${maxLength} characters`
    );
  }

  return schema;
}

function convertCodeFieldToZod(field: CodeFieldConfig): z.ZodTypeAny {
  // Get validation values from both flat and nested formats
  const minLength = getValidation(field, "minLength") as number | undefined;
  const maxLength = getValidation(field, "maxLength") as number | undefined;

  let schema = z.string();

  if (minLength) {
    schema = schema.min(minLength, `Must be at least ${minLength} characters`);
  }
  if (maxLength) {
    schema = schema.max(maxLength, `Must be at most ${maxLength} characters`);
  }

  return schema;
}

function convertRichTextFieldToZod(): z.ZodTypeAny {
  // Rich text stores as Lexical state (JSON) or HTML string
  // Accept any structure since the Lexical editor handles its own validation
  return z.unknown();
}

// ============================================================
// Numeric Field Converters
// ============================================================

function convertNumberFieldToZod(field: NumberFieldConfig): z.ZodTypeAny {
  // Get validation values from both flat and nested formats
  const min = getValidation(field, "min") as number | undefined;
  const max = getValidation(field, "max") as number | undefined;
  const minRows = getValidation(field, "minRows") as number | undefined;
  const maxRows = getValidation(field, "maxRows") as number | undefined;

  if (field.hasMany) {
    // Multiple number values
    let itemSchema = z.number();
    if (min !== undefined) {
      itemSchema = itemSchema.min(min, `Each value must be at least ${min}`);
    }
    if (max !== undefined) {
      itemSchema = itemSchema.max(max, `Each value must be at most ${max}`);
    }

    let arraySchema = z.array(itemSchema);
    if (minRows) {
      arraySchema = arraySchema.min(
        minRows,
        `Minimum ${minRows} values required`
      );
    }
    if (maxRows) {
      arraySchema = arraySchema.max(
        maxRows,
        `Maximum ${maxRows} values allowed`
      );
    }

    return arraySchema;
  }

  // Single number value
  let schema = z.number();
  if (min !== undefined) {
    schema = schema.min(min, `Must be at least ${min}`);
  }
  if (max !== undefined) {
    schema = schema.max(max, `Must be at most ${max}`);
  }

  return schema;
}

// ============================================================
// Selection Field Converters
// ============================================================

function convertCheckboxFieldToZod(): z.ZodTypeAny {
  // Preprocess to handle string/number values from the database
  // (e.g., "true"/"false" or 0/1) before validating as boolean.
  return z.preprocess(val => {
    if (typeof val === "string") {
      return val === "true" || val === "1";
    }
    if (typeof val === "number") {
      return val !== 0;
    }
    return val;
  }, z.boolean());
}

function convertDateFieldToZod(): z.ZodTypeAny {
  // Accept ISO date strings or Date objects
  return z.string().datetime({ offset: true }).or(z.date());
}

function convertSelectFieldToZod(field: SelectFieldConfig): z.ZodTypeAny {
  if (field.options && field.options.length > 0) {
    const values = field.options.map(o => o.value) as [string, ...string[]];

    if (field.hasMany) {
      return z.array(z.enum(values));
    }

    return z.enum(values);
  }

  // No options defined - accept any string
  return field.hasMany ? z.array(z.string()) : z.string();
}

function convertRadioFieldToZod(field: RadioFieldConfig): z.ZodTypeAny {
  if (field.options && field.options.length > 0) {
    const values = field.options.map(o => o.value) as [string, ...string[]];
    return z.enum(values);
  }

  // No options defined - accept any string
  return z.string();
}

// ============================================================
// Relational Field Converters
// ============================================================

function convertRelationshipFieldToZod(
  field: RelationshipFieldConfig
): z.ZodTypeAny {
  // Determine if this is a polymorphic relationship
  const isPolymorphic = Array.isArray(field.relationTo);

  let singleSchema: z.ZodTypeAny;

  if (isPolymorphic) {
    // Polymorphic: { relationTo: string, value: string } or just string ID
    singleSchema = z
      .object({
        relationTo: z.string(),
        value: z.string(),
      })
      .or(z.string()); // Allow ID string for backwards compatibility
  } else {
    // Single collection: ID string or object with ID
    singleSchema = z
      .object({
        id: z.string(),
      })
      .passthrough()
      .or(z.string()); // Accept ID string or full object
  }

  if (field.hasMany) {
    // Get validation values from both flat and nested formats
    const minRows = getValidation(field, "minRows") as number | undefined;
    const maxRows = getValidation(field, "maxRows") as number | undefined;

    let arraySchema = z.array(singleSchema);

    if (minRows) {
      arraySchema = arraySchema.min(
        minRows,
        `Minimum ${minRows} relationships required`
      );
    }
    if (maxRows) {
      arraySchema = arraySchema.max(
        maxRows,
        `Maximum ${maxRows} relationships allowed`
      );
    }

    return arraySchema;
  }

  return singleSchema;
}

function convertUploadFieldToZod(field: UploadFieldConfig): z.ZodTypeAny {
  // Upload is similar to relationship but with file metadata
  const singleSchema = z
    .object({
      id: z.string(),
      url: z.string().optional(),
      filename: z.string().optional(),
      mimeType: z.string().optional(),
      filesize: z.number().optional(),
    })
    .passthrough()
    .or(z.string()); // Accept ID string or full object

  if (field.hasMany) {
    // Get validation values from both flat and nested formats
    const minRows = getValidation(field, "minRows") as number | undefined;
    const maxRows = getValidation(field, "maxRows") as number | undefined;

    let arraySchema = z.array(singleSchema);

    if (minRows) {
      arraySchema = arraySchema.min(
        minRows,
        `Minimum ${minRows} files required`
      );
    }
    if (maxRows) {
      arraySchema = arraySchema.max(
        maxRows,
        `Maximum ${maxRows} files allowed`
      );
    }

    return arraySchema;
  }

  return singleSchema;
}

// ============================================================
// Structured Field Converters
// ============================================================

function convertArrayFieldToZod(
  field: RepeaterFieldConfig,
  options: GenerateSchemaOptions
): z.ZodTypeAny {
  // Get validation values from both flat and nested formats
  const minRows = getValidation(field, "minRows") as number | undefined;
  const maxRows = getValidation(field, "maxRows") as number | undefined;

  // Generate schema for array items (nested fields)
  const itemSchema =
    field.fields && field.fields.length > 0
      ? generateClientSchema(field.fields as FieldConfig[], options)
      : z.object({});

  let arraySchema = z.array(itemSchema);

  if (minRows) {
    arraySchema = arraySchema.min(minRows, `Minimum ${minRows} items required`);
  }
  if (maxRows) {
    arraySchema = arraySchema.max(maxRows, `Maximum ${maxRows} items allowed`);
  }

  return arraySchema;
}

function convertGroupFieldToZod(
  field: GroupFieldConfig,
  options: GenerateSchemaOptions
): z.ZodTypeAny {
  // Generate schema for group fields
  if (field.fields && field.fields.length > 0) {
    return generateClientSchema(field.fields as FieldConfig[], options);
  }

  return z.object({});
}

// ============================================================
// Special Field Converters
// ============================================================

function convertJSONFieldToZod(): z.ZodTypeAny {
  // JSON field can contain any valid JSON value
  return z.unknown();
}

// ============================================================
// Utility Exports
// ============================================================

/**
 * Get the Zod schema for a specific field type without required/optional handling.
 * Useful for building custom validation logic.
 */
export function getBaseFieldSchema(
  field: DataFieldConfig,
  options: GenerateSchemaOptions = {}
): z.ZodTypeAny {
  return fieldToZodSchema(field, options);
}
