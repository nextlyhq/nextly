/**
 * Zod Introspection Utilities
 *
 * Helpers for introspecting Zod schemas at runtime to dynamically
 * render configuration forms. Compatible with Zod v4.
 *
 * @module components/features/schema-builder/HooksEditor/utils/zodIntrospection
 */

import { z } from "zod";

// Zod internals (_zod.def, _def) have no public type definition;
// we use Record<string, unknown> with targeted casts for runtime introspection.
export type AnyDef = Record<string, unknown>;

/**
 * Helper to get Zod internal def (works with Zod v4)
 */
export function getZodDef(schema: z.ZodTypeAny): AnyDef {
  // Zod v4 uses _zod.def
  const s = schema as unknown as Record<string, unknown>;
  const zodInternal = s._zod as Record<string, unknown> | undefined;
  return (zodInternal?.def as AnyDef) || (s._def as AnyDef) || {};
}

/**
 * Helper to check Zod type names (works with Zod v4)
 */
export function getZodTypeName(schema: z.ZodTypeAny): string {
  const def = getZodDef(schema);
  if (def?.type) return def.type as string;
  if (def?.typeName) return def.typeName as string;
  // Fallback to constructor name
  return schema.constructor.name;
}

/**
 * Check if a Zod schema is a specific type
 */
export function isZodType(schema: z.ZodTypeAny, typeName: string): boolean {
  return getZodTypeName(schema) === typeName;
}

/**
 * Unwrap default/optional wrappers to get the inner type
 */
export function unwrapZodType(schema: z.ZodTypeAny): {
  innerSchema: z.ZodTypeAny;
  hasDefault: boolean;
  isOptional: boolean;
  defaultValue?: unknown;
} {
  let innerSchema = schema;
  let hasDefault = false;
  let isOptional = false;
  let defaultValue: unknown;

  // Check for default wrapper
  if (isZodType(innerSchema, "default")) {
    hasDefault = true;
    const def = getZodDef(innerSchema);
    defaultValue =
      typeof def?.defaultValue === "function"
        ? (def.defaultValue as () => unknown)()
        : def?.defaultValue;
    innerSchema = (def?.innerType as z.ZodTypeAny) || innerSchema;
  }

  // Check for optional wrapper
  if (isZodType(innerSchema, "optional")) {
    isOptional = true;
    const def = getZodDef(innerSchema);
    innerSchema = (def?.innerType as z.ZodTypeAny) || innerSchema;
  }

  return { innerSchema, hasDefault, isOptional, defaultValue };
}

/**
 * Get default config values from a Zod schema
 */
export function getDefaultConfig(schema: z.ZodSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  if (!isZodType(schema as z.ZodTypeAny, "object")) {
    return defaults;
  }

  // Get shape from object schema
  const objectDef = getZodDef(schema as z.ZodTypeAny);
  const shape = (objectDef?.shape || {}) as Record<string, z.ZodTypeAny>;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const zodField = fieldSchema as z.ZodTypeAny;
    const { innerSchema, hasDefault, defaultValue } = unwrapZodType(zodField);

    if (hasDefault && defaultValue !== undefined) {
      defaults[key] = defaultValue;
    } else if (isZodType(innerSchema, "boolean")) {
      defaults[key] = false;
    } else if (isZodType(innerSchema, "string")) {
      defaults[key] = "";
    } else if (isZodType(innerSchema, "array")) {
      defaults[key] = [];
    }
  }

  return defaults;
}

/**
 * Get the shape of a Zod object schema (Zod v4 compatible)
 */
export function getObjectShape(
  schema: z.ZodSchema
): Record<string, z.ZodTypeAny> {
  const def = getZodDef(schema as z.ZodTypeAny);
  return (def?.shape || {}) as Record<string, z.ZodTypeAny>;
}

/**
 * Check if schema has URL validation (Zod v4 compatible)
 */
export function hasUrlCheck(schema: z.ZodTypeAny): boolean {
  const def = getZodDef(schema);
  const checks = (def?.checks || []) as AnyDef[];
  return checks.some((check: AnyDef) => check?.kind === "url");
}

/**
 * Get enum values from a Zod enum schema (Zod v4 compatible)
 */
export function getEnumValues(schema: z.ZodTypeAny): string[] {
  const def = getZodDef(schema);
  // Zod v4 stores enum values differently
  if (def?.entries) {
    return Object.keys(def.entries as Record<string, unknown>);
  }
  if (def?.values) {
    return def.values as string[];
  }
  return [];
}

/**
 * Get inner type of array schema (Zod v4 compatible)
 */
export function getArrayInnerType(schema: z.ZodTypeAny): z.ZodTypeAny | null {
  const def = getZodDef(schema);
  return (def?.element as z.ZodTypeAny) || (def?.type as z.ZodTypeAny) || null;
}
