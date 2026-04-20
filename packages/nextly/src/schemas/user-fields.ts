import { z } from "zod";

import type { UserFieldConfig } from "../users/config/types";

import { CreateLocalUserSchema, UpdateUserSchema } from "./user";

/**
 * Maps a single UserFieldConfig to its corresponding Zod schema.
 *
 * Respects field-level constraints:
 * - text/textarea: minLength, maxLength
 * - number: min, max
 * - email: z.string().email()
 * - checkbox: z.boolean()
 * - date: z.union([z.date(), z.string()])
 * - select: z.enum() with option values, z.array() when hasMany
 * - radio: z.enum() with option values
 */
function fieldConfigToZod(field: UserFieldConfig): z.ZodTypeAny {
  // Cast to string for switch — CheckboxFieldConfig uses "checkbox" | "boolean"
  // union which doesn't fully narrow through Extract<DataFieldConfig, { type: UserFieldType }>
  const fieldType: string = field.type;
  switch (fieldType) {
    case "text":
    case "textarea": {
      let schema = z.string();
      if ("minLength" in field && typeof field.minLength === "number") {
        schema = schema.min(field.minLength);
      }
      if ("maxLength" in field && typeof field.maxLength === "number") {
        schema = schema.max(field.maxLength);
      }
      return schema;
    }

    case "email":
      return z.string().email();

    case "number": {
      let schema = z.number();
      if ("min" in field && typeof field.min === "number") {
        schema = schema.min(field.min);
      }
      if ("max" in field && typeof field.max === "number") {
        schema = schema.max(field.max);
      }
      return schema;
    }

    case "checkbox":
      return z.boolean();

    case "date":
      return z.union([z.date(), z.string()]);

    case "select": {
      const options =
        "options" in field && Array.isArray(field.options) ? field.options : [];
      const values = options.map((o: { value: string }) => o.value) as [
        string,
        ...string[],
      ];

      if (values.length === 0) {
        // No options defined — fall back to string
        const base = z.string();
        return "hasMany" in field && field.hasMany ? z.array(base) : base;
      }

      const enumSchema = z.enum(values);
      return "hasMany" in field && field.hasMany
        ? z.array(enumSchema)
        : enumSchema;
    }

    case "radio": {
      const options =
        "options" in field && Array.isArray(field.options) ? field.options : [];
      const values = options.map((o: { value: string }) => o.value) as [
        string,
        ...string[],
      ];

      if (values.length === 0) {
        return z.string();
      }
      return z.enum(values);
    }

    default:
      return z.unknown();
  }
}

/**
 * Builds a Zod object schema for custom user fields.
 *
 * Each field is mapped to its Zod equivalent based on type and constraints.
 * Non-required fields are wrapped with `.nullable().optional()`.
 */
export function buildUserFieldsSchema(
  fields: UserFieldConfig[]
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let fieldSchema = fieldConfigToZod(field);

    if (!field.required) {
      fieldSchema = fieldSchema.nullable().optional();
    }

    shape[field.name] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * Builds a merged Create schema that includes both core user fields
 * and custom user fields from UserConfig.
 *
 * Custom fields respect their `required` setting from the config.
 */
export function buildCreateUserSchema(
  fields: UserFieldConfig[]
   
): z.ZodObject<any> {
  const customSchema = buildUserFieldsSchema(fields);
  return CreateLocalUserSchema.merge(customSchema);
}

/**
 * Builds a merged Update schema that includes both core user fields
 * and custom user fields from UserConfig.
 *
 * All custom fields are `.nullable().optional()` in the update schema
 * regardless of `required` setting, since updates are partial.
 */
export function buildUpdateUserSchema(
  fields: UserFieldConfig[]
   
): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let fieldSchema = fieldConfigToZod(field);
    // Always optional in update schema — partial updates
    fieldSchema = fieldSchema.nullable().optional();
    shape[field.name] = fieldSchema;
  }

  const customSchema = z.object(shape);
  return UpdateUserSchema.merge(customSchema);
}
